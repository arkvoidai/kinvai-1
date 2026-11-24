# Kinvai

Kinvai is a digital-download storefront operated by Arkvoid Inc. It is built with React, TypeScript, Vite and an Express server, with Supabase for auth, catalogue data and private file delivery.

## Local setup

1. Install Bun (the repository uses bun.lock).
2. Install dependencies: bun install.
3. Configure local values using the names in [docs/SECRETS.md](docs/SECRETS.md). Never commit secret values.
4. Set SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SITE_URL and the other required development values.
5. Run bun run dev and open the local server on port 3000.

The source includes unresolved legal and claim markers by design. The production build command is guarded and will stop until the owner resolves them in source after review. Vercel Preview builds skip that production-only gate so the preview can be used for review and QA. Do not remove a marker just to make a build pass.

## Scripts

| Command | Purpose |
|---|---|
| bun install | Install pinned dependencies from bun.lock |
| bun run dev | Express + Vite development server |
| bun run lint | TypeScript check |
| bun run test | Vitest suite |
| bun run build | Production owner-marker gate, then Vite build |
| bun run start | Start the production Express server |
| bun run audit:links | Scan rendered preview routes and internal anchors (requires Playwright) |

For rendered link QA, install Playwright and Chromium once: bun add --dev playwright@1.65.1 && bunx playwright install chromium. Then run PREVIEW_URL=https://<actual-preview-host> bun run audit:links. Record the audit output in [docs/LINK_AUDIT.md](docs/LINK_AUDIT.md).

## Architecture

- src/app/router.tsx — React Router route tree and route-level lazy loading. The homepage remains eager for its primary hero.
- src/pages/ and src/components/ — storefront, account, checkout and owner UI.
- src/lib/data/repository.ts — browser-side public catalogue reads via Supabase publishable key and RLS.
- server.ts, server/app.ts — Express runtime, security headers, SEO injection, static asset delivery and API route mounting.
- server/routes/ — checkout, webhook, download, forms, admin, sitemap and robots handlers.
- server/services/supabaseAdmin.ts — server-only service-role client. Never import it from src/.
- docs/CHARTER.md — product, stack, design, copy and anti-garbage requirements.
- docs/DECISIONS.md — implementation decisions and assumptions.

The existing Supabase schema is the production data contract. No migrations should be created casually; inspect the live schema and RLS before proposing database changes.

## Replace a product image

1. Sign in with the owner account and open /admin/products.
2. Open the product and choose its Images section.
3. Upload a real JPG, PNG, WebP or AVIF cover, add meaningful alt text and select Use as cover.
4. Confirm the three responsive WebP variants are produced and the product cover changes in the storefront.
5. Check /products/<slug> and the listing card at phone and desktop widths.

Do not use remote placeholder images. Use an actual product still-life asset or the designed typographic fallback.

## Add a product

1. Open /admin/products and create a draft.
2. Fill the name, unique slug, SKU, description, USD price, collection, tags, formats, includes, audience, requirements and first-hour notes.
3. Add a real cover and useful alt text.
4. Upload at least one real deliverable to the private product-files bucket; review its filename, version, size and checksum.
5. Confirm the displayed formats and product page match the deliverable.
6. Preview the product and verify SEO title/description, image crops and mobile layout.
7. Publish only after the database's active-file requirement is satisfied and owner claims are verified.

## Troubleshooting

- Build stops on owner markers: inspect each reported [OWNER TO COMPLETE] or OWNER_CONFIRM line. Complete facts/policies and have claims approved; never delete unverified claims.
- Catalogue appears empty: check Supabase URL/key, public RLS policies, product status='published', collection active state and network errors. Production must use ALLOW_SEED_FALLBACK=false.
- Google sign-in redirect error: compare the exact final domain's Supabase redirect allowlist and Google OAuth callback with [docs/AUTH_SETUP.md](docs/AUTH_SETUP.md).
- Payment provider hidden: inspect server provider credentials and provider enablement. Razorpay USD requires merchant International Payments activation; follow [docs/PAYMENTS_TEST.md](docs/PAYMENTS_TEST.md).
- Payment succeeded but no library item: verify provider webhook/signature, server order state and entitlement creation before any manual database correction.
- Download fails: confirm an active entitlement and at least one active private file object. Signed URLs are short lived; retry from the account library.
- Contact submission fails: check same-origin behavior, API rate limit, server logs without secrets, service-role configuration and the contact_messages schema.
- SEO metadata missing: check SITE_URL, Supabase publishable key, published product status and the server-rendered HTML response source.
- Deployment/domain issues: follow [docs/DEPLOY.md](docs/DEPLOY.md). DNS values must come from Google Cloud Console for the actual service and frontend.

## Release readiness

Do not publish until docs/LEGAL_REVIEW.md, docs/CLAIMS_TO_CONFIRM.md, docs/PAYMENTS_TEST.md, docs/PERF.md, docs/MOTION_AUDIT.md and docs/LINK_AUDIT.md have been reviewed and their required runtime checks have been executed.
