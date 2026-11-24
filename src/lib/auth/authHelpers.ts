/**
 * Validates a post-auth redirect target as a same-origin relative route.
 * Blocks protocol-relative/absolute URLs, backslashes, schemes, control characters and callback loops.
 */
export function validateNextPath(raw: string | null | undefined, fallback = '/account'): string {
  if (typeof raw !== 'string') return fallback;
  const trimmed = raw.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return fallback;
  if (trimmed.includes('\\') || /[\u0000-\u001F\u007F]/.test(trimmed)) return fallback;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return fallback;

  try {
    const target = new URL(trimmed, 'https://kinvai.invalid');
    if (target.origin !== 'https://kinvai.invalid') return fallback;
    if (target.pathname === '/auth/callback' || target.pathname.startsWith('/auth/callback/')) return fallback;
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return fallback;
  }
}

/**
 * Builds the exact Supabase OAuth redirectTo URL:
 *   `${baseOrigin}/auth/callback?next=${encodeURIComponent(safeNext)}`
 */
export function buildOAuthRedirectUrl(
  siteUrl: string | null | undefined,
  currentPath: string | null | undefined,
  windowOrigin?: string
): string {
  const safeNext = validateNextPath(currentPath, '/account');
  const configuredOrigin = (siteUrl || '').trim().replace(/\/+$/, '');
  const runtimeOrigin = (windowOrigin || '').trim().replace(/\/+$/, '');
  const base =
    configuredOrigin && (!runtimeOrigin || runtimeOrigin === configuredOrigin)
      ? configuredOrigin
      : runtimeOrigin || configuredOrigin;
  return `${base}/auth/callback?next=${encodeURIComponent(safeNext)}`;
}

/** Safely detects whether the application is currently rendered inside an iframe. */
export function isRunningInIframe(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}
