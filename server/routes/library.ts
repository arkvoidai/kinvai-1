import { Router } from 'express';
import { getSupabaseAdmin } from '../services/supabaseAdmin.ts';

export const libraryRouter = Router();

/**
 * Returns safe file metadata for products the bearer-token owner currently owns.
 * Private storage paths and signed URLs never leave the server from this endpoint.
 */
libraryRouter.get('/files', async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');

  const authorization = req.header('authorization') ?? '';
  const tokenMatch = authorization.match(/^Bearer\s+([^\s]+)$/i);
  if (!tokenMatch) {
    res.status(401).json({ error: 'Sign in to view your download files.' });
    return;
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    res.status(503).json({ error: 'The library service is not configured.' });
    return;
  }

  try {
    const { data: authData, error: authError } = await admin.auth.getUser(tokenMatch[1]);
    const user = authData.user;
    if (authError || !user) {
      res.status(401).json({ error: 'Your session could not be verified. Please sign in again.' });
      return;
    }

    const { data: entitlements, error: entitlementError } = await admin
      .from('entitlements')
      .select('product_id')
      .eq('user_id', user.id)
      .is('revoked_at', null);

    if (entitlementError) {
      res.status(500).json({ error: 'Your library files could not be loaded.' });
      return;
    }

    const productIds = Array.from(
      new Set((entitlements ?? []).map((row) => String(row.product_id)))
    );
    if (productIds.length === 0) {
      res.status(200).json({ files: [] });
      return;
    }

    const { data: files, error: filesError } = await admin
      .from('product_files')
      .select('id, product_id, file_name, mime_type, size_bytes, version')
      .eq('is_active', true)
      .in('product_id', productIds)
      .order('product_id', { ascending: true })
      .order('file_name', { ascending: true })
      .limit(500);

    if (filesError) {
      res.status(500).json({ error: 'Your library files could not be loaded.' });
      return;
    }

    res.status(200).json({ files: files ?? [] });
  } catch {
    res.status(500).json({ error: 'Your library files could not be loaded.' });
  }
});
