import type { Request, Response } from 'express';
import type { User } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '../services/supabaseAdmin.ts';

/**
 * Resolves the caller exclusively from a Supabase access token.
 * Never accept user ids or authorization claims from a request body.
 */
export async function requireUser(req: Request, res: Response): Promise<User | null> {
  const authorization = req.header('authorization') ?? '';
  const match = authorization.match(/^Bearer\s+([^\s]+)$/i);
  if (!match) {
    res.status(401).json({ error: 'Sign in to continue.' });
    return null;
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    res.status(503).json({ error: 'The account service is not configured.' });
    return null;
  }

  try {
    const { data, error } = await admin.auth.getUser(match[1]);
    if (error || !data.user) {
      res.status(401).json({ error: 'Your session could not be verified. Please sign in again.' });
      return null;
    }
    return data.user;
  } catch {
    res.status(401).json({ error: 'Your session could not be verified. Please sign in again.' });
    return null;
  }
}
