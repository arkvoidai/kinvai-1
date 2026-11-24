# Server secrets and public configuration

This file records the configuration **names only**. Never paste secret values into documentation, source code, client bundles, screenshots, issues, or logs.

## Server-only secrets

Configure these in the production server's secret manager / deployment environment:

- `SUPABASE_SERVICE_ROLE_KEY` — server-only Supabase service-role key.
- `RAZORPAY_KEY_ID` — Razorpay merchant key ID.
- `RAZORPAY_KEY_SECRET` — Razorpay API and checkout-signature secret.
- `RAZORPAY_WEBHOOK_SECRET` — Razorpay webhook signing secret.
- `PAYPAL_CLIENT_ID` — PayPal REST app client ID.
- `PAYPAL_CLIENT_SECRET` — PayPal REST app client secret.
- `PAYPAL_WEBHOOK_ID` — Webhook ID returned by PayPal when the webhook endpoint is registered.
- `PAYPAL_ENV` — `sandbox` or `live`; selects the PayPal API environment.

The same server environment also uses:

- `SUPABASE_URL`
- `GEMINI_API_KEY`
- `GEMINI_IMAGE_MODEL`
- `SITE_URL`
- `APP_URL`
- `ALLOW_SEED_FALLBACK`

## Public browser configuration

- `SUPABASE_PUBLISHABLE_KEY` — intentionally published by the app as the Supabase publishable key. It is not a service-role credential.
- The app injects only provider availability booleans (`flags.razorpay`, `flags.paypal`) into `window.__KINVAI__`. Payment keys, provider access tokens and signing secrets are not injected as public config.

## Rules

1. Keep all payment credentials and Supabase service-role credentials server-side.
2. Do not add server secrets to `VITE_*` variables, React components, client-side config files, or browser local storage.
3. Logs may contain an internal order ID, provider name, event ID, HTTP status and provider error code. Do not log access tokens, authorization headers, API secrets, webhook secrets, full provider payloads, payment method details, or card data.
4. Rotate a credential in its provider console and server secret manager if it is exposed. Do not record the replacement value here.
5. `PAYPAL_ENV=sandbox` is for PayPal Sandbox only. Use `live` only after the merchant account and webhook endpoint have been intentionally configured for production.
