import { Router } from 'express';
import { z } from 'zod';
import { createRateLimitMiddleware } from '../lib/rateLimit.ts';
import { requireAdmin } from '../middleware/requireAdmin.ts';
import { getSupabaseAdmin } from '../services/supabaseAdmin.ts';

export const adminRouter = Router();

const testDownloadLimiter = createRateLimitMiddleware({
  windowMs: 60_000,
  maxRequests: 30,
  keyPrefix: 'admin-test-download',
});

const ParamsSchema = z.object({
  productId: z.string().uuid(),
  fileId: z.string().uuid(),
});

adminRouter.get('/test-download/:productId/:fileId', testDownloadLimiter, requireAdmin, async (req, res) => {
  const params = ParamsSchema.safeParse({
    productId: req.params.productId,
    fileId: req.params.fileId,
  });
  if (!params.success) {
    res.status(404).json({ error: 'File not found.' });
    return;
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    res.status(503).json({ error: 'Secure test downloads are not configured.' });
    return;
  }

  try {
    const { data: file, error } = await admin
      .from('product_files')
      .select('id, product_id, storage_path, file_name, is_active')
      .eq('id', params.data.fileId)
      .eq('product_id', params.data.productId)
      .eq('is_active', true)
      .maybeSingle();

    if (error || !file) {
      res.status(404).json({ error: 'No active file exists for this product.' });
      return;
    }

    const { data: signed, error: signError } = await admin.storage
      .from('product-files')
      .createSignedUrl(file.storage_path, 60, { download: file.file_name });

    if (signError || !signed?.signedUrl) {
      res.status(502).json({ error: 'A temporary signed test link could not be created.' });
      return;
    }

    res.setHeader('Cache-Control', 'private, no-store');
    res.status(200).json({ url: signed.signedUrl, expiresInSeconds: 60 });
  } catch {
    res.status(500).json({ error: 'The test download could not be prepared. Please retry.' });
  }
});
