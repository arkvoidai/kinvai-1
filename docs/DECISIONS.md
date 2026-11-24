# Kinvai — Architectural Decisions & Assumptions Log

This file records every engineering decision and assumption made across Kinvai build phases.

## Prompt 1: Foundation

1. **Stack & Runtime Entrypoint**
   - Uses React 19 + TypeScript (strict) + Vite 8 + Tailwind CSS v4 + Express 4 (`server.ts` + `/server/app.ts`).
   - In development (`npm run dev`), `tsx server.ts` starts Express on port 3000 with Vite middleware mounted so `index.html` receives live `window.__KINVAI__` public config and SEO/noindex injection on every request.
   - In production (`npm run build && npm run start`), Express serves static assets from `/dist` and injects `window.__KINVAI__` into `dist/index.html` at request time.

2. **Public Config vs. Secrets Boundary**
   - `window.__KINVAI__` exposes strictly `{ siteUrl, supabaseUrl, supabasePublishableKey, flags: { razorpay, paypal, allowSeedFallback } }`.
   - Service-role Supabase client (`server/services/supabaseAdmin.ts`) and all payment/webhook/Gemini secrets stay strictly inside `/server` and are never imported in `/src`.
   - `ALLOW_SEED_FALLBACK` defaults to `true` when unset while building, per Charter section 2.

3. **Security Headers & AI Studio Preview Compatibility**
   - Express sets `Referrer-Policy: strict-origin-when-cross-origin`, `X-Content-Type-Options: nosniff`, and `Permissions-Policy: camera=(), microphone=(), geolocation=()`.
   - `Content-Security-Policy: frame-ancestors 'self'` is applied outside local/AI Studio preview environments (`*.run.app`, `localhost`, non-production) so preview iframes remain functional while production stays protected from clickjacking.

4. **Raw-Body Webhook Middleware Ordering**
   - `/api/webhooks/*` mounts `express.raw({ type: '*/*', limit: '1mb' })` strictly *before* `express.json()` so future Razorpay and PayPal HMAC/signature checks can verify exact raw payloads.

5. **Seed Fallback & Preview Guard (Charter Rule 7d)**
   - When Supabase credentials are absent or the live `products` table is empty and `flags.allowSeedFallback` is `true`, repository functions transparently return the 4 collections and 20 owner products from `src/lib/data/seed.ts` with `isPreviewData: true`.
   - All preview products render a clear `"Preview data"` indicator and disable Add to cart / Buy now / Checkout actions so no fake purchases can ever occur.
   - When `flags.allowSeedFallback` is `false` and Supabase returns empty, the storefront renders the `"Catalogue opening soon"` state with an email capture form.

6. **Auth Session Discipline**
   - `AuthProvider` resolves `supabase.auth.getSession()` once on boot, holds `loading: true` until resolved, and subscribes to `onAuthStateChange` thereafter.
   - Header reserves a fixed-width skeleton (`w-[104px] h-10`) for the account control while `loading` is `true` to prevent layout shift or flicker.
   - Sessions use PKCE flow with `persistSession: true`, `autoRefreshToken: true`, and `detectSessionInUrl: true`. Sign-out occurs only on explicit user action.

7. **Design Language ("Porcelain and Pop")**
   - Light theme only (no dark mode toggle).
   - Google Fonts loaded via `<link rel="preconnect">` and `display=swap`: `Geist` (300–700), `Instrument Serif` (italic 400 only for one accent word per headline), and `Geist Mono` (400–600 strictly for numerals, SKUs, and 11px uppercase labels).
   - Product art uses clean typographic fallback covers on flat collection-tinted backdrops (`ProductCover`) until Gemini-generated still-life covers or uploaded media are added in Prompt 2.
   - All icon-only buttons require an explicit `aria-label` and render a visible desktop tooltip on hover/focus.

8. **Cart & Local Persistence (Foundation Shell)**
   - `CartProvider` enforces Kinvai's digital commerce rule: `"1 licence per product. Yours for life."` (no duplicate quantity multipliers per SKU).
   - Full server-verified checkout (Razorpay/PayPal) and Supabase-synced wishlists are wired in subsequent prompts; foundation controls cleanly guard preview items and explain checkout readiness.

## Prompt 2: Cover and Image System

1. **Client-Side WebP Image Pipeline (`src/lib/media/imagePipeline.ts`)**
   - Every uploaded image and every generated Gemini cover flows through `processImage(file | blob)`, which resizes on an HTML `<canvas>` to WebP (`quality: 0.82`) at widths `480`, `960`, and `1600`, strictly preserving aspect ratio and never upscaling past intrinsic pixel width.
   - Public storage bucket `product-media` stores objects at `products/{productId}/{mediaId}/480.webp`, `960.webp`, and `1600.webp`. Database columns (`product_media.storage_path` and `products.cover_path`) store strictly the base path `"products/{productId}/{mediaId}"`. No image URLs are ever hardcoded in components.

2. **Responsive `<ProductImage>` & Zero-CLS Contract**
   - `<ProductImage>` constructs `srcSet` (`480w`, `960w`, `1600w`) via `supabase.storage.from('product-media').getPublicUrl(...)`, locks container aspect ratio (`4/5` default), passes explicit `width`/`height` HTML attributes, holds the flat collection tint while loading, and fades in over `240ms` (`opacity` transition only).

3. **Swiss-Poster `<CoverFallback>` & `<CoverStack>`**
   - Whenever `product.cover_path` is absent (or fails to load), `<ProductCover>` renders `<CoverFallback>` at `4:5` inside the flat collection tint.
   - Collection layouts differ solely through Swiss poster typography positioning (title upper-middle vs bottom-anchored, oversized low-contrast numeral anchor position) with strict left alignment, Geist 600 auto-fit title (max 3 lines), thin ink rule, 11px Geist Mono uppercase SKU + collection label, format chips, and the persimmon dot.
   - Top-right metadata clearance (`overlaySafe`) guarantees `ProductCard`'s floating `Preview data` pill and heart button never overlap cover typography.
   - `<CoverStack>` fans up to 3 covers at `-4deg`, `0deg`, and `+4deg` using compositor `transform` only for the hero spotlight and collection tiles.

4. **Server-Side Gemini Image Service (`server/services/gemini.ts` & `POST /api/admin/image/generate`)**
   - Uses `@google/genai` server-side only with `GEMINI_API_KEY` (never exposed or logged) and `httpOptions.headers['User-Agent'] = 'aistudio-build'`.
   - Model defaults to `process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image'` (per Charter & Prompt 2; confirmed in installed `@google/genai` types that `imageConfig: { aspectRatio: '4:5' }` is natively supported alongside `responseModalities: ['TEXT', 'IMAGE']`).
   - Guardrails: Zod schema validation, per-admin rate limit (6 requests/minute via `MemoryRateLimiter`), 45-second timeout, 1 automatic retry on transient upstream/timeout errors, and descriptive errors when `GEMINI_API_KEY` is missing or when the model returns text without an image.
   - Route protection (`server/middleware/requireAdmin.ts`): verifies Supabase Bearer JWT via service-role `auth.getUser(token)` and checks `profiles.is_admin === true`. Every unauthenticated, invalid, unconfigured, or non-admin caller receives a stealth **HTTP 404**.
   - `/api/admin/image` mounts an explicit `10mb` JSON body limit ahead of the global `1mb` JSON parser to support optional `referenceImageBase64` edit requests without inflating global payload limits.

5. **SEO / OpenGraph 1600.webp Resolution**
   - `getProductOgImageUrl(coverPath)` resolves the `1600.webp` variant for `og:image` and `twitter:image` tags on product pages, and collection pages resolve the first product's cover `1600.webp` both in client meta (`usePageMeta`) and server HTML injection (`server/app.ts`) when Supabase is configured.

## Prompt 3: App Shell

1. **Floating Desktop Pill Header & Mobile Navigation**
   - Desktop (`>=1024px`) renders a floating 56px pill bar (`16px` from top, `max-w-[1360px]`) composed of separate soft white hairline pills (Logo, flexible Search trigger with `"/"` hint & dark round button, Shop, Collections + hover-intent mega panel, How it works, Saved round button, Cart round button, Account pill).
   - Scroll compaction uses GPU-composited `transform` only (`scale(0.96)` + shadow token, `-translate-y-[125%]` hide on scroll down, reveal on scroll up with an `8px` delta threshold), never animating height and staying visible while keyboard focus or the mega panel is active.
   - Mobile (`<1024px`) pairs a 56px top bar (Logo left; Search + Cart round buttons right) with a 64px + safe-area bottom tab bar (`Home`, `Shop`, `Search`, `Saved`, `Account`) featuring Lucide icons + visible 11px labels and a transform-driven sliding active pill indicator. On `/products/:slug`, the bottom tab bar is omitted completely so the sticky dark mobile buy bar replaces it cleanly with zero overlap.
   - Collections mega panel and category pill row render live `collections` from Supabase when available and gracefully fall back to the 4 canonical collection links (without fabricating purchasable products) if anonymous Supabase catalogue reads are unavailable.

2. **Command Search (`Cmd/Ctrl+K` & `"/"`)**
   - Centred fixed-height desktop palette (zero layout shift) and full-height mobile sheet with `120ms` debounced, `AbortController`-backed requests to `search_products` RPC.
   - Groups results into Products (with 4:5 cover thumbs and USD prices), Collections, and Pages; highlights matches using safe React segment rendering (no `dangerouslySetInnerHTML`), persists recent searches in `localStorage`, provides 4 real-search suggestion chips, announces result counts via `aria-live="polite"`, and navigates to `/search?q=...` on Enter.

3. **Cart Store (`useSyncExternalStore`) & Wishlist Sync**
   - `cartStore` (`kinvai.cart.v2`) persists `{ version: 2, productIds: string[] }` in `localStorage` (migrating legacy v1 arrays automatically), keeping prices authoritative from catalogue/server records and enforcing 1 licence per product (`"1 licence. Yours for life."`, no quantity stepper).
   - Adding to cart triggers a lightweight compositor-only persimmon-dot flight animation (`CartFlightOverlay`, skipped when `prefers-reduced-motion`) plus an Undo toast. Owned products from `entitlements` display `"In your library"` instead of Add to cart.
   - `wishlistStore` (`kinvai.wishlist.v2`) stores guest saves in `localStorage`, merges guest IDs into `wishlist_items` on sign-in, and performs optimistic toggles with automatic rollback if a signed-in Supabase write fails.

4. **Sign-In Sheet & Iframe Safety**
   - Opens as a centred modal on desktop and draggable bottom sheet on phones (`SignInSheet`).
   - Uses `buildOAuthRedirectUrl` to construct `redirectTo = <origin>/auth/callback?next=<validated current path>` and validates `next` strictly as a same-origin relative path in `AuthCallbackPage`.
   - When rendered inside an iframe (detected via `window.self !== window.top`), displays `"Open Kinvai in a new tab to sign in"` using a native `<a target="_blank" rel="noopener noreferrer">` link (never `window.open`).

5. **Inverted Ink Footer & Live Newsletter Endpoint**
   - Rendered as an inset `36px`-radius ink tile with 4 link columns (`Shop`, `Collections`, `Support`, `Legal`), payments-and-security note, contact links (`heyarkvoid@gmail.com`, `@ArkvoidAI`), copyright (`© <year> Arkvoid Inc.`), and an oversized cropped `"kinvai."` bottom wordmark.
   - Newsletter form submits to `POST /api/newsletter` (Zod validation, hidden honeypot field, 5/min per-IP rate limit, Supabase service-role insert into `newsletter_subscribers` with friendly Postgres `23505` duplicate handling).

## Prompt 4: Homepage

1. **13-Section Distinct-Layout Rhythm**
   - `/` composes 13 distinct sections in sequence (`HomeHero`, `HomeFormatStrip`, `HomeProblemBeats`, `HomeCollectionsBento`, `HomeStartHereMosaic`, `HomeStartingPoint`, `HomeAssuranceBand`, `HomeLibrarySection`, `HomeHowItWorks`, `HomeStandardSection`, `HomeFeedbackSection`, `HomeFaqSection`, `HomeClosingBanner`) so no two consecutive bands share a grid structure or surface treatment.
   - Every section card, chip, row, and CTA navigates to a real route or performs a real client-side state change (zero dead buttons, zero `href="#"`).

2. **Above-the-Fold Hero & Immediate LCP Discipline**
   - The hero H1 (`"The hard first draft, already done."`) renders immediately visible (`opacity: 1`) without opacity-0 gates so LCP text paints immediately.
   - On phones (`390x740`), vertical spacing and compact hero padding ensure the eyebrow, H1, subtitle, and both full-width stacked primary/secondary CTA buttons (`"Explore the shop"` and `"How it works"`) remain visible above the mobile bottom tab bar without scrolling.
   - The right-hand Promax spotlight tile cycles up to 5 featured products with a compositor-only `420ms` crossfade + `24px` horizontal slide, touch swipe gestures, and subtle `<=4deg` pointer tilt on fine pointers only.

3. **Zero Fake Data & Graceful Empty Live Catalogue Handling (Charter Rule 7d)**
   - `HomeFormatStrip` derives text-only chips strictly from published products' `file_formats` and returns `null` when empty.
   - `HomeFeedbackSection` queries approved `reviews` via `getRecentApprovedReviews()` and returns `null` when none exist (never fabricating testimonials).
   - `HomeStartHereMosaic` returns `null` when `products.length === 0` so the page never shows duplicate empty banners or empty dead tiles; `HomeLibrarySection` hosts the single `<EmptyCatalogueBanner />` (now wired to the live `POST /api/newsletter` endpoint) when Supabase returns no published products and `flags.allowSeedFallback` is `false`.
   - `HomeAssuranceBand` and `HomeFaqSection` generate checkout provider wording via `buildPaymentAssuranceCopy(getPublicConfig().flags)`, naming Razorpay or PayPal only when their public server flag is enabled.

4. **Owner Confirmation Ledger (`/docs/CLAIMS_TO_CONFIRM.md`)**
   - All four promises in Section 10 (`HomeStandardSection`) and unconfirmed refund/update policy lines in Section 12 (`HomeFaqSection`) carry explicit `// OWNER_CONFIRM` code comments and are logged in `/docs/CLAIMS_TO_CONFIRM.md` for founder sign-off.

## Prompt 5: Shop, Collections & Search

1. **Shared `<ProductCard>` & Four Variants (`src/components/layout/ProductCard.tsx`)**
   - Finalized `<ProductCard>` with `standard` (`28px` collection-tinted tile, `4:5` cover with `12px` inner padding, top-left collection `<TagPill>`, top-right round Heart, below-tile 2-line name with GPU `scaleX` persimmon hover underline, 1-line tagline, mono tabular USD price, up to 3 format chips + `+N`, white hairline `Add to cart` pill + dark ink `View` pill), `wide` (`16:10` desktop rhythm span for every 7th card when balanced), `compact` (mobile search, cart, and library rows), and `feature` (Collection `"Start with"` presentation showing the first 3 `includes` items).
   - Whole card links cleanly to `/products/:slug` via an accessible stretched-link pseudo-element on the title link while Heart, Add to cart / In cart / In your library (`/account`), and View remain separate, keyboard-focusable controls at `z-10`.
   - `<ProductCardSkeleton>` matches exact variant geometry to avoid layout shift.

2. **URL-Driven Filters, Pagination & Regression Guard (`src/lib/shop/shopFilters.ts`, `ShopFilterBar.tsx`, `ShopProductGrid.tsx`)**
   - All filter state (`collection`, `format`, `price`, `tag`, `sort`, `q`, `page`) lives exclusively in URL search parameters updated with `preventScrollReset: true` so shareable URLs, reloads, and browser Back/Forward restore state cleanly with zero scroll jumps.
   - Desktop renders a sticky Promax-style pill bar + expandable filter tray (`Formats`, USD `Price` ranges, `Made for` tags) + `Sort` select + removable active filter chips. Mobile renders a horizontally scrolling collection pill rail + `Filter & sort` button + drag-to-dismiss bottom `<Sheet>` with `Clear all` and `Show N products`.
   - Grid supports 4 columns at `>=1280px`, 3 at `>=1024px`, 2 at `>=340px`, and 1 only below `340px`, with `160ms` opacity crossfade, first-8 stagger reveal, 12 products per page, Load more button, and accessible numbered page links.
   - Repository functions (`getProducts`, `getCollections`, `getCollection`, `searchProducts`) now surface explicit `error` strings on failed queries so `/shop`, `/collections`, `/collections/:slug`, and `/search` render `<ShopErrorTile />` with a working **Retry** button instead of falsely collapsing failures into an empty state.

3. **Editorial Collections, Highlighted Search & Guest-Friendly Saved**
   - `/collections` renders four alternating asymmetric bento rows (`7/5`, `5/7`, `6/6`, and full-bleed Converse banner) pairing collection-tinted `<CoverStack>` tiles with `collections.story` and live counts.
   - `/collections/:slug` renders a collection-tinted editorial header with a `"Start with"` `feature` card sourced strictly from the collection's first featured database product, collection-scoped URL filters, shared grid, and circular Previous/Next collection tiles.
   - `/search?q=` queries `search_products` RPC with `AbortController`, preserves `q` in the URL, highlights matched tokens safely in React inside product cards, renders `compact` cards on phones and `standard` cards on desktop, and provides clickable suggestion chips on empty results.
   - `/saved` shows the gentle guest banner (`"Sign in to keep these on every device."`) above local saves when signed out and uses optimistic heart updates via `useCart()`.

## Prompt 6: Product Page

1. **Wink Desktop Bento & Mobile Shop App Phone Architecture (`/products/:slug`)**
   - Desktop (`>=1024px`) renders a breadcrumb pill row (`Home / Collection / Product`) above a 12-column bento: Left 7 columns feature a `36px`-radius collection-tinted hero tile (`ProductCover` at `lg` size, top-left collection `<TagPill>`, top-right floating Save & Share round buttons) paired with 3 secondary gallery tiles below (`product_media` gallery images when present, or real-data-only File-tree, Formats, and Made-for peek tiles). Right 5 columns hold a sticky purchase card (`lg:sticky lg:top-24`) with title, tagline, conditional `RatingStars` (`review_count > 0` only), monospaced USD price, format chips, requirements line, Add to cart + Heart row, a Wink-inspired dark ink price bar (price left, white `Buy now` / `Go to checkout` pill right), and three round-badge assurance rows (`Instant download`, `Yours for life`, `Secure checkout`).
   - Mobile (`<1024px`) translates the Mobile Shop App reference into a dedicated touch-first experience: full-width tinted swipeable cover stage with floating round Back, Save, and Share buttons plus centered gallery dots, followed by a crisp white product block with expandable description accordion, and a spring-animated `<MobileStickyBuyBar />` that slides up above the safe area once the primary purchase controls scroll out of view (replacing `<MobileBottomBar />` cleanly).

2. **Purchase States, 600ms Drawn-Check Add to Cart & Exclusive Buy Now**
   - `resolvePurchaseState` explicitly governs `not-owned`, `in-cart` (`In cart` + `Go to checkout`), `owned` (`Download from your library` -> `/account`), and `preview` (seed mode: disabled purchase actions labelled `Preview data`).
   - Clicking `Add to cart` morphs the button to `Added` with an animated SVG drawn-check stroke over `600ms` before settling; on desktop (`>=1024px`) only, `CartSheet` opens after the morph completes.
   - `CartProvider.buyNow(product, isPreviewData)` replaces the cart exclusively with `[product.id]` via `cartStore.replace([product.id])` and navigates directly to `/checkout`.

3. **Archived Owner Access, Real-Data Related Fallback & Verified Owner Reviews**
   - `getProductBySlug(slug, { userId, isAdmin })` allows signed-in owners (verified via `entitlements` with `revoked_at IS NULL`) or admins to view `archived` products they own, while returning 404 to everyone else and distinguishing live query errors (Retry tile) from genuine 404s.
   - `getRelated` queries `product_relations` first, then falls back exclusively to published products in the same collection ranked by shared tag overlap (`rankRelatedProducts`), never fabricating items.
   - `ProductReviewsSection` displays `product_rating_stats` only when `review_count > 0`, lists approved reviews or the calm empty state (`"Reviews appear here after buyers have used this product."`), and provides a `Write a review` form strictly for signed-in owners, handling Supabase RLS/duplicate errors gracefully (`mapReviewSubmitError`) and showing `Awaiting approval` for newly submitted or pending reviews.

4. **Accessible Lightbox, Shared-Element View Transitions & Canonical SEO**
   - `ProductLightbox` opens any available `product_media` image with a keyboard focus trap, `Escape` to close, `ArrowLeft`/`ArrowRight` navigation, touch swipe support, and a `220ms` crossfade.
   - Shared-element transitions attach a deterministic `viewTransitionName` (`kv-cover-<slug>`) strictly to the active visible product cover on `ProductCard` and `ProductDetailPage`, with CSS reduced-motion disable and `PageTransition` fade fallback when unsupported.
   - `usePageMeta` updates `document.title` and upserts a single canonical `<link rel="canonical">` on every route change (removing duplicates/stale links and omitting canonical on `noindex` routes such as 404 or archived owner views).


## Prompt 7: Account, Library, Orders & Profile

1. **Auth boot and guarded routes**
   - Keep the existing browser Supabase singleton configured for PKCE, persistent browser storage, automatic token refresh, and URL callback detection.
   - Register the auth-state listener before reading the boot session; do not await database requests inside the auth callback. Protected `/account` and `/checkout` wait for boot, then open the global sign-in sheet with the exact pathname, query, and hash as the return target.
   - OAuth callback errors use a calm retry state. The callback relies on the singleton client's URL detection/session initialization to avoid exchanging a PKCE code twice.

2. **Account data and RLS**
   - Account library reads only entitlements with `revoked_at IS NULL`, then loads product details allowed by the existing entitlement-aware product RLS policy.
   - Order and order-item history is queried through the existing own-order RLS policies. Profile updates write only `display_name` and `country_code`; email remains read-only.
   - Reviews are written after an active entitlement check, use the existing unique `(user_id, product_id)` constraint, and are submitted with `status = 'pending'`. The existing review update trigger resets edited reviews to pending. RLS remains the final ownership enforcement layer.

3. **Private file metadata and download dependency**
   - Customer sessions cannot select `product_files` directly (the current policy is admin-only). `GET /api/library/files` therefore verifies the bearer token with Supabase Auth, looks up active entitlements, and returns only active file display metadata; it never returns private `storage_path` values or signed URLs.
   - Library download buttons call `GET /api/download/:productId` with the bearer token as specified for Prompt 8. The current downloads router remains a deliberate 501 stub at this prompt boundary; the singular route is mounted so Prompt 8 can replace the stub without changing the account UI. Full file download is not complete until Prompt 8 implements and verifies signed delivery.

4. **OAuth redirect allowlist**
   - The production callback and Supabase Google provider callback are recorded in `docs/AUTH_SETUP.md`. AI Studio preview and Cloud Run hosts are runtime-specific and are intentionally not guessed or broadly wildcarded; add each active exact callback URL to the Supabase allowlist when using those environments.

5. **No schema or production-data changes**
   - Existing Supabase tables, RLS policies, triggers, and indexes support this prompt. No migration or live database mutation was performed for this implementation.


## Prompt 8: Checkout, Payments & Signed Downloads

1. **Server-authoritative order creation**
   - The browser sends only unique product UUIDs and a single provider choice. `POST /api/checkout/create` authenticates the Supabase bearer token and calls the existing `create_order` RPC; the database validates published status, active ownership, order items and every price.
   - A single provider is pinned to each order. The provider order is created server-side and its provider order ID is attached to the same database order before provider checkout is returned to the browser.

2. **Provider confirmation**
   - Razorpay checkout signatures are HMAC-SHA256 over `order_id|payment_id`; verification also fetches the payment from Razorpay and validates provider order ID, captured status, amount and USD currency before `mark_order_paid`.
   - PayPal uses an OAuth token from the configured Sandbox/live API host, REST Orders v2 with CAPTURE intent, a `PayPal-Request-Id` based on the Kinvai order number, and server-side capture validation for COMPLETED status, exact amount and USD.
   - Razorpay's USD availability is merchant-account dependent. A provider response indicating unsupported USD/international payments persists an unavailable status in the private `site_settings` key `payment_provider_runtime_status`, logs only structured status/code and exposes a temporary-unavailable state across app instances. The owner must confirm International Payments activation and clear that private status before retrying; no automatic account-level enablement is assumed.

3. **Webhook signature, idempotency and privacy**
   - Webhooks are mounted before `express.json()` and use raw request bytes. Razorpay uses HMAC-SHA256 with its webhook secret; PayPal uses the official verify-webhook-signature endpoint with the registered webhook ID and transmission headers.
   - `record_payment_event` runs before event side effects; duplicate event IDs skip handling. If applying a newly recorded event fails, the just-inserted event record is removed so the provider retry can attempt processing again.
   - Stored webhook payloads are allowlisted summaries rather than complete provider payloads. Logs omit secrets, bearer tokens and payment-method/card details.

4. **Short-lived file delivery**
   - The download endpoint checks the bearer token and active entitlement through the service-role client, returns only file metadata for multiple active files, or signs one private storage object for 60 seconds.
   - Download logs store an HMAC hash of the request IP using the server-only service-role credential as a salt, plus user agent and object/product IDs. The private object path is never returned.

5. **Testing and operational boundary**
   - Existing `node:test` imports were changed to Vitest imports because the project test script is `vitest run`; no test assertions were intentionally changed.
   - Payment-provider Sandbox calls, account-level USD activation, and real Storage signed downloads remain manual owner verification steps documented in `docs/PAYMENTS_TEST.md`. No schema migrations, provider-setting changes, credential creation, or real charges/refunds were performed during implementation.

## Prompt 9: Owner Admin & Image Studio

1. **Private owner workspace**
   - /admin and its subroutes render a dedicated phone-first shell with no storefront header, footer, cart, account tabs, or public navigation. Only a signed-in session whose profiles.is_admin is true sees the workspace; signed-out and non-admin visitors receive the standard designed 404. The route remains disallowed in robots.txt and is injected with noindex, nofollow.
   - Catalogue reads and writes, object uploads/deletes, collection edits, reviews, inbox handling, announcement settings and payment/order inspection use the owner's browser Supabase session. RLS is the authorization boundary for every database and Storage operation. No service-role client or key is imported under /src.

2. **Product editor and media**
   - Product forms validate with Zod, check slug uniqueness before save, convert decimal USD input to integer cents, autosave existing drafts, and guard navigation when edits remain unsaved. Publishing relies on the existing database trigger; its active-file requirement is mapped to the plain-language owner message "Attach at least one active file before publishing".
   - Owner-selected uploads and Gemini outputs share the existing processImage WebP pipeline (480, 960 and 1600 widths) and are uploaded through the signed-in browser client to the public product-media bucket. product_media stores the storage base path, kind, alt text and source; setting a cover also updates products.cover_path, which is already the shared field consumed by storefront cards and product pages.
   - Gemini generation is the only image-generation server operation. The existing server admin guard and generation endpoint are reused. The Fast option uses the configured image model (default gemini-3.1-flash-image); Best explicitly selects gemini-3-pro-image. Returned options remain client-side until the owner chooses cover or gallery. Bulk generation is sequential, cancellable between products, continues after a failed product, and only replaces covers when the private owner preference admin_auto_set_generated_covers is enabled.
   - AI-generated images are saved as source='gemini'; manual uploads are saved as source='upload'. The interface asks for non-empty alt text for each media record and includes the SynthID note.

3. **Private deliverables**
   - Product files are sent directly from the browser to the private product-files bucket using tus-js-client resumable uploads and the owner access token. Browser Web Crypto computes SHA-256 before upload; product_files records the path, file name, MIME type, size, version, checksum and active flag. No file bytes pass through the application server.
   - The server has one additional owner-only endpoint for a 60-second signed test-download URL. It uses the existing requireAdmin check and service-role Storage API because private files are not publicly addressable; it does not write catalogue data.

4. **Operations and inbox**
   - The overview, order detail, review moderation, contact handling, newsletter list, collections and launch checks are browser/RLS operations. Refund actions are deliberately not provided; order details link to the relevant provider dashboards.
   - The existing newsletter_subscribers table does not contain a handled column. To support an owner-only handled toggle without changing the database schema, newsletter handled IDs are held in private site_settings.admin_handled_newsletter_ids. Contact message handled state remains in contact_messages.handled.
   - The announcement editor writes the existing site_settings.announcement format used by the storefront. The launch checklist checks active files, cover alt text, SEO fields, payment provider flags and that ALLOW_SEED_FALLBACK is disabled.

5. **Schema and testing boundary**
   - No migrations, schema edits, policy changes or live catalogue data mutations were performed as part of Prompt 9. Existing tables, admin RLS and the two existing buckets are used.
   - Exact owner flow, non-admin 404, signed download and storefront cover propagation checks are documented in docs/ADMIN_TEST.md. Local TypeScript/lint, unit tests, build, browser QA, real TUS transfer and Gemini calls still require execution in the configured project environment.


## Prompt 10: Content, SEO, Performance, QA & Launch

1. **Content and legal boundaries**
   - Reworked About, How it works, Support, Licence, Privacy, Terms and Refunds into distinct responsive bento compositions. The About page names Manish Talukdar and Arkvoid Inc.; unknown legal/business facts remain explicit [OWNER TO COMPLETE] placeholders.
   - Support FAQs are searchable and category-filtered. The support form submits to POST /api/contact, which uses Zod validation, same-origin checks, a honeypot, a per-IP rate limit and the existing contact_messages table. The UI only displays success after a successful database insert response.
   - How-it-works format compatibility is derived from the live published product file_formats values, with common reader examples. The product's own requirement list remains authoritative.
   - A build-time guard scans src/ and server/ for unresolved [OWNER TO COMPLETE] and OWNER_CONFIRM markers. A production build is intentionally blocked until owner review resolves every marker. Vercel Preview builds skip this production-only gate so the preview can be inspected while owner review is pending.
   - docs/LEGAL_REVIEW.md requires lawyer review of all three legal drafts. docs/CLAIMS_TO_CONFIRM.md lists unverified operating and commercial claims.

2. **Server-rendered SEO**
   - Express injects route-specific title, description, canonical, robots, Open Graph and Twitter metadata into HTML requests.
   - Product metadata reads only published products through Supabase's publishable key; it generates Product/Offer and BreadcrumbList JSON-LD, and includes AggregateRating only when the real rating stats view reports approved review counts. Product JSON-LD source comment points to Google's Product snippet documentation.
   - Root JSON-LD includes Organization and WebSite/SearchAction. Product/collection lookups and the sitemap cache for 60 seconds. Sitemap includes static public pages, active collections and published products with published_at lastmod. robots.txt disallows /account, /admin, /checkout, /api and /design.
   - Unknown product slugs receive a server HTTP 404 with the client-side designed not-found route. Other unknown HTML paths use the 404 status and SPA route fallback.

3. **Performance, motion and branding**
   - Non-home routes are lazy-loaded, keeping checkout/admin/page modules out of the static homepage import graph. Home remains eager so the hero is not delayed by a route chunk.
   - Added a favicon mark, touch icon asset, web manifest, #F4F2EE theme color, persimmon 20% text-selection highlight and a branded scrollbar.
   - docs/PERF.md records source-level work and explicitly leaves gzip sizes, 2.5-second hero interaction, Core Web Vitals and font preloads NOT VERIFIED / NOT MEASURED because a production build and real-device profile have not run.
   - docs/MOTION_AUDIT.md inventories global CSS motion; component-level Motion usage still needs a complete browser/source audit. Reduced-motion CSS is retained.

4. **QA and deployment**
   - scripts/link-audit.mjs audits rendered DOM anchors and internal paths using Playwright when installed, with instructions in docs/LINK_AUDIT.md. This connector session did not run the script or responsive checks.
   - docs/DEPLOY.md documents AI Studio/Cloud Run, recommended Google external Application Load Balancer, limited Preview domain-mapping alternative, exact redirect/webhook paths, and DNS values to be copied only from Google Cloud Console.
   - No Supabase migrations, DNS changes, OAuth configuration, payment activation, production secret writes, or real purchases were performed.

5. **Explicit verification boundary**
   - No local repository runtime was available in this connector session. bun run lint, bun run test, bun run build, Playwright/browser QA, breakpoint inspection, gzip bundle measurement, production deploy and live provider/download flows remain NOT VERIFIED. Build is deliberately expected to fail until the marked owner/legal copy is completed.
