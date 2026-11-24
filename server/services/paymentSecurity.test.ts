import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { verifyPayPalWebhook } from './paymentProviders';
import {
  decimalAmountToCents,
  extractPayPalCaptureIdFromRefundResource,
  paymentMatchesOrder,
  processWebhookOnce,
  processWebhookWithLease,
  verifyPayPalWebhookSignature,
  verifyRazorpayCheckoutSignature,
  verifyRazorpayWebhookSignature,
} from './paymentSecurity';

function hmacHex(secret: string, message: string | Buffer): string {
  return createHmac('sha256', secret).update(message).digest('hex');
}

describe('Razorpay signature verification', () => {
  it('accepts a valid checkout signature for order_id|payment_id', () => {
    const signature = hmacHex('razorpay-test-secret', 'order_123|pay_456');
    expect(
      verifyRazorpayCheckoutSignature(
        'order_123',
        'pay_456',
        signature,
        'razorpay-test-secret'
      )
    ).toBe(true);
  });

  it('rejects a checkout signature with a changed order, payment or secret', () => {
    const signature = hmacHex('razorpay-test-secret', 'order_123|pay_456');
    expect(
      verifyRazorpayCheckoutSignature(
        'order_other',
        'pay_456',
        signature,
        'razorpay-test-secret'
      )
    ).toBe(false);
    expect(
      verifyRazorpayCheckoutSignature(
        'order_123',
        'pay_456',
        signature,
        'different-secret'
      )
    ).toBe(false);
    expect(
      verifyRazorpayCheckoutSignature('order_123', 'pay_456', 'not-hex', 'razorpay-test-secret')
    ).toBe(false);
  });

  it('verifies the webhook HMAC against the exact raw request bytes', () => {
    const rawBody = Buffer.from('{"event":"payment.captured","id":"evt_1"}', 'utf8');
    const signature = hmacHex('razorpay-webhook-secret', rawBody);
    expect(
      verifyRazorpayWebhookSignature(rawBody, signature, 'razorpay-webhook-secret')
    ).toBe(true);
    expect(
      verifyRazorpayWebhookSignature(
        Buffer.from(rawBody.toString('utf8') + ' '),
        signature,
        'razorpay-webhook-secret'
      )
    ).toBe(false);
  });
});

describe('PayPal webhook verification wrapper', () => {
  it('posts the original headers, webhook id and event to PayPal verify API', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock: typeof fetch = async (input, init) => {
      requests.push({ url: String(input), init });
      return new Response(JSON.stringify({ verification_status: 'SUCCESS' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const verified = await verifyPayPalWebhookSignature(
      {
        apiBase: 'https://api-m.sandbox.paypal.com/',
        accessToken: 'sandbox-access-token',
        webhookId: 'WH-123',
        headers: {
          authAlgo: 'SHA256withRSA',
          certUrl: 'https://api-m.sandbox.paypal.com/cert',
          transmissionId: 'transmission-1',
          transmissionSignature: 'signature-1',
          transmissionTime: '2026-11-24T10:00:00Z',
        },
        webhookEvent: { id: 'evt-1', event_type: 'PAYMENT.CAPTURE.COMPLETED' },
      },
      fetchMock
    );

    expect(verified).toBe(true);
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe(
      'https://api-m.sandbox.paypal.com/v1/notifications/verify-webhook-signature'
    );
    expect(requests[0].init?.method).toBe('POST');
    expect((requests[0].init?.headers as Record<string, string>).Authorization).toBe(
      'Bearer sandbox-access-token'
    );
    const body = JSON.parse(String(requests[0].init?.body)) as Record<string, unknown>;
    expect(body.webhook_id).toBe('WH-123');
    expect(body.transmission_id).toBe('transmission-1');
    expect(body.webhook_event).toEqual({
      id: 'evt-1',
      event_type: 'PAYMENT.CAPTURE.COMPLETED',
    });
  });

  it('gets a PayPal OAuth token then calls the official webhook verification endpoint', async () => {
    const envKeys = ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_ENV'] as const;
    const previous = envKeys.map((key) => process.env[key]);

    process.env.PAYPAL_CLIENT_ID = 'sandbox-client-id';
    process.env.PAYPAL_CLIENT_SECRET = 'sandbox-client-secret';
    process.env.PAYPAL_ENV = 'sandbox';

    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock: typeof fetch = async (input, init) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.endsWith('/v1/oauth2/token')) {
        return new Response(JSON.stringify({ access_token: 'sandbox-access-token' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ verification_status: 'SUCCESS' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    try {
      const verified = await verifyPayPalWebhook(
        'WH-123',
        {
          authAlgo: 'SHA256withRSA',
          certUrl: 'https://api-m.sandbox.paypal.com/cert',
          transmissionId: 'transmission-2',
          transmissionSignature: 'signature-2',
          transmissionTime: '2026-11-24T10:00:00Z',
        },
        { id: 'evt-2', event_type: 'PAYMENT.CAPTURE.COMPLETED' },
        fetchMock
      );

      expect(verified).toBe(true);
      expect(requests).toHaveLength(2);
      expect(requests[0].url).toBe('https://api-m.sandbox.paypal.com/v1/oauth2/token');
      expect((requests[0].init?.headers as Record<string, string>).Authorization).toBe(
        'Basic ' + Buffer.from('sandbox-client-id:sandbox-client-secret').toString('base64')
      );
      expect(requests[1].url).toBe(
        'https://api-m.sandbox.paypal.com/v1/notifications/verify-webhook-signature'
      );
      expect((requests[1].init?.headers as Record<string, string>).Authorization).toBe(
        'Bearer sandbox-access-token'
      );
    } finally {
      for (let index = 0; index < envKeys.length; index += 1) {
        const key = envKeys[index];
        const value = previous[index];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it('rejects failed or malformed PayPal verification responses', async () => {
    const failFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ verification_status: 'FAILURE' }), { status: 200 });
    const badFetch: typeof fetch = async () => new Response('{}', { status: 401 });

    const input = {
      apiBase: 'https://api-m.sandbox.paypal.com',
      accessToken: 'token',
      webhookId: 'WH-123',
      headers: {
        authAlgo: 'SHA256withRSA',
        certUrl: 'https://api-m.sandbox.paypal.com/cert',
        transmissionId: 'id',
        transmissionSignature: 'signature',
        transmissionTime: '2026-11-24T10:00:00Z',
      },
      webhookEvent: { id: 'evt-1' },
    };

    expect(await verifyPayPalWebhookSignature(input, failFetch)).toBe(false);
    expect(await verifyPayPalWebhookSignature(input, badFetch)).toBe(false);
  });

  it('does not call PayPal when required transmission headers are missing', async () => {
    const fetchMock = vi.fn();
    const verified = await verifyPayPalWebhookSignature(
      {
        apiBase: 'https://api-m.sandbox.paypal.com',
        accessToken: 'token',
        webhookId: 'WH-123',
        headers: {},
        webhookEvent: { id: 'evt-1' },
      },
      fetchMock as unknown as typeof fetch
    );
    expect(verified).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('payment amount and webhook idempotency', () => {
  it('rejects amount and currency mismatches before payment confirmation', () => {
    expect(paymentMatchesOrder(3900, 'USD', 3900, 'USD')).toBe(true);
    expect(paymentMatchesOrder(3901, 'USD', 3900, 'USD')).toBe(false);
    expect(paymentMatchesOrder(3900, 'EUR', 3900, 'USD')).toBe(false);
    expect(paymentMatchesOrder(Number.NaN, 'USD', 3900, 'USD')).toBe(false);
  });

  it('parses PayPal decimal values into integer cents without floating point drift', () => {
    expect(decimalAmountToCents('39.00')).toBe(3900);
    expect(decimalAmountToCents('0.09')).toBe(9);
    expect(decimalAmountToCents('1.2')).toBe(120);
    expect(decimalAmountToCents('1.234')).toBeNull();
    expect(decimalAmountToCents('-1.00')).toBeNull();
  });

  it('skips handling when the payment event was already recorded', async () => {
    const recordEvent = vi.fn(async () => false);
    const handleEvent = vi.fn(async () => undefined);

    const outcome = await processWebhookOnce(recordEvent, handleEvent);

    expect(outcome).toBe('duplicate');
    expect(recordEvent).toHaveBeenCalledTimes(1);
    expect(handleEvent).not.toHaveBeenCalled();
  });

  it('records a new event before applying it exactly once', async () => {
    const calls: string[] = [];
    const outcome = await processWebhookOnce(
      async () => {
        calls.push('record');
        return true;
      },
      async () => {
        calls.push('handle');
      }
    );

    expect(outcome).toBe('processed');
    expect(calls).toEqual(['record', 'handle']);
  });
});


describe('retryable webhook processing leases', () => {
  it('acknowledges completed deliveries without re-running the handler', async () => {
    const claim = vi.fn(async () => null);
    const finish = vi.fn(async () => undefined);
    const handle = vi.fn(async () => undefined);
    const result = await processWebhookWithLease(claim, finish, handle);
    expect(result).toBe('duplicate');
    expect(claim).toHaveBeenCalledOnce();
    expect(finish).not.toHaveBeenCalled();
    expect(handle).not.toHaveBeenCalled();
  });

  it('marks a successful delivery processed only after the handler succeeds', async () => {
    const calls: string[] = [];
    const result = await processWebhookWithLease(
      async () => { calls.push('claim'); return 'lease-1'; },
      async (_token, success) => { calls.push(success ? 'finish-success' : 'finish-failure'); },
      async () => { calls.push('handle'); }
    );
    expect(result).toBe('processed');
    expect(calls).toEqual(['claim', 'handle', 'finish-success']);
  });

  it('releases a failed delivery for provider retry and rethrows the handler error', async () => {
    const finish = vi.fn(async (_token: string, success: boolean, message?: string) => {
      expect(success).toBe(false);
      expect(message).toBe('temporary_database_failure');
    });
    const handlerError = new Error('temporary_database_failure');
    await expect(
      processWebhookWithLease(
        async () => 'lease-2',
        finish,
        async () => { throw handlerError; }
      )
    ).rejects.toBe(handlerError);
    expect(finish).toHaveBeenCalledOnce();
  });
});


describe('PayPal refund resource references', () => {
  it('extracts the capture ID from the refund HATEOAS up link', () => {
    expect(extractPayPalCaptureIdFromRefundResource({
      id: '1JU08902781691411',
      links: [
        { rel: 'self', href: 'https://api.paypal.com/v2/payments/refunds/1JU08902781691411' },
        { rel: 'up', href: 'https://api.paypal.com/v2/payments/captures/2GG279541U471931P' },
      ],
    })).toBe('2GG279541U471931P');
  });

  it('prefers the explicit related capture ID when present', () => {
    expect(extractPayPalCaptureIdFromRefundResource({
      supplementary_data: { related_ids: { capture_id: '8VN12345AB678901C' } },
      links: [{ rel: 'up', href: 'https://api.paypal.com/v2/payments/captures/DIFFERENT12345' }],
    })).toBe('8VN12345AB678901C');
  });

  it('rejects arbitrary hosts, malformed URLs and unexpected paths', () => {
    expect(extractPayPalCaptureIdFromRefundResource({
      links: [{ rel: 'up', href: 'https://evil.example/v2/payments/captures/2GG279541U471931P' }],
    })).toBeNull();
    expect(extractPayPalCaptureIdFromRefundResource({
      links: [{ rel: 'up', href: 'not-a-url' }],
    })).toBeNull();
    expect(extractPayPalCaptureIdFromRefundResource({})).toBeNull();
  });
});
