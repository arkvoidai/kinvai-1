# Legal review required before launch

**Status: DRAFT — NOT APPROVED FOR PUBLICATION**

A qualified lawyer familiar with the laws that apply to Arkvoid Inc. and the customers Kinvai serves must review all three legal drafts before production launch:

- `/legal/privacy` — Google sign-in data, Supabase account/session handling, Razorpay and PayPal processing, necessary browser storage, retention, deletion requests and international transfers.
- `/legal/terms` — seller identity and jurisdiction, consumer eligibility, digital delivery, taxes, warranties, liability, disputes and governing law.
- `/legal/refunds` — digital-content consent, withdrawal rights, defective or inaccessible files, duplicate payments, partial downloads, payment-provider processing and refund timelines.

The source pages contain `[OWNER TO COMPLETE: ...]` markers for facts and policy choices that are not established by the repository. The production build intentionally fails while any such marker remains under `src/`. Do not remove a marker by guessing. The owner must supply the missing facts, then have the lawyer review the final wording.

The About and How it works pages also contain `// OWNER_CONFIRM` comments beside claims about product preparation, checking and delivery. The owner must verify each claim against the actual operating process before launch.

No legal advice is provided by these drafts. Do not treat a source-code build, payment-provider configuration or this review checklist as legal approval.
