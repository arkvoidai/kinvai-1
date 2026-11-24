import compression from 'compression';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getPublicServerConfig, serializePublicConfigScript } from './lib/config.ts';
import { createRateLimitMiddleware } from './lib/rateLimit.ts';
import { adminImageRouter } from './routes/adminImage.ts';
import { adminRouter } from './routes/admin.ts';
import { downloadsRouter } from './routes/downloads.ts';
import { checkoutRouter } from './routes/checkout.ts';
import { ordersRouter } from './routes/orders.ts';
import { libraryRouter } from './routes/library.ts';
import { formsRouter } from './routes/forms.ts';
import { healthRouter } from './routes/health.ts';
import { mediaRouter } from './routes/media.ts';
import { paymentsRouter } from './routes/payments.ts';
import { seoRouter } from './routes/seo.ts';
import { webhooksRouter } from './routes/webhooks.ts';

const NOINDEX_PREFIXES = ['/design', '/admin', '/account', '/checkout', '/saved', '/cart-redirect', '/auth'];
const ROUTE_CACHE_TTL = 60_000;
const routeCache = new Map<string, { expiresAt: number; value: SeoResult }>();
let publicSeoClient: SupabaseClient | null = null;

interface SeoResult {
  title: string;
  description: string;
  canonical: string | null;
  ogImage: string | null;
  structuredData: unknown[];
  noindex: boolean;
  statusCode: number;
}

function isPreviewEnvironment(req: Request): boolean {
  const host = (req.headers.host || '').toLowerCase();
  const appUrl = (process.env.APP_URL || '').toLowerCase();
  return process.env.NODE_ENV !== 'production' || host.includes('localhost') || host.includes('127.0.0.1') || host.includes('.run.app') || appUrl.includes('.run.app');
}

function escapeHtmlAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeJsonForHtml(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function getPublicSeoClient(): SupabaseClient | null {
  if (publicSeoClient) return publicSeoClient;
  const url = (process.env.SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_PUBLISHABLE_KEY || '').trim();
  if (!url || !key) return null;
  publicSeoClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { 'X-Kinvai-SEO': 'html-meta' } },
  });
  return publicSeoClient;
}

function buildPublicCover1600Url(supabaseUrl: string, coverPath: string | null | undefined): string | null {
  if (!supabaseUrl || !coverPath) return null;
  const trimmed = coverPath.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const normalized = trimmed.replace(/^\/+/, '').replace(/\/+$/, '').replace(/\/(480|960|1600)\.webp$/i, '');
  return supabaseUrl.trim().replace(/\/+$/, '') + '/storage/v1/object/public/product-media/' + normalized + '/1600.webp';
}

function baseSeo(pathname: string, siteUrl: string): SeoResult {
  const noindex = NOINDEX_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix + '/'));
  const canonicalPath = pathname === '/' ? '/' : pathname.replace(/\/+$/, '');
  const canonical = noindex ? null : siteUrl + canonicalPath;
  const defaults: Record<string, { title: string; description: string }> = {
    '/': { title: 'Kinvai — The hard first draft, already done.', description: 'Spreadsheets, playbooks, templates and worlds, built properly once, so your project starts at step two.' },
    '/shop': { title: 'Shop ready-made digital systems — Kinvai', description: 'Browse downloadable spreadsheets, playbooks, templates, creative packs and worldbuilding collections from Kinvai.' },
    '/collections': { title: 'Four ways to get a head start — Kinvai', description: 'Explore Run the Shop, Make the Thing, Build the World and Ship the Interface.' },
    '/about': { title: 'About Kinvai — Built once, properly.', description: 'Why Kinvai exists, how downloadable products are prepared, and who is behind the store.' },
    '/how-it-works': { title: 'How it works — Kinvai', description: 'Choose a digital product, complete secure checkout and access the file from the Kinvai library.' },
    '/support': { title: 'Support — Kinvai', description: 'Find answers about orders, downloads, file formats and licences, or contact Arkvoid Inc.' },
    '/licence': { title: 'Licence — Kinvai', description: 'Personal and commercial use rights for downloadable Kinvai files.' },
    '/legal/privacy': { title: 'Privacy policy — Kinvai', description: 'Draft privacy information for Kinvai accounts, digital orders, downloads and essential storage.' },
    '/legal/terms': { title: 'Terms of service — Kinvai', description: 'Draft terms for access to Kinvai and purchases of downloadable digital products.' },
    '/legal/refunds': { title: 'Refund policy — Kinvai', description: 'Draft refund approach for digital purchases, defective files and payment issues.' },
    '/search': { title: 'Search the catalogue — Kinvai', description: 'Search downloadable systems, templates, spreadsheets and creative files at Kinvai.' },
  };
  const fallback = defaults[pathname] || { title: 'Kinvai — Ready-made digital systems', description: 'Downloadable digital products by Arkvoid Inc.' };
  const known = Boolean(defaults[pathname]) || /^\/(products|collections)\/[^/]+\/?$/.test(pathname) || noindex;
  return { ...fallback, canonical, ogImage: null, structuredData: [], noindex, statusCode: known ? 200 : 404 };
}

async function buildSeo(pathname: string): Promise<SeoResult> {
  const routePath = pathname === '/' ? '/' : pathname.replace(/\/+$/, '') || '/';
  const { siteUrl, supabaseUrl } = getPublicServerConfig();
  const cached = routeCache.get(routePath);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const result = baseSeo(routePath, siteUrl);
  const client = getPublicSeoClient();

  if (routePath === '/') {
    result.structuredData = [
      { '@context': 'https://schema.org', '@type': 'Organization', name: 'Kinvai', legalName: 'Arkvoid Inc.', url: siteUrl, email: 'heyarkvoid@gmail.com' },
      { '@context': 'https://schema.org', '@type': 'WebSite', name: 'Kinvai', url: siteUrl, potentialAction: { '@type': 'SearchAction', target: siteUrl + '/search?q={search_term_string}', 'query-input': 'required name=search_term_string' } },
    ];
  }

  const productMatch = pathname.match(/^\/products\/([^/]+)\/?$/);
  if (productMatch && client) {
    let slug = productMatch[1];
    try { slug = decodeURIComponent(slug); } catch { /* Keep the original route segment. */ }
    const { data: product, error } = await client.from('products')
      .select('id,slug,name,tagline,short_description,description,price_cents,currency,status,cover_path,seo_title,seo_description,published_at')
      .eq('slug', slug).eq('status', 'published').maybeSingle();

    if (!error && !product) {
      result.title = 'Page not found — Kinvai';
      result.description = 'The requested Kinvai product could not be found.';
      result.statusCode = 404;
      result.canonical = null;
      result.noindex = true;
    } else if (!error && product) {
      result.title = (product.seo_title || product.name + ' — Kinvai').slice(0, 180);
      result.description = (product.seo_description || product.short_description || product.tagline || 'Explore ' + product.name + ', a downloadable digital product from Kinvai.').slice(0, 320);
      result.ogImage = buildPublicCover1600Url(supabaseUrl, product.cover_path);
      result.canonical = siteUrl + '/products/' + encodeURIComponent(product.slug);
      const ratingResult = await client.from('product_rating_stats').select('review_count,avg_rating').eq('product_id', product.id).maybeSingle();
      const productJsonLd: Record<string, unknown> = {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: product.name,
        description: product.description || product.short_description || product.tagline || product.name,
        ...(result.ogImage ? { image: [result.ogImage] } : {}),
        offers: { '@type': 'Offer', priceCurrency: 'USD', price: (Number(product.price_cents || 0) / 100).toFixed(2), availability: 'https://schema.org/InStock', url: result.canonical },
      };
      if (!ratingResult.error && ratingResult.data && Number(ratingResult.data.review_count) > 0) {
        productJsonLd.aggregateRating = { '@type': 'AggregateRating', ratingValue: Number(ratingResult.data.avg_rating).toFixed(2), reviewCount: Number(ratingResult.data.review_count) };
      }
      const breadcrumb = {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl + '/' },
          { '@type': 'ListItem', position: 2, name: 'Shop', item: siteUrl + '/shop' },
          { '@type': 'ListItem', position: 3, name: product.name, item: result.canonical },
        ],
      };
      // Google structured-data guidance: describe only information visible on this product page.
      // https://developers.google.com/search/docs/appearance/structured-data/product-snippet
      result.structuredData = [productJsonLd, breadcrumb];
      result.statusCode = 200;
    }
  }

  const collectionMatch = pathname.match(/^\/collections\/([^/]+)\/?$/);
  if (collectionMatch && client) {
    let slug = collectionMatch[1];
    try { slug = decodeURIComponent(slug); } catch { /* Keep the original route segment. */ }
    const { data: collection, error } = await client.from('collections')
      .select('id,name,slug,tagline,story').eq('slug', slug).eq('is_active', true).maybeSingle();
    if (!error && !collection) {
      result.title = 'Page not found — Kinvai';
      result.description = 'The requested Kinvai collection could not be found.';
      result.statusCode = 404;
      result.canonical = null;
      result.noindex = true;
    } else if (!error && collection) {
      result.title = collection.name + ' — Kinvai collections';
      result.description = (collection.tagline || collection.story || 'Explore ' + collection.name + ' digital products from Kinvai.').slice(0, 320);
      result.canonical = siteUrl + '/collections/' + encodeURIComponent(collection.slug);
    }
  }

  if (routeCache.size > 300) {
    for (const [key, value] of routeCache) if (value.expiresAt <= Date.now()) routeCache.delete(key);
    if (routeCache.size > 300) routeCache.clear();
  }
  routeCache.set(routePath, { value: result, expiresAt: Date.now() + ROUTE_CACHE_TTL });
  return result;
}

function metaTag(html: string, attr: 'name' | 'property', key: string): string {
  const pattern = new RegExp('<meta\\s+(?=[^>]*\\b' + attr + '=["\\x27]' + key + '["\\x27])[^>]*>', 'gi');
  return html.replace(pattern, '');
}

async function injectHtml(template: string, pathname: string): Promise<{ html: string; statusCode: number }> {
  const pubConfig = getPublicServerConfig();
  const configScript = serializePublicConfigScript(pubConfig);
  const seo = await buildSeo(pathname);
  let html = template.replace(/<title[^>]*>[\s\S]*?<\/title>/i, '');
  for (const [attr, key] of [
    ['name', 'description'], ['name', 'robots'],
    ['property', 'og:title'], ['property', 'og:description'], ['property', 'og:type'], ['property', 'og:url'], ['property', 'og:image'],
    ['name', 'twitter:card'], ['name', 'twitter:title'], ['name', 'twitter:description'], ['name', 'twitter:image'],
  ] as Array<['name' | 'property', string]>) html = metaTag(html, attr, key);
  html = html.replace(/<link\s+rel=["\x27]canonical["\x27][^>]*>/gi, '');

  const tags = [
    '<title>' + escapeHtmlAttr(seo.title) + '</title>',
    '<meta name="description" content="' + escapeHtmlAttr(seo.description) + '" />',
    seo.canonical ? '<link rel="canonical" href="' + escapeHtmlAttr(seo.canonical) + '" />' : '',
    seo.noindex ? '<meta name="robots" content="noindex, nofollow" />' : '<meta name="robots" content="index, follow" />',
    '<meta property="og:title" content="' + escapeHtmlAttr(seo.title) + '" />',
    '<meta property="og:description" content="' + escapeHtmlAttr(seo.description) + '" />',
    '<meta property="og:type" content="' + (pathname.startsWith('/products/') ? 'product' : 'website') + '" />',
    '<meta property="og:url" content="' + escapeHtmlAttr(seo.canonical || pubConfig.siteUrl + pathname) + '" />',
    seo.ogImage ? '<meta property="og:image" content="' + escapeHtmlAttr(seo.ogImage) + '" />' : '',
    '<meta name="twitter:card" content="' + (seo.ogImage ? 'summary_large_image' : 'summary') + '" />',
    '<meta name="twitter:title" content="' + escapeHtmlAttr(seo.title) + '" />',
    '<meta name="twitter:description" content="' + escapeHtmlAttr(seo.description) + '" />',
    seo.ogImage ? '<meta name="twitter:image" content="' + escapeHtmlAttr(seo.ogImage) + '" />' : '',
    ...seo.structuredData.map((item) => '<script type="application/ld+json">' + escapeJsonForHtml(item) + '</script>'),
  ].filter(Boolean).join('\n    ');

  if (html.includes('<!--__KINVAI_SEO__-->')) html = html.replace('<!--__KINVAI_SEO__-->', tags);
  else html = html.replace('</head>', '    ' + tags + '\n  </head>');
  if (html.includes('<!--__KINVAI_CONFIG__-->')) html = html.replace('<!--__KINVAI_CONFIG__-->', configScript);
  else html = html.replace('</head>', '    ' + configScript + '\n  </head>');
  return { html, statusCode: seo.statusCode };
}

export async function createApp(): Promise<Express> {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (!isPreviewEnvironment(req)) res.setHeader('Content-Security-Policy', "frame-ancestors 'self'");
    next();
  });
  app.use(compression());

  // Raw-body parsing MUST precede express.json() for provider signature verification.
  app.use('/api/webhooks', webhooksRouter);
  const apiLimiter = createRateLimitMiddleware({ windowMs: 60_000, maxRequests: 120, keyPrefix: 'api' });
  app.use('/api', apiLimiter);
  app.use('/api/admin/image', adminImageRouter);
  app.use('/api/admin', adminRouter);
  app.use(express.json({ limit: '1mb' }));

  app.use(healthRouter);
  app.use(seoRouter);
  app.use('/api/checkout', checkoutRouter);
  app.use('/api/payments', paymentsRouter);
  app.use('/api/orders', ordersRouter);
  app.use('/api/library', libraryRouter);
  app.use('/api/download', downloadsRouter);
  app.use('/api/downloads', downloadsRouter);
  app.use('/api/media', mediaRouter);
  app.use('/api/forms', formsRouter);
  app.use('/api', formsRouter);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API endpoint not found.' }));

  const rootDir = process.cwd();
  const distDir = path.resolve(rootDir, 'dist');
  const isProd = process.env.NODE_ENV === 'production' && fs.existsSync(path.join(distDir, 'index.html'));

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'custom' });
    app.use(vite.middlewares);
    app.get('*', async (req, res, next) => {
      try {
        const url = req.originalUrl;
        const indexPath = path.resolve(rootDir, 'index.html');
        let template = fs.readFileSync(indexPath, 'utf-8');
        template = await vite.transformIndexHtml(url, template);
        const rendered = await injectHtml(template, req.path);
        res.status(rendered.statusCode).set({ 'Content-Type': 'text/html; charset=utf-8' }).end(rendered.html);
      } catch (err) {
        if (err instanceof Error) vite.ssrFixStacktrace(err);
        next(err);
      }
    });
  } else {
    app.use(express.static(distDir, { index: false, maxAge: '7d' }));
    const distIndexHtml = fs.readFileSync(path.join(distDir, 'index.html'), 'utf-8');
    app.get('*', async (req, res, next) => {
      try {
        const rendered = await injectHtml(distIndexHtml, req.path);
        res.status(rendered.statusCode).set({ 'Content-Type': 'text/html; charset=utf-8' }).end(rendered.html);
      } catch (err) { next(err); }
    });
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[kinvai-server] unhandled error:', err);
    if (res.headersSent) return;
    res.status(500).json({ error: 'Internal server error.' });
  });
  return app;
}
