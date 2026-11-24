import express, { Router } from 'express';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { getServerSecrets } from '../lib/config.ts';
import { getSupabaseAdmin } from '../services/supabaseAdmin.ts';
import { verifyRazorpayWebhookSignature, decimalAmountToCents, processWebhookOnce } from '../services/paymentSecurity.ts';
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
      console.warn(JSON.stringify({ event: 'razorpay_webhook_order_missing', type: eventType }));
      return;
    }

    const amount = Number(paymentEntity.amount);
    const currency = typeof paymentEntity.currency === 'string' ? paymentEntity.currency : '';
    if (
      paymentEntity.status !== 'captured' ||
      !Number.isSafeInteger(amount) ||
      amount !== Number(order.total_cents) ||
      currency.toUpperCase() !== order.currency
    ) {
      console.error(JSON.stringify({ event: 'razorpay_webhook_payment_mismatch', orderId: order.id }));
      return;
    }

    const { error } = await admin.rpc('mark_order_paid', {
      p_order_id: order.id,
      p_provider: 'razorpay',
      p_provider_payment_id: paymentId,
      p_amount_cents: amount,
      p_currency: currency,
    });
    if (error) throw new Error('razorpay_mark_paid_failed');
    return;
  }

  if (eventType === 'payment.failed' && paymentEntity) {
    const providerOrderId = typeof paymentEntity.order_id === 'string' ? paymentEntity.order_id : '';
    const order = providerOrderId
      ? await findOrderByProviderOrderId(providerOrderId, 'razorpay')
      : null;
    if (!order) return;
    const { error } = await admin.rpc('mark_order_failed', {
      p_order_id: order.id,
      p_reason: 'razorpay_payment_failed',
    });
    if (error) throw new Error('razorpay_mark_failed_failed');
    return;
  }

  if (eventType === 'refund.processed' && refundEntity) {
    const paymentId = typeof refundEntity.payment_id === 'string' ? refundEntity.payment_id : '';
    const order = paymentId ? await findOrderByProviderPaymentId(paymentId, 'razorpay') : null;
    if (!order) return;

    const refundAmount = Number(refundEntity.amount);
    if (!Number.isSafeInteger(refundAmount) || refundAmount <= 0) {
      console.warn(JSON.stringify({ event: 'razorpay_refund_amount_invalid', orderId: order.id }));
      return;
    }

    const totalRefunded = Math.min(
      Number(order.total_cents),
      Number(order.refunded_cents || 0) + refundAmount
    );
    const { error } = await admin.rpc('mark_order_refunded', {
      p_order_id: order.id,
      p_refunded_cents: totalRefunded,
    });
    if (error) throw new Error('razorpay_mark_refunded_failed');
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
  if (!resource) return;

  const supplementary = resource.supplementary_data as Record<string, unknown> | undefined;
  const related = supplementary?.related_ids as Record<string, unknown> | undefined;
  const paypalOrderId =
    typeof related?.order_id === 'string'
      ? related.order_id
      : typeof resource.custom_id === 'string'
        ? resource.custom_id
        : '';
  const resourceAmount = resource.amount as Record<string, unknown> | undefined;
  const amountCents =
    typeof resourceAmount?.value === 'string' || typeof resourceAmount?.value === 'number'
      ? decimalAmountToCents(resourceAmount.value)
      : null;
  const currency =
    typeof resourceAmount?.currency_code === 'string' ? resourceAmount.currency_code : '';

  if (eventType === 'PAYMENT.CAPTURE.COMPLETED') {
    const order = paypalOrderId
      ? await findOrderByProviderOrderId(paypalOrderId, 'paypal')
      : null;
    const paymentId = typeof resource.id === 'string' ? resource.id : '';
    if (!order || !paymentId || amountCents === null) return;
    if (
      resource.status !== 'COMPLETED' ||
      amountCents !== Number(order.total_cents) ||
      currency.toUpperCase() !== order.currency
    ) {
      console.error(JSON.stringify({ event: 'paypal_webhook_payment_mismatch', orderId: order.id }));
      return;
    }

    const { error } = await admin.rpc('mark_order_paid', {
      p_order_id: order.id,
      p_provider: 'paypal',
      p_provider_payment_id: paymentId,
      p_amount_cents: amountCents,
      p_currency: currency,
    });
    if (error) throw new Error('paypal_mark_paid_failed');
    return;
  }

  if (eventType === 'PAYMENT.CAPTURE.DENIED') {
    const order = paypalOrderId
      ? await findOrderByProviderOrderId(paypalOrderId, 'paypal')
      : null;
    if (!order) return;
    const { error } = await admin.rpc('mark_order_failed', {
      p_order_id: order.id,
      p_reason: 'paypal_capture_denied',
    });
    if (error) throw new Error('paypal_mark_failed_failed');
    return;
  }

  if (eventType === 'PAYMENT.CAPTURE.REFUNDED') {
    const captureId =
      typeof related?.capture_id === 'string'
        ? related.capture_id
        : typeof resource.id === 'string'
          ? resource.id
          : '';
    const order =
      (captureId ? await findOrderByProviderPaymentId(captureId, 'paypal') : null) ||
      (paypalOrderId ? await findOrderByProviderOrderId(paypalOrderId, 'paypal') : null);
    if (!order || amountCents === null || amountCents <= 0) return;

    const totalRefunded = Math.min(
      Number(order.total_cents),
      Number(order.refunded_cents || 0) + amountCents
    );
    const { error } = await admin.rpc('mark_order_refunded', {
      p_order_id: order.id,
      p_refunded_cents: totalRefunded,
    });
    if (error) throw new Error('paypal_mark_refunded_failed');
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
    const outcome = await processWebhookOnce(
      async () => {
        const { data, error } = await admin.rpc('record_payment_event', {
          p_provider: 'razorpay',
          p_event_id: eventId,
          p_event_type: eventType,
          p_payload: safeRazorpayPayload(raw.parsed),
        });
        if (error) throw new Error('razorpay_event_record_failed');
        return data === true;
      },
      async () => handleRazorpayEvent(raw.parsed)
    );

    res.status(200).json({ received: true, duplicate: outcome === 'duplicate' });
  } catch {
    // The event was recorded before applying it. Remove only this failed event so the
    // provider retry can safely attempt processing again; successful deliveries remain idempotent.
    await admin
      .from('payment_events')
      .delete()
      .eq('provider', 'razorpay')
      .eq('event_id', eventId);
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
    const outcome = await processWebhookOnce(
      async () => {
        const { data, error } = await admin.rpc('record_payment_event', {
          p_provider: 'paypal',
          p_event_id: eventId,
          p_event_type: eventType,
          p_payload: safePayPalPayload(raw.parsed),
        });
        if (error) throw new Error('paypal_event_record_failed');
        return data === true;
      },
      async () => handlePayPalEvent(raw.parsed)
    );

    res.status(200).json({ received: true, duplicate: outcome === 'duplicate' });
  } catch {
    // Permit provider retry only when handling failed after the event was first recorded.
    await admin
      .from('payment_events')
      .delete()
      .eq('provider', 'paypal')
      .eq('event_id', eventId);
    console.error(JSON.stringify({
      event: 'paypal_webhook_processing_failed',
      type: eventType,
      eventId,
    }));
    res.status(500).json({ error: 'Webhook processing could not be completed.' });
  }
});
