import { Router } from 'express';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getPublicServerConfig } from '../lib/config.ts';

export const seoRouter = Router();

type SitemapRow = { slug: string; published_at?: string | null };
type SitemapCache = { expiresAt: number; body: string };
let sitemapCache: SitemapCache | null = null;
let anonClient: SupabaseClient | null = null;

function getPublicSupabase(): SupabaseClient | null {
  if (anonClient) return anonClient;
  const url = (process.env.SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_PUBLISHABLE_KEY || '').trim();
  if (!url || !key) return null;
  anonClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { 'X-Kinvai-SEO': 'server-render' } },
  });
  return anonClient;
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

seoRouter.get('/robots.txt', (_req, res) => {
  const { siteUrl } = getPublicServerConfig();
  const lines = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /account',
    'Disallow: /admin',
    'Disallow: /checkout',
    'Disallow: /api',
    'Disallow: /design',
    'Disallow: /saved',
    'Disallow: /auth',
    'Disallow: /cart-redirect',
    '',
    'Sitemap: ' + siteUrl + '/sitemap.xml',
  ];
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60');
  res.type('text/plain').send(lines.join('\n'));
});

seoRouter.get('/sitemap.xml', async (_req, res) => {
  const { siteUrl } = getPublicServerConfig();
  if (sitemapCache && sitemapCache.expiresAt > Date.now()) {
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60');
    res.type('application/xml').send(sitemapCache.body);
    return;
  }

  const staticPaths = ['/', '/shop', '/collections', '/about', '/how-it-works', '/support', '/licence', '/legal/privacy', '/legal/terms', '/legal/refunds'];
  const urls = staticPaths.map((pathname) => {
    const loc = escapeXml(siteUrl + (pathname === '/' ? '/' : pathname));
    return '  <url><loc>' + loc + '</loc></url>';
  });

  const client = getPublicSupabase();
  if (client) {
    try {
      const [productResult, collectionResult] = await Promise.all([
        client.from('products').select('slug,published_at').eq('status', 'published').order('published_at', { ascending: false }),
        client.from('collections').select('slug').eq('is_active', true).order('sort_order', { ascending: true }),
      ]);
      if (!productResult.error && productResult.data) {
        for (const product of productResult.data as SitemapRow[]) {
          const loc = escapeXml(siteUrl + '/products/' + encodeURIComponent(product.slug));
          const lastmod = product.published_at ? '<lastmod>' + escapeXml(new Date(product.published_at).toISOString()) + '</lastmod>' : '';
          urls.push('  <url><loc>' + loc + '</loc>' + lastmod + '</url>');
        }
      }
      if (!collectionResult.error && collectionResult.data) {
        for (const collection of collectionResult.data as Array<{ slug: string }>) {
          const loc = escapeXml(siteUrl + '/collections/' + encodeURIComponent(collection.slug));
          urls.push('  <url><loc>' + loc + '</loc></url>');
        }
      }
    } catch (error) {
      console.error('[kinvai-seo] sitemap lookup failed:', error instanceof Error ? error.message : 'unknown');
    }
  }

  const body = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls.join('\n') + '\n</urlset>';
  sitemapCache = { body, expiresAt: Date.now() + 60_000 };
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60');
  res.type('application/xml').send(body);
});
