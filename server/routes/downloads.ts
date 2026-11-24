import { createHmac } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { createRateLimitMiddleware } from '../lib/rateLimit.ts';
import { requireUser } from '../middleware/requireUser.ts';
import { getServerSecrets } from '../lib/config.ts';
import { getSupabaseAdmin } from '../services/supabaseAdmin.ts';

export const downloadsRouter = Router();

const ProductIdSchema = z.string().uuid();
const FileIdSchema = z.string().uuid();
const downloadLimiter = createRateLimitMiddleware({
  windowMs: 60_000,
  maxRequests: 20,
  keyPrefix: 'download',
});

downloadsRouter.get('/:productId', downloadLimiter, async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const productParsed = ProductIdSchema.safeParse(req.params.productId);
  if (!productParsed.success) {
    res.status(404).json({ error: 'Product not found.' });
    return;
  }

  const fileIdRaw = req.query.fileId;
  const fileIdParsed = fileIdRaw === undefined ? null : FileIdSchema.safeParse(fileIdRaw);
  if (fileIdParsed && !fileIdParsed.success) {
    res.status(400).json({ error: 'The selected file is not valid.' });
    return;
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    res.status(503).json({ error: 'Secure downloads are not configured.' });
    return;
  }

  const productId = productParsed.data;
  try {
    const { data: entitlement, error: entitlementError } = await admin
      .from('entitlements')
      .select('id')
      .eq('user_id', user.id)
      .eq('product_id', productId)
      .is('revoked_at', null)
      .maybeSingle();

    if (entitlementError || !entitlement) {
      res.status(403).json({ error: 'An active licence is required to download this product.' });
      return;
    }

    const { data: files, error: fileError } = await admin
      .from('product_files')
      .select('id, product_id, storage_path, file_name, size_bytes, version')
      .eq('product_id', productId)
      .eq('is_active', true)
      .order('file_name', { ascending: true })
      .limit(100);

    if (fileError) {
      res.status(500).json({ error: 'The product files could not be loaded.' });
      return;
    }
    if (!files || files.length === 0) {
      res.status(404).json({ error: 'No active download files are available for this product yet.' });
      return;
    }

    if (!fileIdParsed) {
      if (files.length > 1) {
        res.setHeader('Cache-Control', 'private, no-store');
        res.status(200).json({
          files: files.map((file) => ({
            id: file.id,
            file_name: file.file_name,
            size_bytes: file.size_bytes,
            version: file.version,
          })),
        });
        return;
      }
    }

    const selectedFile = fileIdParsed
      ? files.find((file) => file.id === fileIdParsed.data)
      : files[0];

    if (!selectedFile) {
      res.status(404).json({ error: 'That file is not active for this product.' });
      return;
    }

    const { data: signed, error: signError } = await admin.storage
      .from('product-files')
      .createSignedUrl(selectedFile.storage_path, 60, { download: selectedFile.file_name });

    if (signError || !signed?.signedUrl) {
      res.status(502).json({ error: 'A secure download link could not be created. Please retry.' });
      return;
    }

    const { supabaseServiceRoleKey } = getServerSecrets();
    const ipHash = createHmac('sha256', supabaseServiceRoleKey)
      .update(req.ip || 'unknown')
      .digest('hex');

    // Logging is best-effort; it must never block an otherwise valid signed download.
    const { error: logError } = await admin.from('download_logs').insert({
      user_id: user.id,
      product_id: productId,
      file_id: selectedFile.id,
      ip_hash: ipHash,
      user_agent: (req.get('user-agent') || '').slice(0, 512) || null,
    });
    if (logError) {
      console.warn(JSON.stringify({ event: 'download_log_insert_failed', productId }));
    }

    res.setHeader('Cache-Control', 'private, no-store');
    res.status(200).json({ url: signed.signedUrl, expiresInSeconds: 60 });
  } catch {
    res.status(500).json({ error: 'The secure download could not be prepared. Please retry.' });
  }
});
