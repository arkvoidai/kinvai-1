import { getServerSecrets } from '../lib/config.ts';
import { decimalAmountToCents, paymentMatchesOrder } from './paymentSecurity.ts';

export class ProviderApiError extends Error {
  constructor(
    message: string,
    readonly provider: 'razorpay' | 'paypal',
    readonly status: number,
    readonly code: string
  ) {
    super(message);
    this.name = 'ProviderApiError';
  }
}

type JsonRecord = Record<string, unknown>;

async function readProviderJson(
  response: Response,
  provider: 'razorpay' | 'paypal'
): Promise<JsonRecord> {
  const payload = (await response.json().catch(() => ({}))) as JsonRecord;
  if (!response.ok) {
    const error = (payload.error && typeof payload.error === 'object'
      ? payload.error
      : payload) as JsonRecord;
    const code =
      typeof error.code === 'string'
        ? error.code
        : typeof error.name === 'string'
          ? error.name
          : 'provider_request_failed';
    const description =
      typeof error.description === 'string'
        ? error.description
        : typeof error.message === 'string'
          ? error.message
          : 'Provider request failed.';
    throw new ProviderApiError(description, provider, response.status, code);
  }
  return payload;
}

export function getPayPalApiBase(): string {
  return getServerSecrets().paypalEnv === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';
}

export interface ProviderOrderInput {
  orderId: string;
  orderNumber: string;
  amountCents: number;
}

export interface CreatedRazorpayOrder {
  id: string;
  amount: number;
  currency: string;
}

export interface CreatedPayPalOrder {
  id: string;
}

export async function createRazorpayOrder(
  input: ProviderOrderInput,
  fetchImpl: typeof fetch = fetch
): Promise<CreatedRazorpayOrder> {
  const secrets = getServerSecrets();
  if (!secrets.razorpayKeyId || !secrets.razorpayKeySecret) {
    throw new ProviderApiError('Razorpay is not configured.', 'razorpay', 503, 'not_configured');
  }

  const authorization = Buffer.from(
    `${secrets.razorpayKeyId}:${secrets.razorpayKeySecret}`
  ).toString('base64');

  const response = await fetchImpl('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${authorization}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount: input.amountCents,
      currency: 'USD',
      receipt: input.orderNumber,
      notes: { kinvai_order_id: input.orderId },
    }),
  });

  const payload = await readProviderJson(response, 'razorpay');
  const order = {
    id: typeof payload.id === 'string' ? payload.id : '',
    amount: Number(payload.amount),
    currency: typeof payload.currency === 'string' ? payload.currency : '',
  };

  if (
    !order.id ||
    !paymentMatchesOrder(order.amount, order.currency, input.amountCents, 'USD')
  ) {
    throw new ProviderApiError(
      'Razorpay returned an order with a different amount or currency.',
      'razorpay',
      502,
      'provider_order_mismatch'
    );
  }
  return order;
}

export async function getPayPalAccessToken(
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  const secrets = getServerSecrets();
  if (!secrets.paypalClientId || !secrets.paypalClientSecret) {
    throw new ProviderApiError('PayPal is not configured.', 'paypal', 503, 'not_configured');
  }

  const authorization = Buffer.from(
    `${secrets.paypalClientId}:${secrets.paypalClientSecret}`
  ).toString('base64');
  const response = await fetchImpl(`${getPayPalApiBase()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${authorization}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const payload = await readProviderJson(response, 'paypal');
  if (typeof payload.access_token !== 'string' || !payload.access_token) {
    throw new ProviderApiError('PayPal did not return an access token.', 'paypal', 502, 'invalid_token');
  }
  return payload.access_token;
}

export async function createPayPalOrder(
  input: ProviderOrderInput,
  fetchImpl: typeof fetch = fetch
): Promise<CreatedPayPalOrder> {
  const token = await getPayPalAccessToken(fetchImpl);
  const value = (input.amountCents / 100).toFixed(2);
  const response = await fetchImpl(`${getPayPalApiBase()}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'PayPal-Request-Id': input.orderNumber,
    },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [
        {
          reference_id: input.orderNumber,
          custom_id: input.orderId,
          amount: { currency_code: 'USD', value },
        },
      ],
    }),
  });
  const payload = await readProviderJson(response, 'paypal');
  const units = Array.isArray(payload.purchase_units) ? payload.purchase_units : [];
  const unit = units[0] as JsonRecord | undefined;
  const amount = unit?.amount as JsonRecord | undefined;
  const returnedAmount =
    typeof amount?.value === 'string' || typeof amount?.value === 'number'
      ? decimalAmountToCents(amount.value)
      : null;
  const returnedCurrency =
    typeof amount?.currency_code === 'string' ? amount.currency_code : '';

  if (
    typeof payload.id !== 'string' ||
    !payload.id ||
    returnedAmount === null ||
    !paymentMatchesOrder(returnedAmount, returnedCurrency, input.amountCents, 'USD')
  ) {
    throw new ProviderApiError(
      'PayPal returned an order with a different amount or currency.',
      'paypal',
      502,
      'provider_order_mismatch'
    );
  }
  return { id: payload.id };
}

export async function capturePayPalOrder(
  paypalOrderId: string,
  requestId: string,
  fetchImpl: typeof fetch = fetch
): Promise<JsonRecord> {
  const token = await getPayPalAccessToken(fetchImpl);
  const response = await fetchImpl(
    `${getPayPalApiBase()}/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'PayPal-Request-Id': requestId,
      },
      body: '{}',
    }
  );
  return readProviderJson(response, 'paypal');
}

export async function verifyPayPalWebhook(
  webhookId: string,
  headers: {
    authAlgo?: string;
    certUrl?: string;
    transmissionId?: string;
    transmissionSignature?: string;
    transmissionTime?: string;
  },
  webhookEvent: unknown,
  fetchImpl: typeof fetch = fetch
): Promise<boolean> {
  const token = await getPayPalAccessToken(fetchImpl);
  const { verifyPayPalWebhookSignature } = await import('./paymentSecurity.ts');
  return verifyPayPalWebhookSignature(
    {
      apiBase: getPayPalApiBase(),
      accessToken: token,
      webhookId,
      headers,
      webhookEvent,
    },
    fetchImpl
  );
}

export function getPayPalCaptureTotals(payload: JsonRecord): {
  captureId: string | null;
  status: string | null;
  amountCents: number | null;
  currency: string | null;
} {
  const units = Array.isArray(payload.purchase_units) ? payload.purchase_units : [];
  const unit = units[0] as JsonRecord | undefined;
  const payments = unit?.payments as JsonRecord | undefined;
  const captures = Array.isArray(payments?.captures) ? payments.captures : [];
  const capture = captures[0] as JsonRecord | undefined;
  const amount = capture?.amount as JsonRecord | undefined;

  return {
    captureId: typeof capture?.id === 'string' ? capture.id : null,
    status: typeof capture?.status === 'string' ? capture.status : null,
    amountCents:
      typeof amount?.value === 'string' || typeof amount?.value === 'number'
        ? decimalAmountToCents(amount.value)
        : null,
    currency: typeof amount?.currency_code === 'string' ? amount.currency_code : null,
  };
}

export function isRazorpayCurrencyUnavailable(error: ProviderApiError): boolean {
  return (
    error.provider === 'razorpay' &&
    (error.status === 400 || error.status === 422) &&
    /currency|international|usd|unsupported/i.test(`${error.code} ${error.message}`)
  );
}
