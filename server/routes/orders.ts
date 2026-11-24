import { Router } from 'express';
import { z } from 'zod';
import { createRateLimitMiddleware } from '../lib/rateLimit.ts';
import { requireUser } from '../middleware/requireUser.ts';
import { getSupabaseAdmin } from '../services/supabaseAdmin.ts';

export const ordersRouter = Router();

const OrderIdSchema = z.string().uuid();
const orderReadLimiter = createRateLimitMiddleware({
  windowMs: 60_000,
  maxRequests: 60,
  keyPrefix: 'order-read',
});

ordersRouter.get('/:orderId', orderReadLimiter, async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const parsed = OrderIdSchema.safeParse(req.params.orderId);
  if (!parsed.success) {
    res.status(404).json({ error: 'Order not found.' });
    return;
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    res.status(503).json({ error: 'Order lookup is not configured.' });
    return;
  }

  try {
    const { data, error } = await admin
      .from('orders')
      .select('id, order_number, status, provider, currency, total_cents, created_at, order_items(id, product_name, sku, unit_price_cents)')
      .eq('id', parsed.data)
      .eq('user_id', user.id)
      .maybeSingle();

    if (error || !data) {
      res.status(404).json({ error: 'Order not found.' });
      return;
    }

    res.setHeader('Cache-Control', 'private, no-store');
    res.status(200).json({
      order: {
        id: data.id,
        orderNumber: data.order_number,
        status: data.status,
        provider: data.provider,
        currency: data.currency,
        totalCents: data.total_cents,
        createdAt: data.created_at,
        items: (data.order_items ?? []).map((item: Record<string, unknown>) => ({
          id: item.id,
          name: item.product_name,
          sku: item.sku,
          unitPriceCents: item.unit_price_cents,
        })),
      },
    });
  } catch {
    res.status(502).json({ error: 'Order confirmation could not be checked. Please retry.' });
  }
});
