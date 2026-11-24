import type { Request, Response } from 'express';

/**
 * State-changing browser routes accept only the exact origin serving this request.
 * Webhook routes use provider signatures instead and must not use this middleware.
 */
export function assertSameOrigin(req: Request, res: Response): boolean {
  const requestOrigin = `${req.protocol}://${req.get('host') || ''}`;
  const origin = req.get('origin');

  if (origin) {
    try {
      if (new URL(origin).origin === new URL(requestOrigin).origin) return true;
    } catch {
      // Invalid origin is rejected below.
    }
    res.status(403).json({ error: 'This request origin is not allowed.' });
    return false;
  }

  const referer = req.get('referer');
  if (referer) {
    try {
      if (new URL(referer).origin === new URL(requestOrigin).origin) return true;
    } catch {
      // Invalid referer is rejected below.
    }
  }

  if (req.get('sec-fetch-site') === 'same-origin') return true;

  res.status(403).json({ error: 'A same-origin request is required.' });
  return false;
}
