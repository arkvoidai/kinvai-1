# Kinvai — Claims & Policies Requiring Owner Confirmation

This file records items that still require external account, operational or jurisdictional verification. Customer-facing source copy must not claim facts that are not established.

## Brand and catalogue
- [x] Owner instructed that Arkvoid Inc. is the public-facing business name. Site wording does not claim a verified incorporation status, jurisdiction, registered office or company number.
- [x] Homepage quality/update claims were narrowed to avoid promises of testing, documentation packs, file cleanliness or lifetime updates that were not evidenced.
- [ ] Confirm the business's legal contracting identity, registration jurisdiction and service address before adding those details to customer disclosures.
- [ ] Verify product-page contents, formats, requirements, deliverables, version and first-hour notes against each live product before making stronger completeness claims.

## Checkout and fulfilment
- [ ] Confirm Razorpay and PayPal production account arrangements and which provider flags are enabled in production.
- [x] Source inspection confirms the checkout server validates order totals and verifies payment state before fulfilment; confirm live provider credentials, webhook setup and production test purchases separately.
- [x] Source inspection confirms private downloads require an active entitlement, use a 60-second signed URL and attempt to log account/product/file, IP-derived HMAC and user-agent details.
- [ ] Confirm tax/VAT handling and USD display are appropriate for every target market.
- [ ] Confirm Razorpay International Payments is activated before enabling USD.

## Support, privacy and legal
- [ ] Confirm heyarkvoid@gmail.com is actively monitored and any response-time statement before publishing an SLA.
- [x] Source inspection identifies the account/profile, order, download, contact and newsletter data categories described in the Privacy page; verify provider-side logs, backups, cookies and storage inventories in the live hosting/provider consoles.
- [ ] Set and document specific retention periods for profiles, orders, download logs, contact messages, newsletter records and backups.
- [ ] Obtain jurisdiction-specific legal review of Privacy, Terms and Refunds and verify mandatory local disclosures before relying on them as legal terms.
- [x] Owner delegated a conservative default refund policy for this release: contact within 14 calendar days for store-policy review, without limiting longer or non-waivable statutory rights.

## Release
- [x] Resolve all owner-confirmation comments and placeholders in application source without disabling the production gate.
- [ ] Keep ALLOW_SEED_FALLBACK=false in production.
- [ ] Verify a real cover and active real private file exist for every published product.
- [ ] Complete controlled provider, Google OAuth, signed download, responsive and accessibility QA.
