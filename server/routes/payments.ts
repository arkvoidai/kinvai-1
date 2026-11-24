import { Router } from 'express';
import { z } from 'zod';
import { createRateLimitMiddleware } from '../lib/rateLimit.ts';
import { assertSameOrigin } from '../lib/requestSecurity.ts';
import { requireUser } from '../middleware/requireUser.ts';
import { getServerSecrets } from '../lib/config.ts';
import { getSupabaseAdmin } from '../services/supabaseAdmin.ts';
import {
  capturePayPalOrder,
  getPayPalCaptureTotals,
  ProviderApiError,
} from '../services/paymentProviders.ts';
import {
  paymentMatchesOrder,
  verifyRazorpayCheckoutSignature,
} from '../services/paymentSecurity.ts';

export const paymentsRouter = Router();

const RazorpayVerifySchema = z.object({
  razorpay_order_id: z.string().min(5).max(80),
  razorpay_payment_id: z.string().min(5).max(80),
  razorpay_signature: z.string().regex(/^[a-f0-9]{64}$/i),
}).strict();

const PayPalOrderSchema = z.object({
  paypalOrderId: z.string().min(5).max(80),
}).strict();

const verifyLimiter = createRateLimitMiddleware({
  windowMs: 60_000,
  maxRequests: 20,
  keyPrefix: 'payment-verify',
});

const captureLimiter = createRateLimitMiddleware({
  windowMs: 60_000,
  maxRequests: 10,
  keyPrefix: 'paypal-capture',
});

const cancelLimiter = createRateLimitMiddleware({
  windowMs: 60_000,
  maxRequests: 10,
  keyPrefix: 'paypal-cancel',
});

async function getOwnedProviderOrder(
  admin: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  orderId: string,
  userId: string,
  provider: 'razorpay' | 'paypal'
) {
  return admin
    .from('orders')
    .select('id, order_number, provider, provider_order_id, provider_payment_id, status, total_cents, currency')
    .eq('provider_order_id', orderId)
    .eq('user_id', userId)
    .eq('provider', provider)
    .maybeSingle();
}

async function fetchRazorpayPayment(paymentId: string) {
  const secrets = getServerSecrets();
  const authorization = Buffer.from(
    `${secrets.razorpayKeyId}:${secrets.razorpayKeySecret}`
  ).toString('base64');

  const response = await fetch(
    `https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}`,
    { headers: { Authorization: `Basic ${authorization}` } }
  );
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new ProviderApiError('Payment could not be fetched from Razorpay.', 'razorpay', response.status, 'payment_fetch_failed');
  }
  return payload;
}

async function captureAuthorizedRazorpayPayment(paymentId: string, amountCents: number) {
  const secrets = getServerSecrets();
  const authorization = Buffer.from(
    `${secrets.razorpayKeyId}:${secrets.razorpayKeySecret}`
  ).toString('base64');

  const response = await fetch(
    `https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}/capture`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${authorization}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ amount: amountCents, currency: 'USD' }),
    }
  );
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new ProviderApiError('The authorized Razorpay payment could not be captured.', 'razorpay', response.status, 'payment_capture_failed');
  }
  return payload;
}

paymentsRouter.post('/razorpay/verify', verifyLimiter, async (req, res) => {
  if (!assertSameOrigin(req, res)) return;
  const user = await requireUser(req, res);
  if (!user) return;

  const parsed = RazorpayVerifySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'The Razorpay verification details are incomplete.' });
    return;
  }

  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = parsed.data;
  const secrets = getServerSecrets();

  if (
    !verifyRazorpayCheckoutSignature(
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      secrets.razorpayKeySecret
    )
  ) {
    res.status(400).json({ error: 'The payment signature could not be verified.' });
    return;
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    res.status(503).json({ error: 'Payment verification is not configured.' });
    return;
  }

  try {
    const { data: order, error: orderError } = await getOwnedProviderOrder(
      admin,
      razorpay_order_id,
      user.id,
      'razorpay'
    );
    if (orderError || !order) {
      res.status(404).json({ error: 'The order could not be found for this account.' });
      return;
    }

    let payment = await fetchRazorpayPayment(razorpay_payment_id);
    const checkOrderId = payment.order_id;
    const amount = Number(payment.amount);
    const currency = typeof payment.currency === 'string' ? payment.currency : '';

    if (
      checkOrderId !== razorpay_order_id ||
      !paymentMatchesOrder(amount, currency, Number(order.total_cents), order.currency)
    ) {
      res.status(409).json({ error: 'The payment amount or currency did not match this order.' });
      return;
    }

    if (payment.status === 'authorized') {
      await captureAuthorizedRazorpayPayment(razorpay_payment_id, Number(order.total_cents));
      payment = await fetchRazorpayPayment(razorpay_payment_id);
    }

    if (payment.status !== 'captured' || payment.captured !== true) {
      if (payment.status === 'failed') {
        await admin.rpc('mark_order_failed', {
          p_order_id: order.id,
          p_reason: 'razorpay_payment_failed',
        });
      }
      res.status(402).json({ error: 'Razorpay has not confirmed a captured payment yet.' });
      return;
    }

    const verified = paymentMatchesOrder(
      Number(payment.amount),
      String(payment.currency || ''),
      Number(order.total_cents),
      order.currency
    );
    if (!verified || payment.order_id !== razorpay_order_id) {
      res.status(409).json({ error: 'The captured payment did not match this order.' });
      return;
    }

    const { data: paidStatus, error: paidError } = await admin.rpc('mark_order_paid', {
      p_order_id: order.id,
      p_provider: 'razorpay',
      p_provider_payment_id: razorpay_payment_id,
      p_amount_cents: Number(payment.amount),
      p_currency: String(payment.currency),
    });

    if (paidError || !['paid', 'already_paid'].includes(String(paidStatus))) {
      console.error(JSON.stringify({
        event: 'razorpay_mark_paid_failed',
        orderId: order.id,
        code: paidError?.code || 'database_error',
      }));
      res.status(502).json({ error: 'The payment was captured, but the order is still being confirmed. Refresh in a moment.' });
      return;
    }

    res.status(200).json({ ok: true, orderId: order.id, status: 'paid' });
  } catch (error) {
    console.error(JSON.stringify({
      event: 'razorpay_verify_failed',
      provider: 'razorpay',
      reason: error instanceof ProviderApiError ? error.code : 'verification_error',
    }));
    res.status(502).json({ error: 'Razorpay could not confirm this payment. Please retry or contact support.' });
  }
});

paymentsRouter.post('/paypal/capture', captureLimiter, async (req, res) => {
  if (!assertSameOrigin(req, res)) return;
  const user = await requireUser(req, res);
  if (!user) return;

  const parsed = PayPalOrderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'The PayPal order id is missing.' });
    return;
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    res.status(503).json({ error: 'Payment capture is not configured.' });
    return;
  }

  let orderLookup: Awaited<ReturnType<typeof getOwnedProviderOrder>>;
  try {
    orderLookup = await getOwnedProviderOrder(
      admin,
      parsed.data.paypalOrderId,
      user.id,
      'paypal'
    );
  } catch {
    res.status(502).json({ error: 'The order could not be checked. Please retry.' });
    return;
  }
  const { data: order, error: orderError } = orderLookup;
  if (orderError || !order) {
    res.status(404).json({ error: 'The order could not be found for this account.' });
    return;
  }

  if (order.status === 'paid') {
    res.status(200).json({ ok: true, orderId: order.id, status: 'paid' });
    return;
  }

  try {
    const capture = await capturePayPalOrder(
      parsed.data.paypalOrderId,
      `${order.order_number}-CAPTURE`
    );
    const totals = getPayPalCaptureTotals(capture);

    if (
      totals.status !== 'COMPLETED' ||
      !totals.captureId ||
      totals.amountCents === null ||
      !totals.currency ||
      !paymentMatchesOrder(
        totals.amountCents,
        totals.currency,
        Number(order.total_cents),
        order.currency
      )
    ) {
      res.status(409).json({ error: 'PayPal has not confirmed the expected amount and currency.' });
      return;
    }

    const { data: paidStatus, error: paidError } = await admin.rpc('mark_order_paid', {
      p_order_id: order.id,
      p_provider: 'paypal',
      p_provider_payment_id: totals.captureId,
      p_amount_cents: totals.amountCents,
      p_currency: totals.currency,
    });

    if (paidError || !['paid', 'already_paid'].includes(String(paidStatus))) {
      console.error(JSON.stringify({
        event: 'paypal_mark_paid_failed',
        orderId: order.id,
        code: paidError.code || 'database_error',
      }));
      res.status(502).json({ error: 'The payment was captured, but the order is still being confirmed. Refresh in a moment.' });
      return;
    }

    res.status(200).json({ ok: true, orderId: order.id, status: 'paid' });
  } catch (error) {
    console.error(JSON.stringify({
      event: 'paypal_capture_failed',
      orderId: order.id,
      reason: error instanceof ProviderApiError ? error.code : 'capture_error',
    }));
    res.status(502).json({ error: 'PayPal could not confirm the payment. Please retry or contact support.' });
  }
});

paymentsRouter.post('/paypal/cancel', cancelLimiter, async (req, res) => {
  if (!assertSameOrigin(req, res)) return;
  const user = await requireUser(req, res);
  if (!user) return;

  const parsed = PayPalOrderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'The PayPal order id is missing.' });
    return;
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    res.status(503).json({ error: 'Payment cancellation is not configured.' });
    return;
  }

  const { data: order, error: orderError } = await getOwnedProviderOrder(
    admin,
    parsed.data.paypalOrderId,
    user.id,
    'paypal'
  );
  if (orderError || !order) {
    res.status(404).json({ error: 'The order could not be found for this account.' });
    return;
  }

  try {
    const { error } = await admin.rpc('mark_order_cancelled', {
      p_order_id: order.id,
    });
    if (error) {
      res.status(502).json({ error: 'The payment could not be cancelled. Please contact support.' });
      return;
    }
  } catch {
    res.status(502).json({ error: 'The payment could not be cancelled. Please try again.' });
    return;
  }

  res.status(200).json({ ok: true, status: 'cancelled' });
});
