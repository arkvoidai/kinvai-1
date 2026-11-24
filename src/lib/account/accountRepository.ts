import { getSupabaseBrowserClient } from '../supabase/client';

export interface AccountLibraryProduct {
  id: string;
  slug: string;
  sku: string;
  name: string;
  version: string | null;
  file_formats: string[];
  cover_path: string | null;
  collection_id: string | null;
}

export interface AccountCollection {
  id: string;
  name: string;
  accent: 'apricot' | 'butter' | 'lilac' | 'rose' | 'cocoa';
}

export interface AccountReview {
  product_id: string;
  rating: number;
  title: string | null;
  body: string | null;
  status: 'pending' | 'approved' | 'rejected';
}

export interface AccountLibraryItem {
  entitlementId: string;
  orderId: string | null;
  grantedAt: string | null;
  product: AccountLibraryProduct;
  collection: AccountCollection | null;
  review: AccountReview | null;
}

export interface AccountOrderItem {
  id: string;
  product_name: string;
  sku: string;
  unit_price_cents: number;
}

export interface AccountOrder {
  id: string;
  order_number: string;
  status: 'created' | 'pending' | 'paid' | 'failed' | 'cancelled' | 'refunded' | 'partially_refunded';
  provider: 'razorpay' | 'paypal' | null;
  currency: 'USD';
  total_cents: number;
  refunded_cents: number;
  created_at: string;
  order_items: AccountOrderItem[];
}

export interface LibraryFileMetadata {
  id: string;
  product_id: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  version: string | null;
}

export async function getAccountLibrary(userId: string): Promise<{
  items: AccountLibraryItem[];
  error: string | null;
}> {
  const client = getSupabaseBrowserClient();
  if (!client || !userId) {
    return { items: [], error: 'Your library is not available right now.' };
  }

  try {
    const { data: entitlementRows, error: entitlementError } = await client
      .from('entitlements')
      .select('id, product_id, order_id, granted_at')
      .eq('user_id', userId)
      .is('revoked_at', null)
      .order('granted_at', { ascending: false });

    if (entitlementError) {
      return { items: [], error: 'Your library could not be loaded. Please try again.' };
    }

    const rows = entitlementRows ?? [];
    const productIds = Array.from(new Set(rows.map((row) => String(row.product_id))));
    if (productIds.length === 0) return { items: [], error: null };

    const { data: products, error: productError } = await client
      .from('products')
      .select('id, slug, sku, name, version, file_formats, cover_path, collection_id')
      .in('id', productIds);

    if (productError) {
      return { items: [], error: 'Product details could not be loaded. Please try again.' };
    }

    const collectionIds = Array.from(
      new Set((products ?? []).map((product) => product.collection_id).filter(Boolean))
    );
    const [collectionsResult, reviewsResult] = await Promise.all([
      collectionIds.length
        ? client.from('collections').select('id, name, accent').in('id', collectionIds)
        : Promise.resolve({ data: [], error: null }),
      client
        .from('reviews')
        .select('product_id, rating, title, body, status')
        .eq('user_id', userId)
        .in('product_id', productIds),
    ]);

    const productsById = new Map((products ?? []).map((product) => [product.id, product] as const));
    const collectionsById = new Map(
      ((collectionsResult.data ?? []) as Array<Record<string, unknown>>).map((collection) => [
        String(collection.id),
        {
          id: String(collection.id),
          name: String(collection.name ?? ''),
          accent: String(collection.accent ?? 'cocoa') as AccountCollection['accent'],
        },
      ] as const)
    );
    const reviewsByProductId = new Map(
      ((reviewsResult.data ?? []) as AccountReview[]).map((review) => [review.product_id, review] as const)
    );

    const items = rows.flatMap((entitlement) => {
      const product = productsById.get(entitlement.product_id);
      if (!product) return [];
      const libraryProduct: AccountLibraryProduct = {
        id: String(product.id),
        slug: String(product.slug),
        sku: String(product.sku),
        name: String(product.name),
        version: product.version == null ? null : String(product.version),
        file_formats: Array.isArray(product.file_formats) ? product.file_formats : [],
        cover_path: product.cover_path == null ? null : String(product.cover_path),
        collection_id: product.collection_id == null ? null : String(product.collection_id),
      };

      return [{
        entitlementId: String(entitlement.id),
        orderId: entitlement.order_id == null ? null : String(entitlement.order_id),
        grantedAt: entitlement.granted_at == null ? null : String(entitlement.granted_at),
        product: libraryProduct,
        collection: libraryProduct.collection_id
          ? collectionsById.get(libraryProduct.collection_id) ?? null
          : null,
        review: reviewsByProductId.get(libraryProduct.id) ?? null,
      }];
    });

    return { items, error: null };
  } catch {
    return { items: [], error: 'Your library could not be loaded. Please try again.' };
  }
}

export async function getAccountOrders(userId: string): Promise<{
  orders: AccountOrder[];
  error: string | null;
}> {
  const client = getSupabaseBrowserClient();
  if (!client || !userId) {
    return { orders: [], error: 'Your orders are not available right now.' };
  }

  try {
    const { data, error } = await client
      .from('orders')
      .select('id, order_number, status, provider, currency, total_cents, refunded_cents, created_at, order_items(id, product_name, sku, unit_price_cents)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) return { orders: [], error: 'Your order history could not be loaded. Please try again.' };

    const orders: AccountOrder[] = (data ?? []).map((order) => ({
      id: String(order.id),
      order_number: String(order.order_number),
      status: order.status,
      provider: order.provider ?? null,
      currency: 'USD',
      total_cents: Number(order.total_cents ?? 0),
      refunded_cents: Number(order.refunded_cents ?? 0),
      created_at: String(order.created_at),
      order_items: (order.order_items ?? []).map((item: Record<string, unknown>) => ({
        id: String(item.id),
        product_name: String(item.product_name),
        sku: String(item.sku),
        unit_price_cents: Number(item.unit_price_cents ?? 0),
      })),
    }));

    return { orders, error: null };
  } catch {
    return { orders: [], error: 'Your order history could not be loaded. Please try again.' };
  }
}

export async function getLibraryFileMetadata(accessToken: string): Promise<{
  files: LibraryFileMetadata[];
  error: string | null;
}> {
  if (!accessToken) return { files: [], error: 'Sign in again to view download files.' };

  try {
    const response = await fetch('/api/library/files', {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + accessToken },
      cache: 'no-store',
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        files: [],
        error: typeof payload.error === 'string' ? payload.error : 'Download files could not be loaded.',
      };
    }
    return {
      files: Array.isArray(payload.files) ? payload.files as LibraryFileMetadata[] : [],
      error: null,
    };
  } catch {
    return { files: [], error: 'Download files could not be loaded. Please try again.' };
  }
}

export async function updateAccountProfile(
  userId: string,
  input: { display_name: string; country_code: string | null }
): Promise<{ error: string | null }> {
  const client = getSupabaseBrowserClient();
  if (!client) return { error: 'Profile updates are unavailable right now.' };

  try {
    const { data, error } = await client
      .from('profiles')
      .update({
        display_name: input.display_name.trim() || null,
        country_code: input.country_code,
      })
      .eq('id', userId)
      .select('id')
      .maybeSingle();

    if (error) return { error: 'Your profile could not be saved. Please try again.' };
    if (!data) return { error: 'The profile record is not ready yet. Please contact support.' };
    return { error: null };
  } catch {
    return { error: 'Your profile could not be saved. Please try again.' };
  }
}

export async function getMyProductReview(
  userId: string,
  productId: string
): Promise<AccountReview | null> {
  const client = getSupabaseBrowserClient();
  if (!client || !userId || !productId) return null;

  try {
    const { data, error } = await client
      .from('reviews')
      .select('product_id, rating, title, body, status')
      .eq('user_id', userId)
      .eq('product_id', productId)
      .maybeSingle();
    if (error || !data) return null;
    return data as AccountReview;
  } catch {
    return null;
  }
}

export async function saveOwnerProductReview(input: {
  userId: string;
  productId: string;
  rating: number;
  title: string;
  body: string;
}): Promise<{ review: AccountReview | null; error: string | null }> {
  const client = getSupabaseBrowserClient();
  if (!client) return { review: null, error: 'Reviews are unavailable right now.' };

  const title = input.title.trim();
  const body = input.body.trim();
  const rating = Math.round(input.rating);

  if (rating < 1 || rating > 5) {
    return { review: null, error: 'Choose a rating from 1 to 5.' };
  }
  if (!title || title.length > 120 || !body || body.length > 4000) {
    return { review: null, error: 'Add a title (up to 120 characters) and review (up to 4,000 characters).' };
  }

  try {
    const { data: entitlement, error: entitlementError } = await client
      .from('entitlements')
      .select('id')
      .eq('user_id', input.userId)
      .eq('product_id', input.productId)
      .is('revoked_at', null)
      .maybeSingle();

    if (entitlementError) {
      return { review: null, error: 'Ownership could not be verified. Please try again.' };
    }
    if (!entitlement) {
      return { review: null, error: 'Reviews are available only to customers with an active licence for this product.' };
    }

    const { data, error } = await client
      .from('reviews')
      .upsert(
        {
          user_id: input.userId,
          product_id: input.productId,
          rating,
          title,
          body,
          status: 'pending',
        },
        { onConflict: 'user_id,product_id' }
      )
      .select('product_id, rating, title, body, status')
      .single();

    if (error || !data) {
      return { review: null, error: 'Your review could not be submitted. Please try again.' };
    }

    return { review: data as AccountReview, error: null };
  } catch {
    return { review: null, error: 'Your review could not be submitted. Please try again.' };
  }
}
