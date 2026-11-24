# Internal link audit

**Status: SCRIPT ADDED · NOT RUN.** A browser preview URL and an installed Chromium browser are required. No preview/browser session was available during this code change.

The audit script `scripts/link-audit.mjs` uses Playwright to:

1. Open the public route set in a real browser and wait for the rendered page.
2. Read every rendered `a[href]` from the DOM.
3. Fail for empty `href` values and exact `href="#"` placeholders.
4. Collect every same-origin internal path discovered in the rendered DOM.
5. Visit every discovered internal path plus the required route set and fail on HTTP 404 or other 4xx/5xx responses.

Run with:

```bash
bun add --dev playwright@1.65.1
bunx playwright install chromium
PREVIEW_URL=https://<actual-preview-host> bun run audit:links
```

Use the exact preview hostname from the deployment console. The script intentionally does not guess one. It does not submit contact forms, make purchases, follow off-site links, or test authenticated owner flows.

The initial route set includes: `/`, `/shop`, `/collections`, `/about`, `/how-it-works`, `/support`, `/licence`, `/legal/privacy`, `/legal/terms`, `/legal/refunds`, `/search`, and `/definitely-not-a-real-kinvai-route`.

The deliberately missing route must render the custom not-found page; the route audit treats a server 404 for that path as expected. Product and collection detail URLs are discovered from the rendered internal links on the live preview.
