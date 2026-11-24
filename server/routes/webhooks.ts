import express, { Router } from 'express';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { getServerSecrets } from '../lib/config.ts';
import { getSupabaseAdmin } from '../services/supabaseAdmin.ts';
import { verifyRazorpayWebhookSignature, decimalAmountToCents, processWebhookWithLease, extractPayPalCaptureIdFromRefundResource } from '../services/paymentSecurity.ts';
import { verifyPayPalWebhook } from '../services/paymentProviders.ts';

export const webhooksRouter = Router();

// This router is mounted before express.json(); preserve the exact provider payload bytes.
webhooksRouter.use(express.raw({ type: '*/*', limit: '1mb' }));

type OrderRecord = {
  id: string;
  order_number: string;
  status: string;
  total_cents: number;
  currency: string;
  refunded_cents: number;
  provider_payment_id: string | null;
};

const WebhookEventSchema = z.record(z.string(), z.unknown());

function parseRawBody(body: unknown): { raw: Buffer; parsed: Record<string, unknown> } | null {
  if (!Buffer.isBuffer(body)) return null;
  try {
    const parsed = WebhookEventSchema.safeParse(JSON.parse(body.toString('utf8')));
    return parsed.success ? { raw: body, parsed: parsed.data } : null;
  } catch {
    return null;
  }
}

async function findOrderByProviderOrderId(
  providerOrderId: string,
  provider: 'razorpay' | 'paypal'
): Promise<OrderRecord | null> {
  const admin = getSupabaseAdmin();
  if (!admin) return null;
  const { data, error } = await admin
    .from('orders')
    .select('id, order_number, status, total_cents, currency, refunded_cents, provider_payment_id')
    .eq('provider_order_id', providerOrderId)
    .eq('provider', provider)
    .maybeSingle();
  return error || !data ? null : (data as OrderRecord);
}

async function findOrderByProviderPaymentId(
  providerPaymentId: string,
  provider: 'razorpay' | 'paypal'
): Promise<OrderRecord | null> {
  const admin = getSupabaseAdmin();
  if (!admin) return null;
  const { data, error } = await admin
    .from('orders')
    .select('id, order_number, status, total_cents, currency, refunded_cents, provider_payment_id')
    .eq('provider_payment_id', providerPaymentId)
    .eq('provider', provider)
    .maybeSingle();
  return error || !data ? null : (data as OrderRecord);
}

async function processProviderEvent(
  provider: 'razorpay' | 'paypal',
  eventId: string,
  eventType: string,
  payload: Record<string, unknown>,
  handleEvent: () => Promise<void>
): Promise<'processed' | 'duplicate'> {
  const admin = getSupabaseAdmin();
  if (!admin) throw new Error('supabase_not_configured');

  return processWebhookWithLease(
    async () => {
      const { data, error } = await admin.rpc('claim_payment_event', {
        p_provider: provider,
        p_event_id: eventId,
        p_event_type: eventType,
        p_payload: payload,
      });
      if (error) throw new Error('webhook_event_claim_failed');

      const claim = data && typeof data === 'object'
        ? data as { status?: unknown; lock_token?: unknown }
        : null;
      if (claim?.status === 'processed') return null;
      if (claim?.status === 'busy') throw new Error('webhook_event_processing_in_progress');
      if (claim?.status !== 'claimed' || typeof claim.lock_token !== 'string') {
        throw new Error('webhook_event_claim_invalid');
      }
      return claim.lock_token;
    },
    async (claimToken, success, errorMessage) => {
      const { data, error } = await admin.rpc('finish_payment_event', {
        p_provider: provider,
        p_event_id: eventId,
        p_lock_token: claimToken,
        p_success: success,
        p_error: errorMessage ?? null,
      });
      if (error || data !== true) throw new Error('webhook_event_finish_failed');
    },
    handleEvent
  );
}

async function findPayPalOrder(
  providerOrderId: string,
  appOrderId: string
): Promise<OrderRecord | null> {
  if (providerOrderId) {
    const providerOrder = await findOrderByProviderOrderId(providerOrderId, 'paypal');
    if (providerOrder) return providerOrder;
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(appOrderId)) {
    return null;
  }

  const admin = getSupabaseAdmin();
  if (!admin) return null;
  const { data, error } = await admin
    .from('orders')
    .select('id, order_number, status, total_cents, currency, refunded_cents, provider_payment_id')
    .eq('id', appOrderId)
    .eq('provider', 'paypal')
    .maybeSingle();
  return error || !data ? null : (data as OrderRecord);
}

function safeRazorpayPayload(event: Record<string, unknown>): Record<string, unknown> {
  const payload = event.payload as Record<string, unknown> | undefined;
  const payment = payload?.payment as Record<string, unknown> | undefined;
  const paymentEntity = payment?.entity as Record<string, unknown> | undefined;
  const refund = payload?.refund as Record<string, unknown> | undefined;
  const refundEntity = refund?.entity as Record<string, unknown> | undefined;

  return {
    event: typeof event.event === 'string' ? event.event : 'unknown',
    payment: paymentEntity
      ? {
          id: paymentEntity.id,
          order_id: paymentEntity.order_id,
          amount: paymentEntity.amount,
          currency: paymentEntity.currency,
          status: paymentEntity.status,
          amount_refunded: paymentEntity.amount_refunded,
        }
      : undefined,
    refund: refundEntity
      ? {
          id: refundEntity.id,
          payment_id: refundEntity.payment_id,
          amount: refundEntity.amount,
          currency: refundEntity.currency,
          status: refundEntity.status,
        }
      : undefined,
  };
}

async function handleRazorpayEvent(event: Record<string, unknown>): Promise<void> {
  const admin = getSupabaseAdmin();
  if (!admin) throw new Error('supabase_not_configured');

  const eventType = typeof event.event === 'string' ? event.event : '';
  const payload = event.payload as Record<string, unknown> | undefined;
  const payment = payload?.payment as Record<string, unknown> | undefined;
  const paymentEntity = payment?.entity as Record<string, unknown> | undefined;
  const refund = payload?.refund as Record<string, unknown> | undefined;
  const refundEntity = refund?.entity as Record<string, unknown> | undefined;

  if (eventType === 'payment.captured' && paymentEntity) {
    const providerOrderId = typeof paymentEntity.order_id === 'string' ? paymentEntity.order_id : '';
    const paymentId = typeof paymentEntity.id === 'string' ? paymentEntity.id : '';
    const order = providerOrderId
      ? await findOrderByProviderOrderId(providerOrderId, 'razorpay')
      : null;
    if (!order || !paymentId) {
      throw new Error('razorpay_webhook_order_missing');
    }

    const amount = Number(paymentEntity.amount);
    const currency = typeof paymentEntity.currency === 'string' ? paymentEntity.currency : '';
    if (
      paymentEntity.status !== 'captured' ||
      !Number.isSafeInteger(amount) ||
      amount !== Number(order.total_cents) ||
      currency.toUpperCase() !== order.currency
    ) {
      throw new Error('razorpay_webhook_payment_mismatch');
    }

    const { data: paidStatus, error } = await admin.rpc('mark_order_paid', {
      p_order_id: order.id,
      p_provider: 'razorpay',
      p_provider_payment_id: paymentId,
      p_amount_cents: amount,
      p_currency: currency,
    });
    if (error || !['paid', 'already_paid'].includes(String(paidStatus))) {
      throw new Error('razorpay_mark_paid_failed');
    }
    return;
  }

  if (eventType === 'payment.failed' && paymentEntity) {
    const providerOrderId = typeof paymentEntity.order_id === 'string' ? paymentEntity.order_id : '';
    const order = providerOrderId
      ? await findOrderByProviderOrderId(providerOrderId, 'razorpay')
      : null;
    if (!order) throw new Error('webhook_order_missing');
    const { error } = await admin.rpc('mark_order_failed', {
      p_order_id: order.id,
      p_reason: 'razorpay_payment_failed',
    });
    if (error) throw new Error('razorpay_mark_failed_failed');
    return;
  }

  if (eventType === 'refund.processed' && refundEntity) {
    const paymentId = typeof refundEntity.payment_id === 'string' ? refundEntity.payment_id : '';
    const refundId = typeof refundEntity.id === 'string' ? refundEntity.id : '';
    const order = paymentId ? await findOrderByProviderPaymentId(paymentId, 'razorpay') : null;
    if (!order || !refundId) throw new Error('razorpay_refund_order_or_id_missing');

    const refundAmount = Number(refundEntity.amount);
    if (!Number.isSafeInteger(refundAmount) || refundAmount <= 0) {
      throw new Error('razorpay_refund_amount_invalid');
    }
    const { error } = await admin.rpc('apply_order_refund', {
      p_order_id: order.id,
      p_provider: 'razorpay',
      p_provider_refund_id: refundId,
      p_refund_cents: refundAmount,
    });
    if (error) throw new Error('razorpay_apply_refund_failed');
  }
}

function safePayPalPayload(event: Record<string, unknown>): Record<string, unknown> {
  const resource = event.resource as Record<string, unknown> | undefined;
  const amount = resource?.amount as Record<string, unknown> | undefined;
  const supplementary = resource?.supplementary_data as Record<string, unknown> | undefined;
  const related = supplementary?.related_ids as Record<string, unknown> | undefined;

  return {
    event_type: event.event_type,
    resource: resource
      ? {
          id: resource.id,
          status: resource.status,
          amount: amount ? { value: amount.value, currency_code: amount.currency_code } : undefined,
          related_ids: related
            ? {
                order_id: related.order_id,
                capture_id: related.capture_id,
              }
            : undefined,
        }
      : undefined,
  };
}

async function handlePayPalEvent(event: Record<string, unknown>): Promise<void> {
  const admin = getSupabaseAdmin();
  if (!admin) throw new Error('supabase_not_configured');

  const eventType = typeof event.event_type === 'string' ? event.event_type : '';
  const resource = event.resource as Record<string, unknown> | undefined;
  if (!resource) {
    if (['PAYMENT.CAPTURE.COMPLETED', 'PAYMENT.CAPTURE.DENIED', 'PAYMENT.CAPTURE.DECLINED', 'PAYMENT.CAPTURE.REFUNDED'].includes(eventType)) {
      throw new Error('paypal_webhook_resource_missing');
    }
    return;
  }

  const supplementary = resource.supplementary_data as Record<string, unknown> | undefined;
  const related = supplementary?.related_ids as Record<string, unknown> | undefined;
  const paypalProviderOrderId =
    typeof related?.order_id === 'string' ? related.order_id : '';
  const appOrderId = typeof resource.custom_id === 'string' ? resource.custom_id : '';
  const resourceAmount = resource.amount as Record<string, unknown> | undefined;
  const amountCents =
    typeof resourceAmount?.value === 'string' || typeof resourceAmount?.value === 'number'
      ? decimalAmountToCents(resourceAmount.value)
      : null;
  const currency =
    typeof resourceAmount?.currency_code === 'string' ? resourceAmount.currency_code : '';

  if (eventType === 'PAYMENT.CAPTURE.COMPLETED') {
    const order = await findPayPalOrder(paypalProviderOrderId, appOrderId);
    const paymentId = typeof resource.id === 'string' ? resource.id : '';
    if (!order || !paymentId || amountCents === null) {
      throw new Error('paypal_webhook_order_or_amount_missing');
    }
    if (
      resource.status !== 'COMPLETED' ||
      amountCents !== Number(order.total_cents) ||
      currency.toUpperCase() !== order.currency
    ) {
      throw new Error('paypal_webhook_payment_mismatch');
    }

    const { data: paidStatus, error } = await admin.rpc('mark_order_paid', {
      p_order_id: order.id,
      p_provider: 'paypal',
      p_provider_payment_id: paymentId,
      p_amount_cents: amountCents,
      p_currency: currency,
    });
    if (error || !['paid', 'already_paid'].includes(String(paidStatus))) {
      throw new Error('paypal_mark_paid_failed');
    }
    return;
  }

  if (eventType === 'PAYMENT.CAPTURE.DENIED' || eventType === 'PAYMENT.CAPTURE.DECLINED') {
    const order = await findPayPalOrder(paypalProviderOrderId, appOrderId);
    if (!order) throw new Error('webhook_order_missing');
    const { error } = await admin.rpc('mark_order_failed', {
      p_order_id: order.id,
      p_reason: 'paypal_capture_denied',
    });
    if (error) throw new Error('paypal_mark_failed_failed');
    return;
  }

  if (eventType === 'PAYMENT.CAPTURE.REFUNDED') {
    const captureId = extractPayPalCaptureIdFromRefundResource(resource) || '';
    const refundId = typeof resource.id === 'string' ? resource.id : '';
    const order =
      (captureId ? await findOrderByProviderPaymentId(captureId, 'paypal') : null) ||
      await findPayPalOrder(paypalProviderOrderId, appOrderId);
    if (!order || !refundId || amountCents === null || amountCents <= 0) {
      throw new Error('paypal_refund_order_or_amount_invalid');
    }

    const { error } = await admin.rpc('apply_order_refund', {
      p_order_id: order.id,
      p_provider: 'paypal',
      p_provider_refund_id: refundId,
      p_refund_cents: amountCents,
    });
    if (error) throw new Error('paypal_apply_refund_failed');
  }
}

webhooksRouter.post('/razorpay', async (req, res) => {
  const secrets = getServerSecrets();
  const raw = parseRawBody(req.body);
  const signature = req.header('x-razorpay-signature') || '';
  if (!raw || !secrets.razorpayWebhookSecret) {
    res.status(400).json({ error: 'Invalid webhook request.' });
    return;
  }

  if (!verifyRazorpayWebhookSignature(raw.raw, signature, secrets.razorpayWebhookSecret)) {
    res.status(400).json({ error: 'Webhook signature is invalid.' });
    return;
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    res.status(503).json({ error: 'Webhook processing is not configured.' });
    return;
  }

  const eventType = typeof raw.parsed.event === 'string' ? raw.parsed.event : 'unknown';
  const eventId =
    req.header('x-razorpay-event-id') ||
    (typeof raw.parsed.event_id === 'string' ? raw.parsed.event_id : '') ||
    createHash('sha256').update(raw.raw).digest('hex');

  try {
    const outcome = await processProviderEvent(
      'razorpay',
      eventId,
      eventType,
      safeRazorpayPayload(raw.parsed),
      async () => handleRazorpayEvent(raw.parsed)
    );

    res.status(200).json({ received: true, duplicate: outcome === 'duplicate' });
  } catch {
    console.error(JSON.stringify({
      event: 'razorpay_webhook_processing_failed',
      type: eventType,
      eventId,
    }));
    res.status(500).json({ error: 'Webhook processing could not be completed.' });
  }
});

webhooksRouter.post('/paypal', async (req, res) => {
  const secrets = getServerSecrets();
  const raw = parseRawBody(req.body);
  if (!raw || !secrets.paypalWebhookId) {
    res.status(400).json({ error: 'Invalid webhook request.' });
    return;
  }

  const eventId = typeof raw.parsed.id === 'string' ? raw.parsed.id : '';
  const eventType =
    typeof raw.parsed.event_type === 'string' ? raw.parsed.event_type : 'unknown';
  if (!eventId) {
    res.status(400).json({ error: 'The PayPal event id is missing.' });
    return;
  }

  const header = (name: string) => req.header(name) || undefined;
  let verified = false;
  try {
    verified = await verifyPayPalWebhook(
      secrets.paypalWebhookId,
      {
        authAlgo: header('paypal-auth-algo'),
        certUrl: header('paypal-cert-url'),
        transmissionId: header('paypal-transmission-id'),
        transmissionSignature: header('paypal-transmission-sig'),
        transmissionTime: header('paypal-transmission-time'),
      },
      raw.parsed
    );
  } catch {
    console.error(JSON.stringify({
      event: 'paypal_webhook_verification_unavailable',
      eventId,
    }));
    res.status(502).json({ error: 'PayPal webhook verification is temporarily unavailable.' });
    return;
  }

  if (!verified) {
    res.status(400).json({ error: 'Webhook signature is invalid.' });
    return;
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    res.status(503).json({ error: 'Webhook processing is not configured.' });
    return;
  }

  try {
    const outcome = await processProviderEvent(
      'paypal',
      eventId,
      eventType,
      safePayPalPayload(raw.parsed),
      async () => handlePayPalEvent(raw.parsed)
    );

    res.status(200).json({ received: true, duplicate: outcome === 'duplicate' });
  } catch {
    console.error(JSON.stringify({
      event: 'paypal_webhook_processing_failed',
      type: eventType,
      eventId,
    }));
    res.status(500).json({ error: 'Webhook processing could not be completed.' });
  }
});
