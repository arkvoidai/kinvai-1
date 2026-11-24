import { Router } from 'express';
import { z } from 'zod';
import { createRateLimitMiddleware } from '../lib/rateLimit.ts';
import { assertSameOrigin } from '../lib/requestSecurity.ts';
import { requireUser } from '../middleware/requireUser.ts';
import { getPublicServerConfig, getServerSecrets } from '../lib/config.ts';
import { getSupabaseAdmin } from '../services/supabaseAdmin.ts';
import {
  createPayPalOrder,
  createRazorpayOrder,
  isRazorpayCurrencyUnavailable,
  ProviderApiError,
} from '../services/paymentProviders.ts';

export const checkoutRouter = Router();

const CreateCheckoutSchema = z.object({
  productIds: z.array(z.string().uuid()).min(1).max(50),
  provider: z.enum(['razorpay', 'paypal']),
}).strict();

type PaymentProvider = 'razorpay' | 'paypal';
const PROVIDER_STATUS_SETTING = 'payment_provider_runtime_status';
const localUnavailableProviders = new Set<PaymentProvider>();

async function getUnavailableProviders(
  admin: NonNullable<ReturnType<typeof getSupabaseAdmin>>
): Promise<Set<PaymentProvider>> {
  const unavailable = new Set<PaymentProvider>(localUnavailableProviders);
  try {
    const { data, error } = await admin
      .from('site_settings')
      .select('value')
      .eq('key', PROVIDER_STATUS_SETTING)
      .maybeSingle();

    if (error || !data?.value || typeof data.value !== 'object') return unavailable;

    const value = data.value as { temporarilyUnavailable?: unknown };
    if (Array.isArray(value.temporarilyUnavailable)) {
      for (const provider of value.temporarilyUnavailable) {
        if (provider === 'razorpay' || provider === 'paypal') unavailable.add(provider);
      }
    }
  } catch {
    // Fall back to the local status cache if the settings row cannot be reached.
  }
  return unavailable;
}

async function markProviderUnavailable(
  admin: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  provider: PaymentProvider,
  reason: string
): Promise<void> {
  localUnavailableProviders.add(provider);
  const unavailable = await getUnavailableProviders(admin);
  unavailable.add(provider);

  try {
    const { error } = await admin.from('site_settings').upsert(
      {
        key: PROVIDER_STATUS_SETTING,
        is_public: false,
        value: {
          temporarilyUnavailable: Array.from(unavailable),
          reasons: { [provider]: reason },
        },
      },
      { onConflict: 'key' }
    );

    if (error) {
      console.warn(JSON.stringify({
        event: 'payment_provider_status_persist_failed',
        provider,
        code: error.code || 'database_error',
      }));
    }
  } catch {
    console.warn(JSON.stringify({
      event: 'payment_provider_status_persist_failed',
      provider,
      code: 'database_unavailable',
    }));
  }
}

const checkoutLimiter = createRateLimitMiddleware({
  windowMs: 60_000,
  maxRequests: 10,
  keyPrefix: 'checkout-create',
});

function friendlyCreateOrderError(message: string): { status: number; error: string } {
  const normalized = message.toLowerCase();
  if (normalized.includes('already_owned')) {
    return { status: 409, error: 'One or more products are already in your library. Remove them and try again.' };
  }
  if (normalized.includes('product_unavailable')) {
    return { status: 409, error: 'One or more products are no longer available. Refresh the shop and try again.' };
  }
  if (normalized.includes('empty_cart')) {
    return { status: 400, error: 'Your cart is empty. Add a product before checkout.' };
  }
  if (normalized.includes('cart_too_large')) {
    return { status: 400, error: 'Please check out with 50 products or fewer.' };
  }
  return { status: 400, error: 'Your order could not be created. Review the cart and try again.' };
}

checkoutRouter.get('/config', async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const admin = getSupabaseAdmin();
  if (!admin) {
    res.status(503).json({ error: 'Checkout configuration is unavailable.' });
    return;
  }

  const secrets = getServerSecrets();
  const flags = getPublicServerConfig().flags;
  const unavailable = await getUnavailableProviders(admin);
  res.setHeader('Cache-Control', 'private, no-store');
  res.status(200).json({
    providers: {
      razorpay: flags.razorpay && Boolean(secrets.razorpayKeyId) && !unavailable.has('razorpay'),
      paypal: flags.paypal && Boolean(secrets.paypalClientId) && !unavailable.has('paypal'),
    },
    temporarilyUnavailable: {
      razorpay: unavailable.has('razorpay'),
      paypal: unavailable.has('paypal'),
    },
    razorpayKeyId:
      flags.razorpay && !unavailable.has('razorpay')
        ? secrets.razorpayKeyId
        : null,
    paypalClientId: flags.paypal && !unavailable.has('paypal')
      ? secrets.paypalClientId
      : null,
  });
});

checkoutRouter.post('/create', checkoutLimiter, async (req, res) => {
  if (!assertSameOrigin(req, res)) return;
  const user = await requireUser(req, res);
  if (!user) return;

  const parsed = CreateCheckoutSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: parsed.error.issues[0]?.message || 'Choose products and a payment provider.',
    });
    return;
  }

  const { productIds, provider } = parsed.data;
  const uniqueProductIds = Array.from(new Set(productIds));
  const flags = getPublicServerConfig().flags;
  const admin = getSupabaseAdmin();
  if (!admin) {
    res.status(503).json({ error: 'Checkout is not configured right now.' });
    return;
  }

  const unavailable = await getUnavailableProviders(admin);
  if (
    unavailable.has(provider) ||
    (provider === 'razorpay' && !flags.razorpay) ||
    (provider === 'paypal' && !flags.paypal)
  ) {
    res.status(503).json({
      error: provider === 'razorpay' && unavailable.has('razorpay')
        ? 'Razorpay is temporarily unavailable for USD on this account.'
        : 'That payment provider is not available right now.',
      providerUnavailable: unavailable.has(provider),
    });
    return;
  }

  try {
    // The database validates live product status, ownership and every price.
    // No browser-supplied amount, name or currency is passed to this RPC.
    const { data, error } = await admin.rpc('create_order', {
      p_user_id: user.id,
      p_product_ids: uniqueProductIds,
      p_provider: provider,
    });

    if (error) {
      const mapped = friendlyCreateOrderError(error.message || '');
      res.status(mapped.status).json({ error: mapped.error });
      return;
    }

    const rpcOrder = Array.isArray(data) ? data[0] : data;
    if (
      !rpcOrder ||
      typeof rpcOrder.o_order_id !== 'string' ||
      typeof rpcOrder.o_order_number !== 'string'
    ) {
      res.status(502).json({ error: 'The order service returned an incomplete response.' });
      return;
    }

    const orderId = rpcOrder.o_order_id as string;
    const orderNumber = rpcOrder.o_order_number as string;
    const amountCents = Number(rpcOrder.o_total_cents);
    const currency = String(rpcOrder.o_currency || 'USD');

    const { data: existingOrder, error: orderReadError } = await admin
      .from('orders')
      .select('provider, provider_order_id, total_cents, currency')
      .eq('id', orderId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (
      orderReadError ||
      !existingOrder ||
      existingOrder.provider !== provider ||
      Number(existingOrder.total_cents) !== amountCents ||
      existingOrder.currency !== currency ||
      currency !== 'USD' ||
      !Number.isSafeInteger(amountCents) ||
      amountCents < 0
    ) {
      res.status(409).json({ error: 'The order total could not be verified. Please retry checkout.' });
      return;
    }

    let providerOrderId =
      typeof existingOrder.provider_order_id === 'string'
        ? existingOrder.provider_order_id
        : null;

    if (!providerOrderId) {
      try {
        if (provider === 'razorpay') {
          const created = await createRazorpayOrder({
            orderId,
            orderNumber,
            amountCents,
          });
          providerOrderId = created.id;
        } else {
          const created = await createPayPalOrder({
            orderId,
            orderNumber,
            amountCents,
          });
          providerOrderId = created.id;
        }

        const { error: attachError } = await admin.rpc('attach_provider_order', {
          p_order_id: orderId,
          p_provider_order_id: providerOrderId,
        });

        if (attachError) {
          await admin.rpc('mark_order_failed', {
            p_order_id: orderId,
            p_reason: 'provider_order_attach_failed',
          });
          console.error(JSON.stringify({
            event: 'checkout_provider_order_attach_failed',
            provider,
            orderId,
            code: attachError.code || 'database_error',
          }));
          res.status(502).json({ error: 'The payment provider could not prepare this order. Please retry.' });
          return;
        }
      } catch (error) {
        const providerError =
          error instanceof ProviderApiError
            ? error
            : new ProviderApiError('Provider request failed.', provider, 502, 'provider_request_failed');
        await admin.rpc('mark_order_failed', {
          p_order_id: orderId,
          p_reason: providerError.code,
        });

        const currencyUnavailable =
          provider === 'razorpay' && isRazorpayCurrencyUnavailable(providerError);
        if (currencyUnavailable) {
          await markProviderUnavailable(admin, 'razorpay', providerError.code);
        }
        console.error(JSON.stringify({
          event: 'checkout_provider_order_failed',
          provider,
          orderId,
          status: providerError.status,
          code: providerError.code,
          currencyUnavailable,
        }));

        res.status(currencyUnavailable ? 503 : 502).json({
          error: currencyUnavailable
            ? 'Razorpay is temporarily unavailable for USD on this account. Choose another available provider.'
            : provider === 'razorpay'
              ? 'Razorpay could not prepare the payment. Please try again or choose another provider.'
              : 'PayPal could not prepare the payment. Please try again.',
          providerUnavailable: currencyUnavailable,
        });
        return;
      }
    }

    if (!providerOrderId) {
      res.status(502).json({ error: 'The payment provider did not return an order reference.' });
      return;
    }

    const secrets = getServerSecrets();
    res.setHeader('Cache-Control', 'private, no-store');
    res.status(200).json({
      ok: true,
      orderId,
      orderNumber,
      provider,
      providerOrderId,
      amount: amountCents,
      currency,
      razorpayKeyId: provider === 'razorpay' ? secrets.razorpayKeyId : undefined,
    });
  } catch (error) {
    console.error(JSON.stringify({
      event: 'checkout_create_unhandled',
      provider,
      reason: error instanceof Error ? error.name : 'unknown',
    }));
    res.status(500).json({ error: 'Checkout could not be started. Please try again.' });
  }
});
