import { createHmac } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { getServerSecrets } from './config.ts';
import { getSupabaseAdmin } from '../services/supabaseAdmin.ts';

export interface RateLimitOptions {
  windowMs: number;
  maxRequests: number;
  keyPrefix?: string;
  /** Optional authenticated identity for routes that need per-user rather than per-IP limits. */
  keyGenerator?: (req: Request, res: Response) => string;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

interface BucketEntry {
  count: number;
  resetAt: number;
}

/** Local-only fallback used by unit tests and development when Supabase is unavailable. */
export class MemoryRateLimiter {
  private readonly store = new Map<string, BucketEntry>();
  private readonly windowMs: number;
  private readonly maxRequests: number;

  constructor(options: { windowMs: number; maxRequests: number }) {
    this.windowMs = options.windowMs;
    this.maxRequests = options.maxRequests;
  }

  check(key: string, now: number = Date.now()): RateLimitResult {
    const existing = this.store.get(key);
    if (!existing || now >= existing.resetAt) {
      const resetAt = now + this.windowMs;
      this.store.set(key, { count: 1, resetAt });
      this.prune(now);
      return { allowed: true, remaining: Math.max(0, this.maxRequests - 1), resetAt };
    }

    if (existing.count >= this.maxRequests) {
      return { allowed: false, remaining: 0, resetAt: existing.resetAt };
    }

    existing.count += 1;
    return {
      allowed: true,
      remaining: Math.max(0, this.maxRequests - existing.count),
      resetAt: existing.resetAt,
    };
  }

  prune(now: number = Date.now()): void {
    if (this.store.size < 500) return;
    for (const [key, entry] of this.store.entries()) {
      if (now >= entry.resetAt) this.store.delete(key);
    }
    while (this.store.size > 10_000) {
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) break;
      this.store.delete(oldest);
    }
  }

  clear(): void {
    this.store.clear();
  }
}

/** Never read X-Forwarded-For directly; Express resolves req.ip via configured proxy trust. */
export function resolveRateLimitIp(ip: string | undefined, socketAddress?: string): string {
  return ip || socketAddress || 'unknown';
}

export function resolveRateLimitIdentity(
  ip: string | undefined,
  socketAddress: string | undefined,
  customIdentity?: string
): string {
  return customIdentity?.trim() || resolveRateLimitIp(ip, socketAddress);
}

function writeRateLimitHeaders(res: Response, options: RateLimitOptions, result: RateLimitResult): void {
  res.setHeader('X-RateLimit-Limit', String(options.maxRequests));
  res.setHeader('X-RateLimit-Remaining', String(result.remaining));
  res.setHeader('X-RateLimit-Reset', String(Math.ceil(result.resetAt / 1000)));
}

function sendRateLimitResult(res: Response, options: RateLimitOptions, result: RateLimitResult): void {
  writeRateLimitHeaders(res, options, result);
  if (!result.allowed) {
    res.status(429).json({
      error: 'Too many requests. Please try again shortly.',
      retryAfterSeconds: Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000)),
    });
  }
}

export function createRateLimitMiddleware(options: RateLimitOptions) {
  const localLimiter = new MemoryRateLimiter({
    windowMs: options.windowMs,
    maxRequests: options.maxRequests,
  });
  const prefix = options.keyPrefix || 'rl';

  return async function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
    const ip = resolveRateLimitIp(req.ip, req.socket.remoteAddress);
    const identity = resolveRateLimitIdentity(ip, req.socket.remoteAddress, options.keyGenerator?.(req, res));
    const secrets = getServerSecrets();
    const admin = getSupabaseAdmin();

    if (!admin || !secrets.supabaseServiceRoleKey) {
      if (process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production') {
        res.status(503).json({ error: 'Request protection is temporarily unavailable.' });
        return;
      }
      const local = localLimiter.check(`${prefix}:${identity}`);
      sendRateLimitResult(res, options, local);
      if (local.allowed) next();
      return;
    }

    try {
      // Store only an HMAC of the address; raw client IPs are never persisted.
      const keyHash = createHmac('sha256', secrets.supabaseServiceRoleKey)
        .update(`${prefix}:${identity}`)
        .digest('hex');
      const { data, error } = await admin.rpc('consume_api_rate_limit', {
        p_key_hash: keyHash,
        p_window_ms: options.windowMs,
        p_max_requests: options.maxRequests,
      });
      if (error) throw error;

      const row = Array.isArray(data) ? data[0] : data;
      if (
        !row ||
        typeof row.allowed !== 'boolean' ||
        !Number.isInteger(Number(row.remaining)) ||
        !row.reset_at ||
        !Number.isFinite(Date.parse(String(row.reset_at)))
      ) {
        throw new Error('rate_limit_rpc_invalid_response');
      }

      const result: RateLimitResult = {
        allowed: row.allowed,
        remaining: Math.max(0, Number(row.remaining)),
        resetAt: Date.parse(String(row.reset_at)),
      };
      sendRateLimitResult(res, options, result);
      if (result.allowed) next();
    } catch (error) {
      console.error(JSON.stringify({
        event: 'shared_rate_limit_failed',
        keyPrefix: prefix,
        code: error && typeof error === 'object' && 'code' in error
          ? String((error as { code?: unknown }).code || 'database_error')
          : 'database_error',
      }));
      if (process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production') {
        res.status(503).json({ error: 'Request protection is temporarily unavailable.' });
        return;
      }
      const local = localLimiter.check(`${prefix}:${ip}`);
      sendRateLimitResult(res, options, local);
      if (local.allowed) next();
    }
  };
}
