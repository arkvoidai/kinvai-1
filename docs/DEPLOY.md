# Production deployment — AI Studio to Cloud Run

This document describes the intended production path for Kinvai. The exact Google Cloud project, region, Cloud Run service, load-balancer resources and DNS zone are not discoverable from this repository. Copy values from the active Google Cloud Console; **do not guess IP addresses, DNS targets, service names or certificate names**.

## 1. Build and deploy from Google AI Studio

1. Open the Kinvai project in Google AI Studio Build mode and confirm the repository branch contains the approved Prompt 10 changes.
2. Open the app's deployment flow and deploy the server-backed application to **Cloud Run** in the intended Google Cloud project and region.
3. In Cloud Run, verify the deployed service uses the repository's Node/Express entry point (`server.ts`) and starts on the port supplied by Cloud Run (`PORT`). The container must run with `NODE_ENV=production`.
4. Configure secrets using Cloud Run's Secret Manager integration (preferred) or the approved runtime secret mechanism. Do not put server secrets in browser variables, GitHub, screenshots or client bundles.
5. Set `SITE_URL=https://kinvai.arkvoid.com`, `NODE_ENV=production`, and `ALLOW_SEED_FALLBACK=false`. Set `APP_URL` to the actual Cloud Run service URL if the preview-environment check needs it.
6. Set every applicable environment value listed in [SECRETS.md](./SECRETS.md). `SUPABASE_PUBLISHABLE_KEY` is intentionally public and is injected by the server; the service-role key and payment/Gemini credentials remain server-only.
7. Check Cloud Run logs and the service's health endpoint after deployment. Do not treat a successful container start as evidence that Google OAuth, a payment provider, file delivery or a legal policy is launch-ready.

### Required environment names

`SITE_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, `GEMINI_IMAGE_MODEL`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, `PAYPAL_ENV`, `ALLOW_SEED_FALLBACK`.

## 2. Attach kinvai.arkvoid.com

Google currently documents three options for a Cloud Run custom domain: a global external Application Load Balancer (recommended), Cloud Run domain mapping (limited availability / Preview), and Firebase Hosting. For a production storefront, use the global external Application Load Balancer unless the owner has a documented reason to choose another supported front end.

Official references:
- [Map custom domains to Cloud Run](https://docs.cloud.google.com/run/docs/mapping-custom-domains)
- [Set up a global external Application Load Balancer with a serverless NEG](https://docs.cloud.google.com/load-balancing/docs/https/setup-global-ext-https-serverless)
- [Cloud Run domain mappings](https://docs.cloud.google.com/run/docs/mapping-custom-domains)

### Recommended: global external Application Load Balancer

1. Create a global external Application Load Balancer in the same project (or a project with the required network access).
2. Create a serverless network endpoint group (NEG) targeting the deployed Cloud Run service and region.
3. Attach the NEG as a backend service, then configure a URL map, HTTPS frontend and Google-managed certificate for `kinvai.arkvoid.com`.
4. Complete certificate/domain authorization as instructed by Certificate Manager or the load-balancer wizard.
5. After Google Cloud shows the actual frontend IP, add an **A** record for host `kinvai` in the `arkvoid.com` DNS zone, pointing to that exact IP. Add an **AAAA** record only if the configured frontend exposes IPv6 and the console instructs it. If DNS authorization uses a CNAME, create the exact CNAME target shown by Certificate Manager.
6. Wait for DNS and certificate provisioning, then verify the HTTPS certificate and route to the Cloud Run service.

Google's setup guide specifies an A record pointing at the load balancer's assigned IP. Any additional AAAA or certificate-authorisation CNAME record depends on the actual frontend/certificate configuration. The Google Cloud Console is the source of truth for all record names and values.

### Alternative: Cloud Run domain mapping

Cloud Run domain mapping is currently documented as **Preview / limited availability**, and Google warns that it is not recommended for production because of latency issues. Use it only if the project/region console explicitly offers it and the owner accepts that limitation.

1. In Cloud Run, open Domain mappings and create a mapping for `kinvai.arkvoid.com` to the intended service.
2. Verify domain ownership if prompted.
3. Copy the exact generated DNS records from the Cloud Run console to the DNS provider for `arkvoid.com`. Depending on the mapping and DNS provider, the console may show A, AAAA and/or CNAME records.
4. Do not copy sample values from documentation or another service. Use the exact records Cloud Run generated for this mapping.
5. Verify the mapping and Google-managed certificate in Cloud Run after DNS propagation.

Do not create conflicting records or replace the existing DNS zone blindly.

## 3. Supabase Auth and Google OAuth

In Supabase → Authentication → URL Configuration:

- **Site URL:** `https://kinvai.arkvoid.com`
- **Redirect URL allowlist:** `https://kinvai.arkvoid.com/auth/callback`
- Add each exact preview or temporary Cloud Run callback URL only while that environment is used. Avoid broad wildcard redirects.

In Google Cloud Console → APIs & Services → Credentials, edit the Web OAuth client used by the Supabase Google provider:

- **Authorized redirect URI:** `https://dqgjbmpvwsoxhatadbdw.supabase.co/auth/v1/callback` (the Supabase Auth callback recorded in [AUTH_SETUP.md](./AUTH_SETUP.md); verify the active Supabase project before saving).
- **Authorized JavaScript origin:** `https://kinvai.arkvoid.com`.
- Add local/preview origins only when intentionally testing those exact environments.

Keep the Google client secret in Supabase's provider configuration. Never expose it to the client.

## 4. Payment webhooks

Register the following exact production endpoints with each provider and copy the newly created webhook secrets/IDs to Cloud Run secrets:

- Razorpay: `https://kinvai.arkvoid.com/api/webhooks/razorpay`
- PayPal: `https://kinvai.arkvoid.com/api/webhooks/paypal`

For PayPal, set `PAYPAL_ENV=live` only after creating the live REST app and live webhook. For initial validation keep PayPal in Sandbox. Do not use production card details in test mode.

Razorpay processes USD only when the merchant account has the required International Payments/currency capability. Confirm **International Payments activation** in the merchant dashboard with Razorpay before enabling Razorpay USD in Kinvai. An API key alone does not activate that merchant capability.

## 5. Database and catalogue launch reminders

No schema migration is requested by Prompt 10. Confirm the existing Supabase project and SQL/RPC state before launch; do not run a schema reset against a populated project.

- Production runtime: `NODE_ENV=production`.
- Preview seed fallback: `ALLOW_SEED_FALLBACK=false`. Confirm the server-injected public flag is false.
- Vercel Preview builds skip the owner-marker production gate; the production build (including the Cloud Run build command) enforces it.
- Every published product must have at least one real active row in `product_files` and a real downloadable object in the private `product-files` bucket. Attach and test each file before publishing.
- Set a real cover image and meaningful alt text for each published product.
- Confirm product status, price in integer USD cents, `file_formats`, SEO title and description.
- Do not publish seed/preview products.
- Check all launch items in [CLAIMS_TO_CONFIRM.md](./CLAIMS_TO_CONFIRM.md), [LEGAL_REVIEW.md](./LEGAL_REVIEW.md) and [PAYMENTS_TEST.md](./PAYMENTS_TEST.md).

## 6. Pre-launch checklist

- [ ] Cloud Run production service starts and health check passes.
- [ ] Custom domain HTTPS certificate is active; DNS records match the values shown in Google Cloud Console.
- [ ] Supabase Site URL and exact redirect allowlist are set for the final domain.
- [ ] Google OAuth authorized redirect URI and JavaScript origin are verified.
- [ ] Razorpay and PayPal webhook endpoints return successful provider verification results in test mode.
- [ ] Payments are tested in Sandbox/Test Mode first; no live charge is used for QA.
- [ ] Razorpay International Payments activation is confirmed before enabling USD.
- [ ] Privacy, Terms and Refunds drafts have lawyer approval.
- [ ] All `// OWNER_CONFIRM` claims are checked; every `CLAIMS_TO_CONFIRM.md` item is resolved.
- [ ] Every published product has a real cover, useful alt text and an active real file attached.
- [ ] Each product's actual file formats and requirements match its product page.
- [ ] `ALLOW_SEED_FALLBACK=false` is confirmed in Cloud Run runtime config.
- [ ] Production build succeeds after every `[OWNER TO COMPLETE: ...]` placeholder has been replaced with owner-approved text.
- [ ] Sitemap, robots, canonical, Open Graph and JSON-LD are checked against the live URLs.
- [ ] Link audit and responsive/accessibility QA have run against the final preview and production hostname.
- [ ] A real customer flow is verified with controlled test accounts, test payment instruments and private test files before public launch.

Never mark a checklist item complete merely because a source file or deployment exists. Verify the live setting or flow in the relevant console.
