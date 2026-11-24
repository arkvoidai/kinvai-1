export interface KinvaiPublicFlags {
  razorpay: boolean;
  paypal: boolean;
  allowSeedFallback: boolean;
}

export interface KinvaiPublicConfig {
  siteUrl: string;
  supabaseUrl: string;
  supabasePublishableKey: string;
  flags: KinvaiPublicFlags;
}

declare global {
  interface Window {
    __KINVAI__?: KinvaiPublicConfig;
  }
}

const DEFAULT_CONFIG: KinvaiPublicConfig = {
  siteUrl: 'https://kinvai.arkvoid.com',
  supabaseUrl: '',
  supabasePublishableKey: '',
  flags: {
    razorpay: false,
    paypal: false,
    allowSeedFallback: true,
  },
};

let configRequest: Promise<KinvaiPublicConfig> | null = null;

function normalizePublicConfig(value: unknown): KinvaiPublicConfig {
  const raw = value && typeof value === 'object'
    ? value as Partial<KinvaiPublicConfig>
    : {};
  const flags = raw.flags && typeof raw.flags === 'object' ? raw.flags : DEFAULT_CONFIG.flags;
  return {
    siteUrl: typeof raw.siteUrl === 'string' && raw.siteUrl.trim()
      ? raw.siteUrl.replace(/\\/+$/, '')
      : DEFAULT_CONFIG.siteUrl,
    supabaseUrl: typeof raw.supabaseUrl === 'string' ? raw.supabaseUrl.trim().replace(/\\/+$/, '') : '',
    supabasePublishableKey: typeof raw.supabasePublishableKey === 'string'
      ? raw.supabasePublishableKey.trim()
      : '',
    flags: {
      razorpay: Boolean(flags.razorpay),
      paypal: Boolean(flags.paypal),
      allowSeedFallback: typeof flags.allowSeedFallback === 'boolean'
        ? flags.allowSeedFallback
        : DEFAULT_CONFIG.flags.allowSeedFallback,
    },
  };
}

function readInjectedConfig(): KinvaiPublicConfig | null {
  if (typeof window === 'undefined' || !window.__KINVAI__) return null;
  return normalizePublicConfig(window.__KINVAI__);
}

/** Read the injected config synchronously; callers that need the server fallback should await loadPublicConfig first. */
export function getPublicConfig(): KinvaiPublicConfig {
  return readInjectedConfig() ?? DEFAULT_CONFIG;
}

/**
 * Resolves runtime public config before the application boots. The HTML-injected config
 * always wins; direct Vite/static hosting falls back to GET /api/config and ultimately
 * to safe empty defaults when no API server is present.
 */
export function loadPublicConfig(): Promise<KinvaiPublicConfig> {
  const injected = readInjectedConfig();
  if (injected) return Promise.resolve(injected);
  if (configRequest) return configRequest;

  configRequest = (async () => {
    try {
      const response = await fetch('/api/config', {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) {
        throw new Error(`Public config request failed (HTTP ${response.status}).`);
      }
      const config = normalizePublicConfig(await response.json());
      if (typeof window !== 'undefined') window.__KINVAI__ = config;
      return config;
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('[kinvai-config] Could not load /api/config; using safe defaults.', error);
      }
      return DEFAULT_CONFIG;
    }
  })();

  return configRequest;
}

export function isSupabaseConfigured(): boolean {
  const cfg = getPublicConfig();
  return Boolean(cfg.supabaseUrl && cfg.supabasePublishableKey);
}
