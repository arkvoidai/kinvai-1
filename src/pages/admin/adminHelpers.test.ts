import { describe, expect, it } from 'vitest';
import {
  ProductDraftSchema,
  buildCoverPrompt,
  emptyProductDraft,
  listFromInput,
  slugify,
  toProductPayload,
} from './adminHelpers';

const validDraft = () => ({
  ...emptyProductDraft('123e4567-e89b-12d3-a456-426614174000'),
  name: 'A useful system',
  slug: 'a-useful-system',
  sku: 'KV-SYSTEM-001',
  short_description: 'A complete working system for a focused workflow.',
  price_usd: '19.95',
});

describe('owner product editor helpers', () => {
  it('converts a validated USD decimal into integer cents', () => {
    const payload = toProductPayload(validDraft());
    expect(payload.price_cents).toBe(1995);
    expect(payload.currency).toBe('USD');
  });

  it('rejects malformed dollar prices instead of rounding arbitrary precision', () => {
    expect(ProductDraftSchema.safeParse({ ...validDraft(), price_usd: '19.999' }).success).toBe(false);
    expect(ProductDraftSchema.safeParse({ ...validDraft(), price_usd: '-2.00' }).success).toBe(false);
    expect(ProductDraftSchema.safeParse({ ...validDraft(), price_usd: '1e4' }).success).toBe(false);
  });

  it('requires a valid lowercase slug and required product identity fields', () => {
    expect(ProductDraftSchema.safeParse({ ...validDraft(), slug: 'Not valid' }).success).toBe(false);
    expect(ProductDraftSchema.safeParse({ ...validDraft(), sku: '' }).success).toBe(false);
  });

  it('splits tag-like values and line-based product contents without empty entries', () => {
    expect(listFromInput('one, two\nthree,,')).toEqual(['one', 'two', 'three']);
  });

  it('normalizes suggested slugs predictably', () => {
    expect(slugify('  Café & Focus Kit  ')).toBe('cafe-focus-kit');
  });

  it('creates a no-text cover prompt with collection-specific art direction', () => {
    const prompt = buildCoverPrompt({
      id: 'p1',
      name: 'Focus kit',
      slug: 'focus-kit',
      sku: 'FOCUS',
      price_cents: 1000,
      status: 'draft',
      is_featured: false,
      tags: [],
      file_formats: [],
      includes: [],
      audience: [],
      first_hour: [],
      collection_id: 'c1',
      currency: 'USD',
      image_prompt: null,
    } as never, {
      id: 'c1',
      name: 'Systems',
      slug: 'systems',
      tagline: 'Calm operations',
      story: null,
      accent: 'lilac',
      image_path: null,
      sort_order: 0,
      is_active: true,
    });
    expect(prompt).toContain('flat soft lilac backdrop');
    expect(prompt).toContain('no text, letters, numbers, labels, logos');
  });
});
