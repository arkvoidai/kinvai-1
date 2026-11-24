# Payments and downloads test guide

This guide is for controlled provider test environments. The repository changes do not activate merchant accounts, enable international payments, or create provider credentials.

## Before testing

1. Deploy the branch to a private preview environment with the server secrets configured from `docs/SECRETS.md`.
2. Confirm the Supabase URL and service-role key point to the intended Kinvai project.
3. Confirm the product is `published`, the signed-in test buyer has no active entitlement for it, and one active file exists in `product_files` for the download test.
4. Use a normal browser tab, sign in with Google, and open `/checkout`. Preview/seed products are intentionally blocked from purchase.
5. Check that the order total remains USD. The browser sends only product IDs and the provider name; the database RPC calculates the actual amount.

## Razorpay test mode

1. In the Razorpay Dashboard, select the Test Mode environment and create/use an API key pair for the intended merchant account.
2. Set the server's `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` using that test key pair.
3. Verify the merchant account is approved and configured for USD / International Payments before testing the Kinvai USD order. This is an account capability; adding credentials alone does not enable USD. The server sends the database total in integer cents and explicitly requests `currency: "USD"`.
4. In the Razorpay Dashboard's webhook settings, add the preview server URL with path `/api/webhooks/razorpay`. Set a fresh webhook secret in `RAZORPAY_WEBHOOK_SECRET`.
5. Subscribe to the relevant events:
   - `payment.captured`
   - `payment.failed`
   - `refund.processed`
6. Save the webhook and verify the dashboard shows it as active.
7. Open `/checkout`, keep a test product in the cart, choose Razorpay, and complete the payment with the current test payment details supplied by Razorpay for that test account. Do not use live card or bank details in Test Mode.
8. Confirm the browser reaches `/checkout/success?order=...`, the order status becomes `paid`, and an entitlement is created. Check `orders`, `order_items`, `payment_events` and `entitlements` in Supabase.
9. Exercise a failed test payment and confirm the designed `/checkout/failed` state.
10. Use the provider's test refund flow and confirm `refund.processed` updates the order. A full refund should revoke the order's entitlements.

If Razorpay rejects the USD order because the currency or international payments capability is unavailable, the server records a structured reason code/status (never credentials) in the private `site_settings` key `payment_provider_runtime_status` and the checkout UI displays **Temporarily unavailable**. Enable/confirm the merchant capability, then remove or reset the private status row before retrying. This persisted status is shared across app instances; it is not cleared automatically by a restart.

## PayPal Sandbox

1. In the PayPal Developer Dashboard, create or select a Sandbox REST app and copy its Client ID and Secret into the server's `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`.
2. Set `PAYPAL_ENV=sandbox`.
3. Create/select a Sandbox buyer and business account in the PayPal Developer Dashboard.
4. In the app's Webhooks area, register the exact preview server URL with path `/api/webhooks/paypal`.
5. Copy the resulting webhook ID into `PAYPAL_WEBHOOK_ID`. Subscribe to:
   - `PAYMENT.CAPTURE.COMPLETED`
   - `PAYMENT.CAPTURE.DENIED`
   - `PAYMENT.CAPTURE.REFUNDED`
6. Open `/checkout`, choose PayPal, and complete the flow using the Sandbox buyer account.
7. Confirm the capture response is `COMPLETED`, the amount and `USD` currency match the database order, the order is `paid`, and the entitlement is created.
8. Exercise cancel, denied and refund cases with the Sandbox tools. Confirm their order states and entitlement behavior.
9. Replay a webhook delivery from the PayPal Developer Dashboard and confirm the endpoint reports a duplicate without granting entitlements a second time.

The application uses PayPal's Sandbox API host when `PAYPAL_ENV=sandbox` and the live host only when explicitly configured as `live`.

## Signed download verification

1. Sign in as a buyer with an active entitlement for a product.
2. Open `/account?tab=library` and choose **Download**.
3. For a product with one active file, confirm `GET /api/download/:productId` returns a short-lived URL and starts the download.
4. For a product with several active files, confirm the file sheet lists only names, versions and file sizes; selecting one file signs only that file.
5. Confirm the link expires after approximately 60 seconds, and that repeated requests create separate `download_logs` rows.
6. Sign in as a different user with no active entitlement and confirm the endpoint returns 403.
7. Revoke the test entitlement and repeat; downloads must be denied.
8. Confirm the API never returns the permanent private storage path.

## Automated tests and current verification boundary

The Vitest unit tests cover:

- Razorpay checkout HMAC-SHA256 signature verification.
- Razorpay webhook HMAC-SHA256 over the raw request body.
- PayPal webhook verification request construction with mocked `fetch`.
- Amount/currency mismatch rejection and decimal-to-cents parsing.
- Duplicate webhook idempotency (event handler is not run again).

**Not tested against live provider sandboxes by the repository automation in this change:** actual Razorpay USD merchant activation, a Razorpay Test Mode charge/refund/webhook delivery, PayPal Sandbox buyer approval/capture/refund/webhook delivery, and a real Supabase private Storage signed download. These require owner-provided provider credentials, account activation and manual dashboard setup. Do not treat the presence of unit tests or a GitHub/Vercel preview as proof of sandbox or live payment readiness.
