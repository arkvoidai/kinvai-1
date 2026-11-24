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
import { mapReviewSubmitError, rankRelatedProducts } from '../product/productHelpers';

function allowSeedFallback(): boolean {
  return getPublicConfig().flags.allowSeedFallback;
}

function logRepositoryValidation(label: string, error: z.ZodError): void {
  if (import.meta.env.DEV) {
    console.error(`[kinvai-data] Zod validation failed for ${label}.`, error.issues);
  }
}

function parseArray<T>(schema: z.ZodType<T>, raw: unknown, label = 'repository rows'): T[] {
  const result = z.array(schema).safeParse(raw);
  if (result.success) return result.data;

  // Report all invalid row paths clearly, then preserve otherwise-valid live rows.
  if (Array.isArray(raw)) {
    const valid: T[] = [];
    raw.forEach((item, index) => {
      const parsed = schema.safeParse(item);
      if (parsed.success) valid.push(parsed.data);
      else logRepositoryValidation(`${label}[${index}]`, parsed.error);
    });
    return valid;
  }

  logRepositoryValidation(label, result.error);
  return [];
}

function parseOne<T>(schema: z.ZodType<T>, raw: unknown, label: string): T | null {
  const parsed = schema.safeParse(raw);
  if (parsed.success) return parsed.data;
  logRepositoryValidation(label, parsed.error);
  return null;
}

function logRepositoryError(label: string, error: unknown): void {
  if (import.meta.env.DEV) {
    console.error(`[kinvai-data] ${label} failed.`, error);
  }
}

type BrowserSupabaseClient = NonNullable<ReturnType<typeof getSupabaseBrowserClient>>;

async function getPublishedProductCount(client: BrowserSupabaseClient): Promise<{ count: number | null; error?: string }> {
  const { count, error } = await client.from('products').select('id', { count: 'exact', head: true }).eq('status', 'published');
  return { count: error ? null : count ?? 0, ...(error ? { error: error.message || 'Could not count published products.' } : {}) };
}

async function getActiveCollectionCount(client: BrowserSupabaseClient): Promise<{ count: number | null; error?: string }> {
  const { count, error } = await client.from('collections').select('id', { count: 'exact', head: true }).eq('is_active', true);
  return { count: error ? null : count ?? 0, ...(error ? { error: error.message || 'Could not count active collections.' } : {}) };
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
      const { data, count, error } = await client.from('collections')
        .select('*', { count: 'exact' }).eq('is_active', true).order('sort_order', { ascending: true });
      if (error) {
        queryError = error.message || 'Could not load collections.';
        logRepositoryError('getCollections query', error);
        const live = await getActiveCollectionCount(client);
        if (live.error || (live.count ?? 0) > 0) {
          if (live.error) logRepositoryError('getCollections count', live.error);
          return { data: [], source: live.error ? 'empty' : 'supabase', isPreviewData: false, error: queryError };
        }
      } else if (data && data.length > 0) {
        const parsed = parseArray(CollectionSchema, data, 'collections');
        return { data: parsed, source: 'supabase', isPreviewData: false, ...(parsed.length < data.length ? { error: 'Some live collection rows could not be read.' } : {}) };
      } else if ((count ?? 0) > 0) {
        return { data: [], source: 'supabase', isPreviewData: false, error: 'Collections were counted but no rows were returned.' };
      } else queryError = undefined;
    } catch (err) {
      logRepositoryError('getCollections', err);
      queryError = err instanceof Error ? err.message : 'Could not load collections.';
      const live = await getActiveCollectionCount(client);
      if (live.error || (live.count ?? 0) > 0) return { data: [], source: live.error ? 'empty' : 'supabase', isPreviewData: false, error: queryError };
    }
  } else queryError = 'Supabase is not configured.';
  if (allowSeedFallback()) return { data: SEED_COLLECTIONS, source: 'seed', isPreviewData: true };
  return { data: [], source: 'empty', isPreviewData: false, error: queryError };
}

export async function getCollection(slug: string): Promise<DataEnvelope<Collection | null>> {
  const client = getSupabaseBrowserClient();
  let queryError: string | undefined;
  if (client) {
    try {
      const { data, error } = await client.from('collections').select('*').eq('slug', slug).eq('is_active', true).maybeSingle();
      if (error) {
        queryError = error.message || 'Could not load collection.';
        logRepositoryError('getCollection query', error);
        const live = await getActiveCollectionCount(client);
        if (live.error || (live.count ?? 0) > 0) return { data: null, source: live.error ? 'empty' : 'supabase', isPreviewData: false, error: queryError };
      } else if (data) {
        const parsed = parseOne(CollectionSchema, data, 'collection');
        return parsed ? { data: parsed, source: 'supabase', isPreviewData: false } : { data: null, source: 'supabase', isPreviewData: false, error: 'The collection data could not be read.' };
      } else {
        const live = await getActiveCollectionCount(client);
        if (live.error) {
          logRepositoryError('getCollection count', live.error);
          return { data: null, source: 'empty', isPreviewData: false, error: live.error };
        }
        if ((live.count ?? 0) > 0) return { data: null, source: 'supabase', isPreviewData: false };
      }
    } catch (err) {
      logRepositoryError('getCollection', err);
      queryError = err instanceof Error ? err.message : 'Could not load collection.';
      const live = await getActiveCollectionCount(client);
      if (live.error || (live.count ?? 0) > 0) return { data: null, source: live.error ? 'empty' : 'supabase', isPreviewData: false, error: queryError };
    }
  } else queryError = 'Supabase is not configured.';
  if (allowSeedFallback()) return { data: SEED_COLLECTIONS.find((c) => c.slug === slug) ?? null, source: 'seed', isPreviewData: true };
  return { data: null, source: 'empty', isPreviewData: false, error: queryError };
}

export async function getProducts(params: ProductQueryParams = {}): Promise<PaginatedProductsResult> {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.max(1, Math.min(48, params.pageSize ?? 12));
  const client = getSupabaseBrowserClient();
  let queryError: string | undefined;
  const hasFilters = Boolean(params.collection || params.collectionId || params.tags?.length || params.formats?.length || params.priceMin !== undefined || params.priceMax !== undefined || params.q?.trim());

  if (client) {
    try {
      const collectionValue = params.collection;
      const collectionIsUuid = Boolean(collectionValue && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(collectionValue));
      const useCollectionJoin = Boolean(collectionValue && !collectionIsUuid && !params.collectionId);
      let query = client.from('products')
        .select(useCollectionJoin ? '*, collection_filter:collections!inner(slug,is_active)' : '*', { count: 'exact' })
        .eq('status', 'published');

      if (params.collectionId) query = query.eq('collection_id', params.collectionId);
      else if (collectionValue && collectionIsUuid) query = query.eq('collection_id', collectionValue);
      else if (collectionValue) query = query.eq('collection_filter.slug', collectionValue).eq('collection_filter.is_active', true);

      if (params.tags?.length) query = query.overlaps('tags', params.tags);
      if (params.formats?.length) query = query.overlaps('file_formats', params.formats);
      if (typeof params.priceMin === 'number') query = query.gte('price_cents', params.priceMin);
      if (typeof params.priceMax === 'number') query = query.lte('price_cents', params.priceMax);
      if (params.q?.trim()) {
        const safeQ = params.q.trim().replace(/[,%()\\*']/g, ' ');
        query = query.or(`name.ilike.%${safeQ}%,sku.ilike.%${safeQ}%,tagline.ilike.%${safeQ}%,short_description.ilike.%${safeQ}%,description.ilike.%${safeQ}%`);
      }

      switch (params.sort) {
        case 'price-asc': query = query.order('price_cents', { ascending: true }); break;
        case 'price-desc': query = query.order('price_cents', { ascending: false }); break;
        case 'name-asc': query = query.order('name', { ascending: true }); break;
        case 'newest': query = query.order('published_at', { ascending: false, nullsFirst: false }); break;
        case 'featured':
        default:
          query = query.order('is_featured', { ascending: false }).order('featured_rank', { ascending: true, nullsFirst: false }).order('name', { ascending: true });
          break;
      }

      const from = (page - 1) * pageSize;
      const { data, count, error } = await query.range(from, from + pageSize - 1);
      if (error) {
        queryError = error.message || 'Could not load products.';
        logRepositoryError('getProducts query', error);
        const live = await getPublishedProductCount(client);
        if (live.error) {
          logRepositoryError('getProducts live count', live.error);
          return { items: [], total: 0, page, pageSize, totalPages: 1, source: 'empty', isPreviewData: false, error: queryError };
        }
        if ((live.count ?? 0) > 0) return { items: [], total: 0, page, pageSize, totalPages: 1, source: 'supabase', isPreviewData: false, error: queryError };
      } else if (data) {
        if (data.length > 0 || (count ?? 0) > 0 || hasFilters) {
          const parsed = parseArray(ProductSchema, data, 'products');
          const total = count ?? parsed.length;
          return { items: parsed, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)), source: 'supabase', isPreviewData: false, ...(parsed.length < data.length ? { error: 'Some live product rows could not be read. Check development console for row details.' } : {}) };
        }
        queryError = undefined;
      }
    } catch (err) {
      logRepositoryError('getProducts', err);
      queryError = err instanceof Error ? err.message : 'Could not load products.';
      const live = await getPublishedProductCount(client);
      if (live.error || (live.count ?? 0) > 0) return { items: [], total: 0, page, pageSize, totalPages: 1, source: live.error ? 'empty' : 'supabase', isPreviewData: false, error: queryError };
    }
  } else queryError = 'Supabase is not configured.';

  if (allowSeedFallback()) return querySeedProducts(params);
  return { items: [], total: 0, page, pageSize, totalPages: 1, source: 'empty', isPreviewData: false, error: queryError };
}

export async function getFeatured(limit = 6): Promise<DataEnvelope<Product[]>> {
  const client = getSupabaseBrowserClient();
  if (client) {
    try {
      const { data, error } = await client.from('products').select('*', { count: 'exact' })
        .eq('status', 'published').eq('is_featured', true)
        .order('featured_rank', { ascending: true, nullsFirst: false })
        .order('name', { ascending: true }).limit(Math.max(1, Math.min(48, limit)));
      if (error) {
        logRepositoryError('getFeatured query', error);
        const live = await getPublishedProductCount(client);
        if (live.error) return { data: [], source: 'empty', isPreviewData: false, error: error.message || live.error };
        if ((live.count ?? 0) > 0) return { data: [], source: 'supabase', isPreviewData: false, error: error.message || 'Featured products could not be loaded.' };
      } else if (data?.length) {
        const parsed = parseArray(ProductSchema, data, 'featured products');
        return { data: parsed, source: 'supabase', isPreviewData: false, ...(parsed.length < data.length ? { error: 'Some featured products could not be read.' } : {}) };
      } else {
        const live = await getPublishedProductCount(client);
        if (live.error) return { data: [], source: 'empty', isPreviewData: false, error: live.error };
        if ((live.count ?? 0) > 0) return { data: [], source: 'supabase', isPreviewData: false };
      }
    } catch (err) {
      logRepositoryError('getFeatured', err);
      const live = await getPublishedProductCount(client);
      if (live.error || (live.count ?? 0) > 0) return { data: [], source: live.error ? 'empty' : 'supabase', isPreviewData: false, error: err instanceof Error ? err.message : 'Featured products could not be loaded.' };
    }
  }
  if (allowSeedFallback()) {
    const featured = SEED_PRODUCTS.filter((p) => p.is_featured).sort((a, b) => (a.featured_rank ?? 999) - (b.featured_rank ?? 999)).slice(0, limit);
    return { data: featured, source: 'seed', isPreviewData: true };
  }
  return { data: [], source: 'empty', isPreviewData: false, error: client ? undefined : 'Supabase is not configured.' };
}

export async function getRelated(
  productId: string,
  limit = 4,
  currentProduct?: Pick<Product, 'id' | 'collection_id' | 'tags'> | null
): Promise<DataEnvelope<Product[]>> {
  const client = getSupabaseBrowserClient();
  let queryError: string | undefined;
  if (client) {
    try {
      const { data: relRows, error: relError } = await client.from('product_relations')
        .select('related_product_id, sort_order').eq('product_id', productId)
        .order('sort_order', { ascending: true }).limit(Math.max(1, Math.min(24, limit)));
      if (relError) {
        queryError = relError.message || 'Could not load product relations.';
        logRepositoryError('getRelated relations', relError);
      } else if (relRows?.length) {
        const ids = relRows.map((row) => String(row.related_product_id));
        const { data: prodRows, error: prodError } = await client.from('products').select('*').in('id', ids).eq('status', 'published');
        if (prodError) {
          queryError = prodError.message || 'Could not load related products.';
          logRepositoryError('getRelated products', prodError);
        } else if (prodRows) {
          const parsed = parseArray(ProductSchema, prodRows, 'related products');
          const ordered = ids.map((id) => parsed.find((p) => p.id === id)).filter((p): p is Product => Boolean(p));
          if (ordered.length) return { data: ordered, source: 'supabase', isPreviewData: false };
          if (prodRows.length) return { data: [], source: 'supabase', isPreviewData: false, error: 'Related product rows could not be read.' };
        }
      }
      if (currentProduct?.collection_id) {
        const { data: sameColRows, error: sameColErr } = await client.from('products').select('*')
          .eq('status', 'published').eq('collection_id', currentProduct.collection_id).neq('id', productId).limit(24);
        if (sameColErr) {
          queryError = sameColErr.message || 'Could not load same-collection products.';
          logRepositoryError('getRelated same collection', sameColErr);
        } else if (sameColRows?.length) {
          const parsed = parseArray(ProductSchema, sameColRows, 'same-collection related products');
          return { data: rankRelatedProducts(currentProduct, parsed, limit), source: 'supabase', isPreviewData: false, ...(parsed.length < sameColRows.length ? { error: 'Some related product rows could not be read.' } : {}) };
        }
      }
    } catch (err) {
      logRepositoryError('getRelated', err);
      queryError = err instanceof Error ? err.message : 'Could not load related products.';
    }
  }
  if (currentProduct) return { data: [], source: client ? 'supabase' : 'empty', isPreviewData: false, ...(queryError ? { error: queryError } : {}) };
  if (allowSeedFallback()) {
    const current = SEED_PRODUCTS.find((p) => p.id === productId);
    return { data: current ? rankRelatedProducts(current, SEED_PRODUCTS, limit) : [], source: 'seed', isPreviewData: true };
  }
  return { data: [], source: 'empty', isPreviewData: false, ...(queryError ? { error: queryError } : {}) };
}

export async function getProductBySlug(
  slug: string,
  options?: { userId?: string | null; isAdmin?: boolean }
): Promise<DataEnvelope<ProductDetail | null>> {
  const client = getSupabaseBrowserClient();
  let queryError: string | undefined;
  if (client) {
    try {
      const allowedStatuses = options?.userId || options?.isAdmin ? ['published', 'archived'] : ['published'];
      const { data: prodRow, error } = await client.from('products')
        .select('*, collection:collections!products_collection_id_fkey(*), media:product_media!product_media_product_id_fkey(*), relations:product_relations!product_relations_product_id_fkey(related_product_id, sort_order, related:products!product_relations_related_product_id_fkey(*))')
        .eq('slug', slug).in('status', allowedStatuses).maybeSingle();

      if (error) {
        queryError = error.message || 'Could not load product.';
        logRepositoryError('getProductBySlug query', error);
      } else if (prodRow) {
        const product = parseOne(ProductSchema, prodRow, 'product detail');
        if (!product) return { data: null, source: 'supabase', isPreviewData: false, error: 'The product data could not be read.' };
        if (product.status === 'archived') {
          const hasAccess = Boolean(options?.isAdmin) || (options?.userId ? await isOwned(options.userId, product.id) : false);
          if (!hasAccess) return { data: null, source: 'supabase', isPreviewData: false };
        }

        const collection = prodRow.collection ? parseOne(CollectionSchema, prodRow.collection, 'product collection') : null;
        const media = Array.isArray(prodRow.media)
          ? parseArray(ProductMediaSchema, prodRow.media, 'product media').sort((a, b) => a.sort_order - b.sort_order)
          : [];
        const relationSchema = z.array(z.object({ sort_order: z.number().int().optional(), related: ProductSchema.nullable().optional() }));
        const relationRows = relationSchema.safeParse(prodRow.relations ?? []);
        const embeddedRelated = relationRows.success
          ? relationRows.data.filter((row) => row.related?.status === 'published')
              .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
              .map((row) => row.related).filter((row): row is Product => Boolean(row))
          : [];
        if (!relationRows.success) logRepositoryValidation('product relation rows', relationRows.error);

        const [related, stats, reviews, userReview] = await Promise.all([
          embeddedRelated.length
            ? Promise.resolve({ data: embeddedRelated.slice(0, 4), source: 'supabase' as const, isPreviewData: false })
            : getRelated(product.id, 4, product),
          getRatingStats(product.id),
          getApprovedReviews(product.id),
          options?.userId ? getUserProductReview(options.userId, product.id) : Promise.resolve(null),
        ]);
        return {
          data: { product, collection, media, related: related.data, ratingStats: stats, reviews, userReview },
          source: 'supabase',
          isPreviewData: false,
          ...(related.error ? { error: related.error } : {}),
        };
      } else {
        const live = await getPublishedProductCount(client);
        if (live.error) {
          logRepositoryError('getProductBySlug published count', live.error);
          return { data: null, source: 'empty', isPreviewData: false, error: queryError || live.error };
        }
        if ((live.count ?? 0) > 0) return { data: null, source: 'supabase', isPreviewData: false, ...(queryError ? { error: queryError } : {}) };
      }
    } catch (err) {
      logRepositoryError('getProductBySlug', err);
      queryError = err instanceof Error ? err.message : 'Could not load product.';
      const live = await getPublishedProductCount(client);
      if (live.error || (live.count ?? 0) > 0) return { data: null, source: live.error ? 'empty' : 'supabase', isPreviewData: false, error: queryError };
    }
  } else queryError = 'Supabase is not configured.';

  if (allowSeedFallback()) {
    const product = SEED_PRODUCTS.find((p) => p.slug === slug);
    if (!product) return { data: null, source: 'seed', isPreviewData: true };
    const collection = SEED_COLLECTIONS.find((c) => c.id === product.collection_id) ?? null;
    return { data: { product, collection, media: [], related: rankRelatedProducts(product, SEED_PRODUCTS, 4), ratingStats: null, reviews: [], userReview: null }, source: 'seed', isPreviewData: true };
  }
  return { data: null, source: 'empty', isPreviewData: false, error: queryError };
}

export async function searchProducts(
  queryText: string,
  limit = 12,
  signal?: AbortSignal
): Promise<DataEnvelope<Product[]>> {
  const q = queryText.trim();
  if (!q || signal?.aborted) return { data: [], source: 'empty', isPreviewData: false };
  const client = getSupabaseBrowserClient();
  let queryError: string | undefined;
  const safeQ = q.replace(/[,%()\\*']/g, ' ').replace(/\s+/g, ' ').trim();
  const safeLimit = Math.max(1, Math.min(48, limit));
  if (client) {
    try {
      const rpcQuery = client.rpc('search_products', { p_query: q, p_limit: safeLimit });
      if (signal && typeof rpcQuery.abortSignal === 'function') rpcQuery.abortSignal(signal);
      const { data, error } = await rpcQuery;
      if (signal?.aborted) return { data: [], source: 'empty', isPreviewData: false };
      if (!error && Array.isArray(data)) {
        const parsed = parseArray(ProductSchema, data, 'search_products RPC');
        return { data: parsed, source: 'supabase', isPreviewData: false, ...(parsed.length < data.length ? { error: 'Some search results could not be read.' } : {}) };
      }
      queryError = error?.message || 'Search RPC returned an unexpected response.';
      if (error) logRepositoryError('searchProducts RPC; trying live-table search', error);

      if (!safeQ) return { data: [], source: 'supabase', isPreviewData: false };
      let directQuery = client.from('products').select('*').eq('status', 'published')
        .or(`name.ilike.%${safeQ}%,sku.ilike.%${safeQ}%,tagline.ilike.%${safeQ}%,short_description.ilike.%${safeQ}%,description.ilike.%${safeQ}%`)
        .order('is_featured', { ascending: false }).order('featured_rank', { ascending: true, nullsFirst: false })
        .order('name', { ascending: true }).limit(safeLimit);
      if (signal && typeof directQuery.abortSignal === 'function') directQuery.abortSignal(signal);
      const { data: rows, error: directError } = await directQuery;
      if (signal?.aborted) return { data: [], source: 'empty', isPreviewData: false };
      if (!directError && rows) {
        const parsed = parseArray(ProductSchema, rows, 'direct product search');
        return { data: parsed, source: 'supabase', isPreviewData: false, ...(parsed.length < rows.length ? { error: 'Some live search results could not be read.' } : {}) };
      }
      if (directError) {
        queryError = directError.message || queryError;
        logRepositoryError('searchProducts direct query', directError);
      }
      const live = await getPublishedProductCount(client);
      if (signal?.aborted) return { data: [], source: 'empty', isPreviewData: false };
      if (live.error) {
        logRepositoryError('searchProducts published count', live.error);
        return { data: [], source: 'empty', isPreviewData: false, error: queryError || live.error };
      }
      if ((live.count ?? 0) > 0) return { data: [], source: 'supabase', isPreviewData: false, error: queryError };
    } catch (err) {
      if (signal?.aborted) return { data: [], source: 'empty', isPreviewData: false };
      logRepositoryError('searchProducts', err);
      queryError = err instanceof Error ? err.message : 'Search could not be completed.';
      const live = await getPublishedProductCount(client);
      if (signal?.aborted) return { data: [], source: 'empty', isPreviewData: false };
      if (live.error || (live.count ?? 0) > 0) return { data: [], source: live.error ? 'empty' : 'supabase', isPreviewData: false, error: queryError };
    }
  } else queryError = 'Supabase is not configured.';

  if (allowSeedFallback()) {
    const result = querySeedProducts({ q, pageSize: safeLimit });
    return { data: result.items, source: 'seed', isPreviewData: true };
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

    if (error) { logRepositoryError('getRatingStats query', error); return null; }
    if (!data) return null;
    const parsed = parseOne(RatingStatsSchema, data, 'product rating stats');
    if (!parsed || parsed.review_count === 0) return null;
    return parsed;
  } catch (err) {
    logRepositoryError('getRatingStats', err);
    return null;
  }
}

export async function getApprovedReviews(productId: string): Promise<Review[]> {
  const client = getSupabaseBrowserClient();
  if (!client) return [];
  try {
    const { data, error } = await client
      .from('reviews')
      .select('id, user_id, product_id, rating, title, body, status, created_at')
      .eq('product_id', productId)
      .eq('status', 'approved')
      .order('created_at', { ascending: false });

    if (error) { logRepositoryError('getApprovedReviews query', error); return []; }
    if (!data) return [];
    return parseArray(ReviewSchema, data, 'approved reviews');
  } catch (err) {
    logRepositoryError('getApprovedReviews', err);
    return [];
  }
}

export async function getUserProductReview(
  userId: string,
  productId: string
): Promise<Review | null> {
  const client = getSupabaseBrowserClient();
  if (!client || !userId || !productId) return null;
  try {
    const { data, error } = await client
      .from('reviews')
      .select('id, user_id, product_id, rating, title, body, status, created_at')
      .eq('user_id', userId)
      .eq('product_id', productId)
      .maybeSingle();
    if (error) {
      logRepositoryError('getUserProductReview query', error);
      return null;
    }
    if (!data) return null;
    return parseOne(ReviewSchema, data, 'user product review');
  } catch (err) {
    logRepositoryError('getUserProductReview', err);
    return null;
  }
}

export interface SubmitReviewResult {
  review: Review | null;
  error?: string;
}

export async function submitProductReview(input: {
  userId: string;
  productId: string;
  rating: number;
  title: string;
  body: string;
}): Promise<SubmitReviewResult> {
  const client = getSupabaseBrowserClient();
  if (!client) {
    return {
      review: null,
      error: "That didn't work. Try again, or write to heyarkvoid@gmail.com.",
    };
  }

  const rating = Math.max(1, Math.min(5, Math.round(input.rating)));
  const cleanTitle = input.title.trim();
  const cleanBody = input.body.trim();

  if (!cleanTitle || !cleanBody) {
    return {
      review: null,
      error: 'Add both a short title and your review before submitting.',
    };
  }

  try {
    const { data, error } = await client
      .from('reviews')
      .insert({
        user_id: input.userId,
        product_id: input.productId,
        rating,
        title: cleanTitle,
        body: cleanBody,
        status: 'pending',
      })
      .select('id, user_id, product_id, rating, title, body, status, created_at')
      .maybeSingle();

    if (error) {
      return {
        review: null,
        error: mapReviewSubmitError({ code: error.code, message: error.message }),
      };
    }

    const parsed = data ? parseOne(ReviewSchema, data, 'submitted product review') : null;
    return {
      review: parsed
        ? parsed
        : {
            user_id: input.userId,
            product_id: input.productId,
            rating,
            title: cleanTitle,
            body: cleanBody,
            status: 'pending',
            created_at: new Date().toISOString(),
          },
    };
  } catch (err) {
    logRepositoryError('submitProductReview', err);
    return {
      review: null,
      error: mapReviewSubmitError(
        err instanceof Error ? { message: err.message } : undefined
      ),
    };
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

    if (error) { logRepositoryError('getRecentApprovedReviews query', error); return []; }
    if (!data) return [];
    return parseArray(ReviewSchema, data, 'reviews');
  } catch (err) {
    logRepositoryError('getRecentApprovedReviews', err);
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

    if (error) { logRepositoryError('getLibrary query', error); return []; }
    if (!data) return [];
    return parseArray(EntitlementSchema, data, 'library entitlements');
  } catch (err) {
    logRepositoryError('getLibrary', err);
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

    if (error) { logRepositoryError('getWishlist query', error); return []; }
    if (!data) return [];
    return parseArray(WishlistItemSchema, data, 'wishlist items');
  } catch (err) {
    logRepositoryError('getWishlist', err);
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

    if (error) { logRepositoryError('isOwned query', error); return false; }
    return Boolean(data);
  } catch (err) {
    logRepositoryError('isOwned', err);
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
