# Prompt 9 — Owner Admin verification

Run these checks in the configured Kinvai environment with a real owner session and test products. Do not use a production payment flow for this checklist.

## 1. Access and indexing

1. Sign in with an account whose profiles.is_admin is true and open /admin.
2. Confirm the owner workspace loads without storefront navigation, cart, footer or mobile tabs. Check at 390px width and desktop width.
3. Sign out, then open /admin in a private session. Confirm the designed 404 appears.
4. Sign in as a normal account with profiles.is_admin = false and open /admin/products, /admin/images and /admin/settings directly. Each must show the same designed 404.
5. Check /robots.txt includes Disallow: /admin; check the rendered /admin document has noindex, nofollow.

## 2. Product draft, validation and publish guard

1. Open /admin/products and choose New product.
2. Try an invalid slug and invalid USD price; confirm validation prevents saving and the slug uniqueness check reports conflicts.
3. Enter product name, slug, SKU, tagline, short/long descriptions, collection, price, tags, formats, includes, audience, requirements, first-hour steps and SEO fields.
4. Save the draft. Refresh the editor and confirm the values persisted; confirm the SEO character counters update while typing.
5. With no active file attached, attempt to publish. Confirm the message reads: Attach at least one active file before publishing.
6. Change a saved draft, then close the editor or reload. Confirm the unsaved-changes guard appears.

## 3. Upload, generate and set cover

1. In the product editor open Images. Upload a JPG, PNG, WebP or AVIF below 10 MB by tapping the picker and by dragging a file onto the drop area.
2. Supply alt text and set the uploaded image as cover. Confirm product_media has a row with source = upload, non-empty alt, and one 480/960/1600 WebP object set; confirm products.cover_path stores the media base path.
3. Confirm the same cover appears on storefront product cards and /products/{slug} after refresh.
4. In Generate with Gemini, edit the art direction, save it, select Fast and generate three options. Confirm results appear sequentially with progress/skeletons.
5. Repeat using Best (gemini-3-pro-image) where the configured project and account have access.
6. On an option, test Refine with a short note; then test Discard, Add to gallery and Use as cover. Confirm source is gemini, alt text is non-empty and the storefront cover changes immediately after selecting it.
7. On /admin/images, run Generate missing covers with auto-set disabled; confirm each success becomes a gallery candidate, failures do not stop the queue, and Cancel stops before the next product. Enable auto-set and verify the next successful generated image becomes the cover.

## 4. Private deliverables and signed test downloads

1. In the editor open Files and upload a test deliverable larger than one TUS chunk when practical.
2. Confirm progress updates, Pause and Resume work, and Retry works after a controlled network failure.
3. Verify the private Storage object is under product-files/products/{productId}/... and is not publicly readable.
4. Confirm product_files records the file name, MIME type, size, version, SHA-256 checksum and active state.
5. Use Test download. Confirm the server returns a 60-second signed URL only to an admin and that the file downloads.
6. Upload a replacement version and confirm the chosen Replace active versions option deactivates the earlier rows; test manual Activate/Deactivate.
7. Publish the product and confirm the storefront lists it. Confirm customer download still uses the existing entitlement-protected Prompt 8 endpoint.

## 5. Other owner pages

1. Edit a collection, change its accent and sort order, upload a collection image, save, and confirm the storefront reflects the new record.
2. Inspect an order with provider IDs and its related payment event rows. Confirm no manual refund button exists and provider dashboard links open.
3. Approve and reject pending reviews; confirm they leave the pending queue.
4. Toggle contact messages as handled. Toggle newsletter subscribers as handled, refresh, and confirm the private owner-only state persists.
5. Export both CSV datasets and confirm handled state is included.
6. Edit the announcement message/toggle and confirm the storefront announcement bar reads the public site_settings.announcement value.
7. Run the launch checklist. Verify failing products/providers are listed with helpful detail.

## 6. Automated verification

\`\`\`bash
bun run lint
bun run test
bun run build
\`\`\`

Also review browser console and server logs while completing the owner flow. The local lint/test/build, real Gemini image requests, TUS uploads, signed Storage downloads and visual device checks must be run in the configured environment; their success is not implied by the source changes alone.
