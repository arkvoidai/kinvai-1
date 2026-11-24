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
