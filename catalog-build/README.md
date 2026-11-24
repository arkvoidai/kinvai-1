# Run the Shop — product bundle batch

Four draft packaged digital products were assembled locally as versioned ZIP archives. Each ZIP includes an offline interactive HTML tool, an Excel workbook, a PDF playbook, onboarding notes and a single-seat licence. The marketplace launch bundle additionally includes four SOP markdown files.

- `kinvai-marketplace-launch-system-v1.0.zip` — KV-RTS-001, $49 proposed
- `kinvai-pricing-margin-and-profit-calculator-v1.0.zip` — KV-RTS-002, $29 proposed
- `kinvai-seller-operations-command-center-v1.0.zip` — KV-RTS-003, $44 proposed
- `kinvai-startup-saas-financial-model-os-v1.0.zip` — KV-RTS-004, $59 proposed

## Verification and limitations
The ZIPs passed `unzip -t`; embedded JS passed Node syntax checks during assembly. The HTML simulators are preliminary generic scoring/simulation shells, not independently QA'd dedicated domain models. Workbook formulas and PDF content were not independently audited. These packages are drafts pending review.

This PR is limited to this README inventory: the local ZIP binaries cannot be transferred to the repository through the available GitHub file-content operation in this session. No production Supabase data or Storage objects were changed.
