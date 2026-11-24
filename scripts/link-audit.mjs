const previewUrl = process.env.PREVIEW_URL;
if (!previewUrl) {
  console.error('Set PREVIEW_URL to the exact preview origin, for example PREVIEW_URL=https://<preview-host>.');
  process.exit(1);
}

const origin = new URL(previewUrl).origin;
const initialRoutes = [
  '/', '/shop', '/collections', '/about', '/how-it-works', '/support',
  '/licence', '/legal/privacy', '/legal/terms', '/legal/refunds', '/search',
  '/definitely-not-a-real-kinvai-route',
];
const expected404Paths = new Set(['/definitely-not-a-real-kinvai-route']);
const issues = [];
const discovered = new Set(initialRoutes);
const visited = new Set();
let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('Playwright is not installed. Run: bun add --dev playwright@1.65.1 && bunx playwright install chromium');
  process.exit(1);
}
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', (error) => issues.push('Browser error: ' + error.message));

  async function visit(pathname) {
    const url = new URL(pathname, origin);
    if (url.origin !== origin || visited.has(url.pathname + url.search)) return;
    const key = url.pathname + url.search;
    visited.add(key);
    const response = await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
    if (!response) issues.push(key + ': no main document response');
    else if (response.status() >= 400 && !(response.status() === 404 && expected404Paths.has(url.pathname))) {
      issues.push(key + ': HTTP ' + response.status());
    }
    await page.waitForTimeout(250);
    const anchors = await page.locator('a[href]').evaluateAll((nodes) => nodes.map((node) => ({
      href: node.getAttribute('href'),
      text: (node.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 100),
    })));
    for (const anchor of anchors) {
      if (anchor.href === null || anchor.href.trim() === '') {
        issues.push(key + ': empty href on "' + anchor.text + '"');
        continue;
      }
      if (anchor.href.trim() === '#') {
        issues.push(key + ': href="#" on "' + anchor.text + '"');
        continue;
      }
      try {
        const target = new URL(anchor.href, origin);
        if (target.origin === origin && /^https?:$/.test(target.protocol)) {
          discovered.add(target.pathname + target.search);
        }
      } catch {
        issues.push(key + ': invalid href "' + anchor.href + '"');
      }
    }
  }

  for (const route of initialRoutes) await visit(route);
  let previousSize = -1;
  while (previousSize !== discovered.size) {
    previousSize = discovered.size;
    for (const route of [...discovered]) await visit(route);
  }
  console.log('Visited ' + visited.size + ' unique internal URLs from ' + origin + '.');
  if (issues.length) {
    console.error('\nLink audit failed with ' + issues.length + ' issue(s):');
    for (const issue of issues) console.error('- ' + issue);
    process.exitCode = 1;
  } else {
    console.log('Link audit passed: no empty hrefs, href="#" placeholders, browser errors or HTTP 4xx/5xx internal URLs.');
  }
} finally {
  await browser.close();
}
