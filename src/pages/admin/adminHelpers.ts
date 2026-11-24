import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { processImage, buildProductMediaBasePath, getProductMediaVariantPath } from '../../lib/media/imagePipeline';
import type { Product, Collection, ProductMedia } from '../../lib/data/types';

export const ProductDraftSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase words separated by hyphens.').max(140),
  sku: z.string().trim().min(2).max(64),
  tagline: z.string().trim().max(180),
  short_description: z.string().trim().min(12).max(320),
  description: z.string().trim().max(12000),
  collection_id: z.string().uuid(),
  price_usd: z.string().trim().regex(/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/, 'Enter a dollar amount with up to two decimal places.'),
  tags: z.string().max(1000),
  file_formats: z.string().max(500),
  includes: z.string().max(3000),
  audience: z.string().max(1000),
  requirements: z.string().max(1500),
  first_hour: z.string().max(2000),
  seo_title: z.string().trim().max(70),
  seo_description: z.string().trim().max(180),
  is_featured: z.boolean(),
  featured_rank: z.string().trim(),
  status: z.enum(['draft', 'review', 'published', 'archived']),
});
export type ProductDraft = z.infer<typeof ProductDraftSchema>;

export const ImageUploadSchema = z.object({
  name: z.string().min(1),
  size: z.number().int().positive().max(10 * 1024 * 1024, 'Images must be 10 MB or smaller.'),
  type: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/avif'], {
    error: 'Choose a JPG, PNG, WebP or AVIF image.',
  }),
});

export function emptyProductDraft(collectionId: string): ProductDraft {
  return {
    name: '',
    slug: '',
    sku: '',
    tagline: '',
    short_description: '',
    description: '',
    collection_id: collectionId,
    price_usd: '19.00',
    tags: '',
    file_formats: '',
    includes: '',
    audience: '',
    requirements: '',
    first_hour: '',
    seo_title: '',
    seo_description: '',
    is_featured: false,
    featured_rank: '',
    status: 'draft',
  };
}

export function productToDraft(product: Product): ProductDraft {
  return {
    name: product.name || '',
    slug: product.slug || '',
    sku: product.sku || '',
    tagline: product.tagline || '',
    short_description: product.short_description || '',
    description: product.description || '',
    collection_id: product.collection_id || '',
    price_usd: (product.price_cents / 100).toFixed(2),
    tags: (product.tags || []).join(', '),
    file_formats: (product.file_formats || []).join(', '),
    includes: (product.includes || []).join('\n'),
    audience: (product.audience || []).join(', '),
    requirements: product.requirements || '',
    first_hour: (product.first_hour || []).join('\n'),
    seo_title: product.seo_title || '',
    seo_description: product.seo_description || '',
    is_featured: Boolean(product.is_featured),
    featured_rank: product.featured_rank == null ? '' : String(product.featured_rank),
    status: product.status || 'draft',
  };
}

export function listFromInput(value: string): string[] {
  return value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
}

export function toProductPayload(draft: ProductDraft): Record<string, unknown> {
  const dollars = Number(draft.price_usd);
  const cents = Math.round(dollars * 100);
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error('Enter a valid price in USD.');
  const rank = draft.featured_rank === '' ? null : Number(draft.featured_rank);
  if (rank !== null && (!Number.isSafeInteger(rank) || rank < 0 || rank > 100000)) {
    throw new Error('Featured rank must be a whole number from 0 to 100000.');
  }
  return {
    name: draft.name,
    slug: draft.slug,
    sku: draft.sku,
    tagline: draft.tagline || null,
    short_description: draft.short_description,
    description: draft.description || null,
    collection_id: draft.collection_id,
    price_cents: cents,
    currency: 'USD',
    status: draft.status,
    is_featured: draft.is_featured,
    featured_rank: rank,
    tags: listFromInput(draft.tags),
    file_formats: listFromInput(draft.file_formats),
    includes: listFromInput(draft.includes),
    audience: listFromInput(draft.audience),
    requirements: draft.requirements || null,
    first_hour: listFromInput(draft.first_hour),
    seo_title: draft.seo_title || null,
    seo_description: draft.seo_description || null,
  };
}

export function slugify(value: string): string {
  return value.toLowerCase().trim().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function formatUsd(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

export function buildCoverPrompt(product: Product, collection: Collection | null, imageBrief = ''): string {
  const accent = collection?.accent || 'cocoa';
  const backdrops: Record<string, string> = {
    apricot: 'a flat warm peach backdrop (#FFD9C4)',
    butter: 'a flat pale butter-yellow backdrop (#FFEFA8)',
    lilac: 'a flat soft lilac backdrop (#DDD3FF)',
    rose: 'a flat muted rose backdrop (#FFD3DE)',
    cocoa: 'a flat warm stone backdrop (#EDEAE5)',
  };
  const brief = imageBrief.trim() || product.image_prompt?.trim() || 'a composed, tactile arrangement of practical creative tools and carefully finished materials';
  return [
    'Create a premium editorial product-cover still life for a downloadable digital product.',
    'Product: ' + product.name + '.',
    'Context: ' + (product.tagline || product.short_description || ''),
    'Visual direction: ' + brief + '.',
    'Composition: portrait 4:5, single clear hero object with two restrained supporting objects, generous negative space, precise soft studio lighting, realistic material texture, subtle contact shadows.',
    'Backdrop: ' + backdrops[accent] + '.',
    'Style: refined art direction, sculptural still life, high-end print editorial, restrained colour, no gradients.',
    'Absolutely no text, letters, numbers, labels, logos, watermarks or UI. Keep all objects fully inside the frame.',
  ].join(' ');
}

export async function generateAdminImage(
  accessToken: string,
  productId: string,
  prompt: string,
  model?: string,
  referenceImageBase64?: string
): Promise<{ imageBase64: string; mimeType: string; modelUsed: string }> {
  const response = await fetch('/api/admin/image/generate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + accessToken,
    },
    body: JSON.stringify({
      productId,
      prompt,
      model,
      referenceImageBase64,
      edit: Boolean(referenceImageBase64),
    }),
  });
  const body = await response.json().catch(() => ({})) as {
    imageBase64?: string;
    mimeType?: string;
    modelUsed?: string;
    error?: string;
    code?: string;
    retryAfterSeconds?: number;
  };
  if (!response.ok || !body.imageBase64 || !body.mimeType) {
    const message = body.error || 'Gemini could not generate this image.';
    if (response.status === 429) throw new Error('Image generation rate limit reached. Retry in ' + (body.retryAfterSeconds || 60) + ' seconds.');
    if (body.code === 'TEXT_ONLY_RESPONSE') throw new Error('Gemini returned text without an image. Adjust the art direction and try again.');
    if (/safety|blocked|policy/i.test(message)) throw new Error('Gemini blocked this request for safety. Change the art direction and retry.');
    throw new Error(message);
  }
  return {
    imageBase64: body.imageBase64,
    mimeType: body.mimeType,
    modelUsed: body.modelUsed || model || 'gemini-3.1-flash-image',
  };
}

export function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mimeType });
}

export async function storeProductImage(
  client: SupabaseClient,
  product: Product,
  image: Blob | File,
  alt: string,
  source: 'upload' | 'gemini',
  setAsCover: boolean
): Promise<ProductMedia> {
  const cleanAlt = alt.trim();
  if (!cleanAlt) throw new Error('Add descriptive alt text before saving this image.');
  const processed = await processImage(image);
  const mediaId = crypto.randomUUID();
  const basePath = buildProductMediaBasePath(product.id, mediaId);
  const storage = client.storage.from('product-media');
  const uploadedPaths: string[] = [];

  try {
    for (const item of processed.variants) {
      const objectPath = getProductMediaVariantPath(basePath, item.variant);
      const { error } = await storage.upload(objectPath, item.blob, {
        contentType: 'image/webp',
        cacheControl: '31536000',
        upsert: false,
      });
      if (error) throw error;
      uploadedPaths.push(objectPath);
    }

    if (setAsCover) {
      const { error: clearError } = await client
        .from('product_media')
        .update({ kind: 'gallery' })
        .eq('product_id', product.id)
        .eq('kind', 'cover');
      if (clearError) throw clearError;
    }

    const { data, error: insertError } = await client
      .from('product_media')
      .insert({
        id: mediaId,
        product_id: product.id,
        storage_path: basePath,
        kind: setAsCover ? 'cover' : 'gallery',
        alt: cleanAlt,
        width: processed.width,
        height: processed.height,
        source,
        sort_order: Date.now(),
      })
      .select('*')
      .single();
    if (insertError || !data) throw insertError || new Error('Image metadata was not saved.');

    if (setAsCover) {
      const { error: coverError } = await client
        .from('products')
        .update({ cover_path: basePath })
        .eq('id', product.id);
      if (coverError) throw coverError;
    }
    return data as ProductMedia;
  } catch (error) {
    if (uploadedPaths.length) await storage.remove(uploadedPaths).catch(() => undefined);
    throw error;
  }
}

export async function uploadCollectionImage(
  client: SupabaseClient,
  collectionId: string,
  image: File
): Promise<string> {
  const validation = ImageUploadSchema.safeParse(image);
  if (!validation.success) throw new Error(validation.error.issues[0]?.message || 'Choose a supported image.');
  const processed = await processImage(image);
  const mediaId = crypto.randomUUID();
  const basePath = 'collections/' + collectionId + '/' + mediaId;
  const storage = client.storage.from('product-media');
  for (const item of processed.variants) {
    const path = getProductMediaVariantPath(basePath, item.variant);
    const { error } = await storage.upload(path, item.blob, {
      contentType: 'image/webp',
      cacheControl: '31536000',
      upsert: false,
    });
    if (error) throw error;
  }
  return basePath;
}
