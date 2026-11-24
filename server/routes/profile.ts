import { Router } from 'express';
import { createRateLimitMiddleware } from '../lib/rateLimit.ts';
import { assertSameOrigin } from '../lib/requestSecurity.ts';
import { requireUser } from '../middleware/requireUser.ts';
import { getSupabaseAdmin } from '../services/supabaseAdmin.ts';

export const profileRouter = Router();

const profileSyncLimiter = createRateLimitMiddleware({
  windowMs: 60_000,
  maxRequests: 10,
  keyPrefix: 'profile-sync',
});

export function safeGoogleProfileMetadata(input: unknown): { display_name?: string; avatar_url?: string } {
  if (!input || typeof input !== 'object') return {};
  const metadata = input as Record<string, unknown>;
  const name = [metadata.full_name, metadata.name]
    .find((value): value is string => typeof value === 'string' && value.trim().length > 0);
  const avatar = [metadata.avatar_url, metadata.picture]
    .find((value): value is string => typeof value === 'string' && value.trim().length > 0);
  const result: { display_name?: string; avatar_url?: string } = {};
  if (name) result.display_name = name.trim().slice(0, 120);
  if (avatar) {
    try {
      const parsed = new URL(avatar.trim());
      if (parsed.protocol === 'https:' && !parsed.username && !parsed.password) result.avatar_url = parsed.toString().slice(0, 2048);
    } catch {
      // Ignore malformed or non-HTTPS avatar URLs.
    }
  }
  return result;
}

profileRouter.post('/sync', profileSyncLimiter, async (req, res) => {
  if (!assertSameOrigin(req, res)) return;
  const user = await requireUser(req, res);
  if (!user) return;
  const admin = getSupabaseAdmin();
  if (!admin) {
    res.status(503).json({ error: 'Profile sync is not configured.' });
    return;
  }

  const profileFields = safeGoogleProfileMetadata(user.user_metadata);
  try {
    // Only the verified user's id and public profile fields are written. is_admin is DB-controlled.
    // Ignore duplicates so a buyer's manually edited display name is not reset on each login.
    const { error } = await admin.from('profiles').upsert(
      { id: user.id, ...profileFields },
      { onConflict: 'id', ignoreDuplicates: true }
    );
    if (error) {
      console.error('[kinvai-profile] Profile sync failed.', { code: error.code || 'database_error' });
      res.status(500).json({ error: 'Your profile could not be synchronized. Please retry.' });
      return;
    }
    res.status(204).end();
  } catch {
    res.status(500).json({ error: 'Your profile could not be synchronized. Please retry.' });
  }
});
