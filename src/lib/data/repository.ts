import { z } from 'zod';
import { getPublicConfig } from '../config';
import { getSupabaseBrowserClient } from '../supabase/client';
import { SEED_COLLECTIONS, SEED_PRODUCTS } from './seed';
import {
  CollectionSchema,
  EntitlementSchema,
  ProductMediaSchema,
  ProductSchema,
  RatingStatsSchema,
  ReviewSchema,
  WishlistItemSchema,
  type Collection,
  type DataEnvelope,
  type Entitlement,
  type PaginatedProductsResult,
  type Product,
  type ProductDetail,
  type ProductMedia,
  type ProductQueryParams,
  type RatingStats,
  type Review,
  type WishlistItem,
} from './types';

function allowSeedFallback(): boolean {
  return getPublicConfig().flags.allowSeedFallback;
}

function parseArray<T>(schema: z.ZodType<T>, raw: unknown): T[] {
  const result = z.array(schema).safeParse(raw);
  if (result.success) {
    return result.data;
  }
  // Validate row-by-row so one malformed legacy row never hides valid rows
  if (Array.isArray(raw)) {
    const valid: T[] = [];
    for (const item of raw) {
      const parsed = schema.safeParse(item);
      if (parsed.success) {
        valid.push(parsed.data);
      }
    }
    return valid;
  }
  return [];
}

/**
 * Pure seed-data filtering, sorting, and pagination helper (also unit-tested directly).
 */
export function querySeedProducts(params: ProductQueryParams = {}): PaginatedProductsResult {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.max(1, Math.min(48, params.pageSize ?? 12));

  let list = SEED_PRODUCTS.filter((p) => p.status === 'published');

  if (params.collection) {
    const col = SEED_COLLECTIONS.find(
      (c) => c.slug === params.collection || c.id === params.collection
    );
    if (col) {
      list = list.filter((p) => p.collection_id === col.id);
    } else {
      list = [];
    }
  }

  if (params.tags && params.tags.length > 0) {
    const lowerTags = params.tags.map((t) => t.toLowerCase());
    list = list.filter((p) =>
      lowerTags.some((t) => p.tags.map((pt) => pt.toLowerCase()).includes(t))
    );
  }

  if (params.formats && params.formats.length > 0) {
    const lowerFormats = params.formats.map((f) => f.toLowerCase());
    list = list.filter((p) =>
      lowerFormats.some((f) => p.file_formats.map((pf) => pf.toLowerCase()).includes(f))
    );
  }

  if (typeof params.priceMin === 'number') {
    list = list.filter((p) => p.price_cents >= params.priceMin!);
  }

  if (typeof params.priceMax === 'number') {
    list = list.filter((p) => p.price_cents <= params.priceMax!);
  }

  if (params.q && params.q.trim().length > 0) {
    const tokens = params.q
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    list = list.filter((p) => {
      const haystack = [
        p.name,
        p.tagline ?? '',
        p.short_description ?? '',
        p.description ?? '',
        p.sku,
        ...p.tags,
        ...p.file_formats,
      ]
        .join(' ')
        .toLowerCase();
      return tokens.every((tok) => haystack.includes(tok));
    });
  }

  const sort = params.sort ?? 'featured';
  list = [...list].sort((a, b) => {
    switch (sort) {
      case 'price-asc':
        return a.price_cents - b.price_cents;
      case 'price-desc':
        return b.price_cents - a.price_cents;
      case 'name-asc':
        return a.name.localeCompare(b.name);
      case 'newest':
        return (b.published_at ?? '').localeCompare(a.published_at ?? '');
      case 'featured':
      default: {
        const aFeat = a.is_featured ? 0 : 1;
        const bFeat = b.is_featured ? 0 : 1;
        if (aFeat !== bFeat) return aFeat - bFeat;
        const aRank = a.featured_rank ?? 999;
        const bRank = b.featured_rank ?? 999;
        if (aRank !== bRank) return aRank - bRank;
        return a.name.localeCompare(b.name);
      }
    }
  });

  const total = list.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize;
  const items = list.slice(start, start + pageSize);

  return {
    items,
    total,
    page,
    pageSize,
    totalPages,
    source: 'seed',
    isPreviewData: true,
  };
}

export async function getCollections(): Promise<DataEnvelope<Collection[]>> {
  const client = getSupabaseBrowserClient();
  let queryError: string | undefined;

  if (client) {
    try {
      const { data, error } = await client
        .from('collections')
        .select('*')
        .eq('is_active', true)
        .order('sort_order', { ascending: true });

      if (error) {
        queryError = error.message || 'Could not load collections.';
      } else if (data && data.length > 0) {
        const parsed = parseArray(CollectionSchema, data);
        if (parsed.length > 0) {
          return { data: parsed, source: 'supabase', isPreviewData: false };
        }
      }
    } catch (err) {
      queryError = err instanceof Error ? err.message : 'Could not load collections.';
    }
  }

  if (allowSeedFallback()) {
    return { data: SEED_COLLECTIONS, source: 'seed', isPreviewData: true };
  }
  return { data: [], source: 'empty', isPreviewData: false, error: queryError };
}

export async function getCollection(slug: string): Promise<DataEnvelope<Collection | null>> {
  const client = getSupabaseBrowserClient();
  let queryError: string | undefined;

  if (client) {
    try {
      const { data, error } = await client
        .from('collections')
        .select('*')
        .eq('slug', slug)
        .eq('is_active', true)
        .maybeSingle();

      if (error) {
        queryError = error.message || 'Could not load collection.';
      } else if (data) {
        const parsed = CollectionSchema.safeParse(data);
        if (parsed.success) {
          return { data: parsed.data, source: 'supabase', isPreviewData: false };
        }
      }
    } catch (err) {
      queryError = err instanceof Error ? err.message : 'Could not load collection.';
    }
  }

  if (allowSeedFallback()) {
    const found = SEED_COLLECTIONS.find((c) => c.slug === slug) ?? null;
    return { data: found, source: 'seed', isPreviewData: true };
  }
  return { data: null, source: 'empty', isPreviewData: false, error: queryError };
}

export async function getProducts(params: ProductQueryParams = {}): Promise<PaginatedProductsResult> {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.max(1, Math.min(48, params.pageSize ?? 12));
  const client = getSupabaseBrowserClient();
  let queryError: string | undefined;

  if (client) {
    try {
      let collectionId: string | undefined = params.collectionId;
      if (!collectionId && params.collection) {
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          params.collection
        );
        const colRes = isUuid
          ? await client
              .from('collections')
              .select('id')
              .eq('id', params.collection)
              .maybeSingle()
          : await client
              .from('collections')
              .select('id')
              .eq('slug', params.collection)
              .maybeSingle();
        if (colRes.error) {
          queryError = colRes.error.message || 'Could not resolve collection.';
        } else {
          collectionId = colRes.data?.id;
        }
      }

      if (!queryError) {
        let query = client
          .from('products')
          .select('*', { count: 'exact' })
          .eq('status', 'published');

        if (params.collection || params.collectionId) {
          if (!collectionId) {
            const { count: liveCount, error: countError } = await client
              .from('products')
              .select('id', { count: 'exact', head: true })
              .eq('status', 'published');

            if (countError) {
              queryError = countError.message || 'Could not load products.';
            } else if ((liveCount ?? 0) > 0) {
              return {
                items: [],
                total: 0,
                page,
                pageSize,
                totalPages: 1,
                source: 'supabase',
                isPreviewData: false,
              };
            } else if (allowSeedFallback()) {
              return querySeedProducts(params);
            } else {
              return {
                items: [],
                total: 0,
                page,
                pageSize,
                totalPages: 1,
                source: 'empty',
                isPreviewData: false,
              };
            }
          } else {
            query = query.eq('collection_id', collectionId);
          }
        }

        if (!queryError) {
          if (params.tags && params.tags.length > 0) {
            query = query.overlaps('tags', params.tags);
          }
          if (params.formats && params.formats.length > 0) {
            query = query.overlaps('file_formats', params.formats);
          }
          if (typeof params.priceMin === 'number') {
            query = query.gte('price_cents', params.priceMin);
          }
          if (typeof params.priceMax === 'number') {
            query = query.lte('price_cents', params.priceMax);
          }
          if (params.q && params.q.trim().length > 0) {
            const safeQ = params.q.trim().replace(/[,%()]/g, ' ');
            query = query.or(
              `name.ilike.%${safeQ}%,tagline.ilike.%${safeQ}%,short_description.ilike.%${safeQ}%`
            );
          }

          switch (params.sort) {
            case 'price-asc':
              query = query.order('price_cents', { ascending: true });
              break;
            case 'price-desc':
              query = query.order('price_cents', { ascending: false });
              break;
            case 'name-asc':
              query = query.order('name', { ascending: true });
              break;
            case 'newest':
              query = query.order('published_at', { ascending: false, nullsFirst: false });
              break;
            case 'featured':
            default:
              query = query
                .order('is_featured', { ascending: false })
                .order('featured_rank', { ascending: true, nullsFirst: false })
                .order('name', { ascending: true });
              break;
          }

          const from = (page - 1) * pageSize;
          const to = from + pageSize - 1;
          const { data, count, error } = await query.range(from, to);

          if (error) {
            queryError = error.message || 'Could not load products.';
          } else if (data) {
            const hasFilters = Boolean(
              params.collection ||
                params.collectionId ||
                (params.tags && params.tags.length > 0) ||
                (params.formats && params.formats.length > 0) ||
                params.priceMin !== undefined ||
                params.priceMax !== undefined ||
                (params.q && params.q.trim().length > 0)
            );
            if (data.length > 0 || hasFilters) {
              const parsed = parseArray(ProductSchema, data);
              const total = count ?? parsed.length;
              return {
                items: parsed,
                total,
                page,
                pageSize,
                totalPages: Math.max(1, Math.ceil(total / pageSize)),
                source: 'supabase',
                isPreviewData: false,
              };
            }
          }
        }
      }
    } catch (err) {
      queryError = err instanceof Error ? err.message : 'Could not load products.';
    }
  }

  if (allowSeedFallback()) {
    return querySeedProducts(params);
  }

  return {
    items: [],
    total: 0,
    page,
    pageSize,
    totalPages: 1,
    source: 'empty',
    isPreviewData: false,
    error: queryError,
  };
}

export async function getFeatured(limit = 6): Promise<DataEnvelope<Product[]>> {
  const client = getSupabaseBrowserClient();
  if (client) {
    try {
      const { data, error } = await client
        .from('products')
        .select('*')
        .eq('status', 'published')
        .eq('is_featured', true)
        .order('featured_rank', { ascending: true, nullsFirst: false })
        .limit(limit);

      if (!error && data && data.length > 0) {
        const parsed = parseArray(ProductSchema, data);
        if (parsed.length > 0) {
          return { data: parsed, source: 'supabase', isPreviewData: false };
        }
      }
    } catch {
      // Fallback below
    }
  }

  if (allowSeedFallback()) {
    const featured = SEED_PRODUCTS.filter((p) => p.is_featured)
      .sort((a, b) => (a.featured_rank ?? 999) - (b.featured_rank ?? 999))
      .slice(0, limit);
    return { data: featured, source: 'seed', isPreviewData: true };
  }
  return { data: [], source: 'empty', isPreviewData: false };
}

export async function getRelated(productId: string, limit = 4): Promise<DataEnvelope<Product[]>> {
  const client = getSupabaseBrowserClient();
  if (client) {
    try {
      const { data: relRows, error: relError } = await client
        .from('product_relations')
        .select('related_product_id, sort_order')
        .eq('product_id', productId)
        .order('sort_order', { ascending: true })
        .limit(limit);

      if (!relError && relRows && relRows.length > 0) {
        const ids = relRows.map((r) => String(r.related_product_id));
        const { data: prodRows, error: prodError } = await client
          .from('products')
          .select('*')
          .in('id', ids)
          .eq('status', 'published');

        if (!prodError && prodRows && prodRows.length > 0) {
          const parsed = parseArray(ProductSchema, prodRows);
          const ordered = ids
            .map((id) => parsed.find((p) => p.id === id))
            .filter((p): p is Product => Boolean(p));
          if (ordered.length > 0) {
            return { data: ordered, source: 'supabase', isPreviewData: false };
          }
        }
      }
    } catch {
      // Fallback below
    }
  }

  if (allowSeedFallback()) {
    const current = SEED_PRODUCTS.find((p) => p.id === productId);
    const sameCollection = SEED_PRODUCTS.filter(
      (p) => p.id !== productId && p.collection_id === current?.collection_id
    );
    const others = SEED_PRODUCTS.filter(
      (p) => p.id !== productId && p.collection_id !== current?.collection_id
    );
    return {
      data: [...sameCollection, ...others].slice(0, limit),
      source: 'seed',
      isPreviewData: true,
    };
  }
  return { data: [], source: 'empty', isPreviewData: false };
}

export async function getProductBySlug(slug: string): Promise<DataEnvelope<ProductDetail | null>> {
  const client = getSupabaseBrowserClient();
  if (client) {
    try {
      const { data: prodRow, error } = await client
        .from('products')
        .select('*')
        .eq('slug', slug)
        .eq('status', 'published')
        .maybeSingle();

      if (!error && prodRow) {
        const parsedProduct = ProductSchema.safeParse(prodRow);
        if (parsedProduct.success) {
          const product = parsedProduct.data;
          const [colRes, mediaRes, relatedRes, stats] = await Promise.all([
            product.collection_id
              ? client.from('collections').select('*').eq('id', product.collection_id).maybeSingle()
              : Promise.resolve({ data: null, error: null }),
            client
              .from('product_media')
              .select('*')
              .eq('product_id', product.id)
              .order('sort_order', { ascending: true }),
            getRelated(product.id, 4),
            getRatingStats(product.id),
          ]);

          const collectionParsed = colRes.data ? CollectionSchema.safeParse(colRes.data) : null;
          const media: ProductMedia[] = mediaRes.data
            ? parseArray(ProductMediaSchema, mediaRes.data)
            : [];

          return {
            data: {
              product,
              collection: collectionParsed?.success ? collectionParsed.data : null,
              media,
              related: relatedRes.data,
              ratingStats: stats,
            },
            source: 'supabase',
            isPreviewData: false,
          };
        }
      }
    } catch {
      // Fallback below
    }
  }

  if (allowSeedFallback()) {
    const product = SEED_PRODUCTS.find((p) => p.slug === slug);
    if (!product) {
      return { data: null, source: 'seed', isPreviewData: true };
    }
    const collection = SEED_COLLECTIONS.find((c) => c.id === product.collection_id) ?? null;
    const related = SEED_PRODUCTS.filter(
      (p) => p.id !== product.id && p.collection_id === product.collection_id
    ).slice(0, 4);

    return {
      data: {
        product,
        collection,
        media: [],
        related,
        ratingStats: null,
      },
      source: 'seed',
      isPreviewData: true,
    };
  }

  return { data: null, source: 'empty', isPreviewData: false };
}

export async function searchProducts(
  queryText: string,
  limit = 12,
  signal?: AbortSignal
): Promise<DataEnvelope<Product[]>> {
  const q = queryText.trim();
  if (!q || signal?.aborted) {
    return { data: [], source: 'empty', isPreviewData: false };
  }

  const client = getSupabaseBrowserClient();
  let queryError: string | undefined;

  if (client) {
    try {
      const rpcQuery = client.rpc('search_products', {
        p_query: q,
        p_limit: limit,
      });
      if (signal && typeof rpcQuery.abortSignal === 'function') {
        rpcQuery.abortSignal(signal);
      }
      const { data, error } = await rpcQuery;
      if (signal?.aborted) {
        return { data: [], source: 'empty', isPreviewData: false };
      }

      if (error) {
        queryError = error.message || 'Search could not be completed.';
      } else if (Array.isArray(data)) {
        const parsed = parseArray(ProductSchema, data);
        if (parsed.length > 0) {
          return { data: parsed, source: 'supabase', isPreviewData: false };
        }
        const countQuery = client
          .from('products')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'published');
        if (signal && typeof countQuery.abortSignal === 'function') {
          countQuery.abortSignal(signal);
        }
        const { count } = await countQuery;
        if (signal?.aborted) {
          return { data: [], source: 'empty', isPreviewData: false };
        }
        if ((count ?? 0) > 0) {
          return { data: [], source: 'supabase', isPreviewData: false };
        }
      }
    } catch (err) {
      if (signal?.aborted) {
        return { data: [], source: 'empty', isPreviewData: false };
      }
      queryError = err instanceof Error ? err.message : 'Search could not be completed.';
    }
  }

  if (allowSeedFallback()) {
    const res = querySeedProducts({ q, pageSize: limit });
    return { data: res.items, source: 'seed', isPreviewData: true };
  }
  return { data: [], source: 'empty', isPreviewData: false, error: queryError };
}

export async function getRatingStats(productId: string): Promise<RatingStats | null> {
  const client = getSupabaseBrowserClient();
  if (!client) return null;
  try {
    const { data, error } = await client
      .from('product_rating_stats')
      .select('product_id, review_count, avg_rating')
      .eq('product_id', productId)
      .maybeSingle();

    if (error || !data) return null;
    const parsed = RatingStatsSchema.safeParse(data);
    if (!parsed.success || parsed.data.review_count === 0) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

export async function getApprovedReviews(productId: string): Promise<Review[]> {
  const client = getSupabaseBrowserClient();
  if (!client) return [];
  try {
    const { data, error } = await client
      .from('reviews')
      .select('user_id, product_id, rating, title, body, status')
      .eq('product_id', productId)
      .eq('status', 'approved');

    if (error || !data) return [];
    return parseArray(ReviewSchema, data);
  } catch {
    return [];
  }
}

export async function getRecentApprovedReviews(limit = 6): Promise<Review[]> {
  const client = getSupabaseBrowserClient();
  if (!client) return [];
  try {
    const { data, error } = await client
      .from('reviews')
      .select('id, user_id, product_id, rating, title, body, status, created_at')
      .eq('status', 'approved')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error || !data) return [];
    return parseArray(ReviewSchema, data);
  } catch {
    return [];
  }
}

export async function getLibrary(userId: string): Promise<Entitlement[]> {
  const client = getSupabaseBrowserClient();
  if (!client || !userId) return [];
  try {
    const { data, error } = await client
      .from('entitlements')
      .select('user_id, product_id, order_id, revoked_at')
      .eq('user_id', userId)
      .is('revoked_at', null);

    if (error || !data) return [];
    return parseArray(EntitlementSchema, data);
  } catch {
    return [];
  }
}

export async function getWishlist(userId: string): Promise<WishlistItem[]> {
  const client = getSupabaseBrowserClient();
  if (!client || !userId) return [];
  try {
    const { data, error } = await client
      .from('wishlist_items')
      .select('user_id, product_id')
      .eq('user_id', userId);

    if (error || !data) return [];
    return parseArray(WishlistItemSchema, data);
  } catch {
    return [];
  }
}

export async function addWishlistItem(userId: string, productId: string): Promise<boolean> {
  const client = getSupabaseBrowserClient();
  if (!client || !userId || !productId) return false;
  try {
    const { error } = await client
      .from('wishlist_items')
      .upsert({ user_id: userId, product_id: productId }, { onConflict: 'user_id,product_id' });
    return !error;
  } catch {
    return false;
  }
}

export async function removeWishlistItem(userId: string, productId: string): Promise<boolean> {
  const client = getSupabaseBrowserClient();
  if (!client || !userId || !productId) return false;
  try {
    const { error } = await client
      .from('wishlist_items')
      .delete()
      .eq('user_id', userId)
      .eq('product_id', productId);
    return !error;
  } catch {
    return false;
  }
}

export async function upsertWishlistItems(userId: string, productIds: string[]): Promise<boolean> {
  const client = getSupabaseBrowserClient();
  if (!client || !userId || productIds.length === 0) return true;
  try {
    const rows = productIds.map((product_id) => ({ user_id: userId, product_id }));
    const { error } = await client
      .from('wishlist_items')
      .upsert(rows, { onConflict: 'user_id,product_id' });
    return !error;
  } catch {
    return false;
  }
}

export async function isOwned(userId: string, productId: string): Promise<boolean> {
  const client = getSupabaseBrowserClient();
  if (!client || !userId || !productId) return false;
  try {
    const { data, error } = await client
      .from('entitlements')
      .select('product_id')
      .eq('user_id', userId)
      .eq('product_id', productId)
      .is('revoked_at', null)
      .maybeSingle();

    return !error && Boolean(data);
  } catch {
    return false;
  }
}

export interface SiteAnnouncement {
  enabled: boolean;
  message: string;
  href?: string;
  label?: string;
}

const SiteAnnouncementSchema = z.object({
  enabled: z.boolean().optional().default(false),
  message: z.string().trim().min(1).optional(),
  text: z.string().trim().min(1).optional(),
  href: z.string().trim().optional(),
  label: z.string().trim().optional(),
});

/**
 * Reads `site_settings` key "announcement" (where is_public = true).
 * Returns null whenever disabled, absent, or unreadable.
 */
export async function getSiteAnnouncement(): Promise<SiteAnnouncement | null> {
  const client = getSupabaseBrowserClient();
  if (!client) return null;
  try {
    const { data, error } = await client
      .from('site_settings')
      .select('value, is_public')
      .eq('key', 'announcement')
      .eq('is_public', true)
      .maybeSingle();

    if (error || !data?.value) return null;
    const rawVal = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
    const parsed = SiteAnnouncementSchema.safeParse(rawVal);
    if (!parsed.success || !parsed.data.enabled) return null;
    const message = parsed.data.message || parsed.data.text;
    if (!message) return null;

    return {
      enabled: true,
      message,
      href: parsed.data.href,
      label: parsed.data.label,
    };
  } catch {
    return null;
  }
}
