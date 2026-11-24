import { createHmac, timingSafeEqual } from 'node:crypto';

function verifyHexHmac(secret: string, message: string | Buffer, signature: string): boolean {
  if (!secret || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = createHmac('sha256', secret).update(message).digest();
  const supplied = Buffer.from(signature, 'hex');
  return supplied.length === expected.length && timingSafeEqual(expected, supplied);
}

export function verifyRazorpayCheckoutSignature(
  orderId: string,
  paymentId: string,
  signature: string,
  keySecret: string
): boolean {
  return verifyHexHmac(keySecret, `${orderId}|${paymentId}`, signature);
}

export function verifyRazorpayWebhookSignature(
  rawBody: Buffer,
  signature: string,
  webhookSecret: string
): boolean {
  return verifyHexHmac(webhookSecret, rawBody, signature);
}

export function paymentMatchesOrder(
  actualAmountCents: number,
  actualCurrency: string,
  expectedAmountCents: number,
  expectedCurrency: string
): boolean {
  return (
    Number.isSafeInteger(actualAmountCents) &&
    Number.isSafeInteger(expectedAmountCents) &&
    actualAmountCents === expectedAmountCents &&
    actualCurrency.toUpperCase() === expectedCurrency.toUpperCase()
  );
}

export function decimalAmountToCents(value: string | number): number | null {
  const text = String(value);
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
}

export interface PayPalWebhookHeaders {
  authAlgo?: string;
  certUrl?: string;
  transmissionId?: string;
  transmissionSignature?: string;
  transmissionTime?: string;
}

export interface PayPalWebhookVerificationInput {
  apiBase: string;
  accessToken: string;
  webhookId: string;
  headers: PayPalWebhookHeaders;
  webhookEvent: unknown;
}

export async function verifyPayPalWebhookSignature(
  input: PayPalWebhookVerificationInput,
  fetchImpl: typeof fetch = fetch
): Promise<boolean> {
  const {
    authAlgo,
    certUrl,
    transmissionId,
    transmissionSignature,
    transmissionTime,
  } = input.headers;

  if (
    !input.accessToken ||
    !input.webhookId ||
    !authAlgo ||
    !certUrl ||
    !transmissionId ||
    !transmissionSignature ||
    !transmissionTime
  ) {
    return false;
  }

  try {
    const response = await fetchImpl(
      `${input.apiBase.replace(/\/+$/, '')}/v1/notifications/verify-webhook-signature`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${input.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          auth_algo: authAlgo,
          cert_url: certUrl,
          transmission_id: transmissionId,
          transmission_sig: transmissionSignature,
          transmission_time: transmissionTime,
          webhook_id: input.webhookId,
          webhook_event: input.webhookEvent,
        }),
      }
    );

    if (!response.ok) return false;
    const payload = (await response.json()) as { verification_status?: string };
    return payload.verification_status === 'SUCCESS';
  } catch {
    return false;
  }
}

/**
 * A webhook event is applied only after the database's unique event key is recorded.
 * A false result means the provider retried an event already committed here.
 */
export async function processWebhookOnce(
  recordEvent: () => Promise<boolean>,
  handleEvent: () => Promise<void>
): Promise<'processed' | 'duplicate'> {
  const inserted = await recordEvent();
  if (!inserted) return 'duplicate';
  await handleEvent();
  return 'processed';
}


/**
 * Processes a webhook only after acquiring a database-backed lease.
 * Failed handlers release the lease into a retryable state. Lease tokens ensure
 * an expired worker cannot complete an event reclaimed by a later delivery.
 */
export async function processWebhookWithLease(
  claimEvent: () => Promise<string | null>,
  finishEvent: (claimToken: string, success: boolean, errorMessage?: string) => Promise<void>,
  handleEvent: () => Promise<void>
): Promise<'processed' | 'duplicate'> {
  const claimToken = await claimEvent();
  if (!claimToken) return 'duplicate';

  try {
    await handleEvent();
    await finishEvent(claimToken, true);
    return 'processed';
  } catch (error) {
    const message = error instanceof Error ? error.message : 'webhook_processing_failed';
    try {
      await finishEvent(claimToken, false, message);
    } catch (finishError) {
      console.error(JSON.stringify({
        event: 'webhook_failure_state_persist_failed',
        code: finishError instanceof Error ? finishError.name : 'unknown',
      }));
    }
    throw error;
  }
}


/** Extracts the capture ID from the refund resource's PayPal HATEOAS `up` link. */
export function extractPayPalCaptureIdFromRefundResource(resource: unknown): string | null {
  if (!resource || typeof resource !== 'object' || Array.isArray(resource)) return null;
  const value = resource as Record<string, unknown>;

  const supplementary = value.supplementary_data;
  if (supplementary && typeof supplementary === 'object' && !Array.isArray(supplementary)) {
    const related = (supplementary as Record<string, unknown>).related_ids;
    if (related && typeof related === 'object' && !Array.isArray(related)) {
      const captureId = (related as Record<string, unknown>).capture_id;
      if (typeof captureId === 'string' && /^[A-Za-z0-9]{5,80}$/.test(captureId)) {
        return captureId;
      }
    }
  }

  if (!Array.isArray(value.links)) return null;
  for (const link of value.links) {
    if (!link || typeof link !== 'object' || Array.isArray(link)) continue;
    const candidate = link as Record<string, unknown>;
    if (candidate.rel !== 'up' || typeof candidate.href !== 'string') continue;

    try {
      const url = new URL(candidate.href);
      if (!['api-m.paypal.com', 'api.paypal.com', 'api-m.sandbox.paypal.com', 'api.sandbox.paypal.com'].includes(url.hostname)) {
        continue;
      }
      const match = url.pathname.match(/^\/v2\/payments\/captures\/([A-Za-z0-9]{5,80})\/?$/);
      if (match) return match[1];
    } catch {
      // Ignore malformed HATEOAS links and continue checking the remaining links.
    }
  }

  return null;
}
