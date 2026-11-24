import { test } from 'vitest';
import assert from 'node:assert/strict';
import { contrastRatio, wcagGrade } from '../contrast';
import { accentToTileVariant, formatPrice, getProductDescription } from './format';
import { querySeedProducts } from './repository';
import { SEED_COLLECTIONS, SEED_PRODUCTS } from './seed';
import { CollectionSchema, ProductSchema } from './types';

test('formatPrice formats integer USD cents cleanly', () => {
  assert.equal(formatPrice(0), '$0');
  assert.equal(formatPrice(4900), '$49');
  assert.equal(formatPrice(2450), '$24.50');
  assert.equal(formatPrice(12999), '$129.99');
  assert.equal(formatPrice(-100), '$0');
});

test('accentToTileVariant maps all collection accents accurately', () => {
  assert.equal(accentToTileVariant('apricot'), 'tint-peach');
  assert.equal(accentToTileVariant('butter'), 'tint-butter');
  assert.equal(accentToTileVariant('lilac'), 'tint-lilac');
  assert.equal(accentToTileVariant('rose'), 'tint-rose');
  assert.equal(accentToTileVariant('cocoa'), 'stone');
});

test('getProductDescription falls back to short_description when description is null', () => {
  assert.equal(
    getProductDescription({ description: null, short_description: 'Short fallback text.' }),
    'Short fallback text.'
  );
  assert.equal(
    getProductDescription({ description: 'Full text.', short_description: 'Short text.' }),
    'Full text.'
  );
});

test('seed catalogue has exact 4 collections and 20 valid products with zero forbidden copy', () => {
  assert.equal(SEED_COLLECTIONS.length, 4);
  assert.equal(SEED_PRODUCTS.length, 20);

  for (const col of SEED_COLLECTIONS) {
    assert.equal(CollectionSchema.safeParse(col).success, true, `Invalid collection ${col.slug}`);
  }

  for (const prod of SEED_PRODUCTS) {
    assert.equal(ProductSchema.safeParse(prod).success, true, `Invalid product ${prod.slug}`);
    const combinedText = `${prod.name} ${prod.tagline ?? ''} ${prod.short_description ?? ''} ${prod.description ?? ''}`.toLowerCase();
    assert.equal(combinedText.includes('studio'), false, `Forbidden word found in ${prod.slug}`);
  }
});

test('querySeedProducts filters by collection, format, price, query and sorts deterministically', () => {
  const shopCol = querySeedProducts({ collection: 'run-the-shop', pageSize: 20 });
  assert.equal(shopCol.total, 7);
  assert.equal(shopCol.isPreviewData, true);

  const figmaOnly = querySeedProducts({ formats: ['Figma'], pageSize: 20 });
  assert.ok(figmaOnly.total >= 4);
  assert.ok(figmaOnly.items.every((p) => p.file_formats.includes('Figma')));

  const priceAsc = querySeedProducts({ sort: 'price-asc', pageSize: 20 });
  for (let i = 1; i < priceAsc.items.length; i++) {
    assert.ok(priceAsc.items[i].price_cents >= priceAsc.items[i - 1].price_cents);
  }

  const searchHit = querySeedProducts({ q: 'cultivation' });
  assert.equal(searchHit.total, 1);
  assert.equal(searchHit.items[0].slug, 'cultivation-universe-builder');
});

test('Porcelain & Pop core text/background pairs meet WCAG AA contrast requirements', () => {
  assert.ok(contrastRatio('#111111', '#F4F2EE') >= 15);
  assert.ok(contrastRatio('#111111', '#FFFFFF') >= 18);
  assert.ok(contrastRatio('#55524D', '#FFFFFF') >= 7);
  assert.ok(contrastRatio('#55524D', '#F4F2EE') >= 6.5);
  assert.ok(contrastRatio('#C93A0A', '#FFFFFF') >= 4.5);
  assert.equal(wcagGrade(contrastRatio('#C93A0A', '#FFFFFF')), 'AA');
  assert.ok(contrastRatio('#F4F2EE', '#111111') >= 15);
  assert.ok(contrastRatio('#111111', '#FFD9C4') >= 12);
  assert.ok(contrastRatio('#111111', '#FFEFA8') >= 14);
  assert.ok(contrastRatio('#111111', '#DDD3FF') >= 12);
  assert.ok(contrastRatio('#111111', '#FFD3DE') >= 12);
});


test('ProductSchema accepts representative live Postgres nullable fields and text arrays', () => {
  const liveRow = {
    id: '73f0d1ea-1b21-4a88-92b6-51aa6c5d8f10',
    slug: 'live-supabase-product',
    sku: 'LIVE-001',
    name: 'Live Supabase Product',
    tagline: null,
    short_description: null,
    description: null,
    collection_id: 'bc6b4813-7a70-4d77-97e3-4f95c85e8fb7',
    price_cents: 4900,
    currency: 'USD',
    status: 'published',
    is_featured: false,
    featured_rank: null,
    tags: ['live', 'catalogue'],
    file_formats: ['XLSX', 'PDF'],
    includes: ['Workbook', 'Readme'],
    audience: ['Operators'],
    requirements: null,
    first_hour: ['Open the workbook', 'Review the dashboard'],
    cover_path: null,
    version: null,
    seo_title: null,
    seo_description: null,
    image_prompt: null,
    published_at: null,
  };
  const parsed = ProductSchema.safeParse(liveRow);
  assert.equal(parsed.success, true, parsed.success ? undefined : JSON.stringify(parsed.error.issues));
  if (parsed.success) {
    assert.equal(parsed.data.description, null);
    assert.deepEqual(parsed.data.tags, ['live', 'catalogue']);
    assert.deepEqual(parsed.data.first_hour, ['Open the workbook', 'Review the dashboard']);
    assert.equal(parsed.data.cover_path, null);
    assert.equal(parsed.data.published_at, null);
  }
});

test('ProductSchema normalizes nullable Postgres text[] fields to empty arrays', () => {
  const parsed = ProductSchema.safeParse({
    id: '73f0d1ea-1b21-4a88-92b6-51aa6c5d8f10',
    slug: 'null-arrays',
    sku: 'LIVE-002',
    name: 'Nullable arrays',
    price_cents: 1900,
    status: 'published',
    tags: null,
    file_formats: null,
    includes: null,
    audience: null,
    first_hour: null,
  });
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.deepEqual(parsed.data.tags, []);
    assert.deepEqual(parsed.data.file_formats, []);
    assert.deepEqual(parsed.data.includes, []);
    assert.deepEqual(parsed.data.audience, []);
    assert.deepEqual(parsed.data.first_hour, []);
  }
});
