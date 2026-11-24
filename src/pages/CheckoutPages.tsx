import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  CircleAlert,
  CreditCard,
  Download,
  Lock,
  PackageCheck,
  RefreshCw,
  ShieldCheck,
  Trash2,
  XCircle,
} from 'lucide-react';
import {
  Breadcrumb,
  Button,
  PriceTag,
  ProductCover,
  Skeleton,
  TagPill,
  Tile,
} from '../components/primitives';
import { useCart } from '../lib/cart/CartProvider';
import type { CartItem } from '../lib/cart/CartProvider';
import { useAuth } from '../lib/auth/AuthProvider';
import { getPublicConfig } from '../lib/config';
import { getSupabaseBrowserClient } from '../lib/supabase/client';
import { usePageMeta } from '../lib/seo/usePageMeta';

type Provider = 'razorpay' | 'paypal';
type CheckoutStep = 'review' | 'payment';

interface CheckoutConfig {
  providers: { razorpay: boolean; paypal: boolean };
  temporarilyUnavailable: { razorpay: boolean; paypal: boolean };
  razorpayKeyId: string | null;
  paypalClientId: string | null;
}

interface CreatedOrder {
  orderId: string;
  orderNumber: string;
  providerOrderId: string;
  amount: number;
  currency: 'USD';
  razorpayKeyId?: string;
}

interface AccountOrderSnapshot {
  id: string;
  orderNumber: string;
  status: string;
  provider: string;
  currency: string;
  totalCents: number;
  createdAt: string;
  items: Array<{ id: string; name: string; sku: string; unitPriceCents: number }>;
}

interface RazorpayPaymentResult {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

interface RazorpayOptions {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  prefill: { email?: string };
  notes: { kinvai_order_id: string };
  theme: { color: string };
  handler: (response: RazorpayPaymentResult) => void | Promise<void>;
  modal?: { ondismiss?: () => void };
}

interface RazorpayInstance {
  open: () => void;
  on: (event: string, callback: (response: { error?: { description?: string } }) => void) => void;
}

interface PayPalButtonData {
  orderID: string;
}

interface PayPalButtonsInstance {
  render: (container: HTMLElement) => Promise<void>;
}

interface PayPalSdk {
  Buttons: (options: {
    createOrder: () => Promise<string>;
    onApprove: (data: PayPalButtonData) => Promise<void>;
    onCancel: () => void | Promise<void>;
    onError: (error: unknown) => void;
    style?: { layout?: string; shape?: string; label?: string };
  }) => PayPalButtonsInstance;
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => RazorpayInstance;
    paypal?: PayPalSdk;
  }
}

function formatUsd(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function loadScript(id: string, src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.getElementById(id) as HTMLScriptElement | null;
    if (existing?.dataset.loaded === 'true') {
      resolve();
      return;
    }
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Payment provider script could not load.')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.id = id;
    script.src = src;
    script.async = true;
    script.onload = () => {
      script.dataset.loaded = 'true';
      resolve();
    };
    script.onerror = () => {
      script.remove();
      reject(new Error('Payment provider script could not load. Check the connection and retry.'));
    };
    document.head.appendChild(script);
  });
}

async function getAccessToken(): Promise<string> {
  const client = getSupabaseBrowserClient();
  if (!client) throw new Error('Sign-in is unavailable. Refresh and try again.');

  const { data, error } = await client.auth.getSession();
  if (error || !data.session?.access_token) {
    throw new Error('Your session has expired. Sign in again, then retry checkout.');
  }
  return data.session.access_token;
}

async function authenticatedRequest<T>(
  path: string,
  body?: object
): Promise<T> {
  const token = await getAccessToken();
  const response = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: 'Bearer ' + token,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    cache: 'no-store',
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      typeof payload.error === 'string'
        ? payload.error
        : 'That did not work. Try again, or write to heyarkvoid@gmail.com.'
    );
  }
  return payload as T;
}

export function CartRedirectPage() {
  const navigate = useNavigate();
  const { setCartOpen } = useCart();

  usePageMeta({ title: 'Cart — Kinvai', noindex: true });

  useEffect(() => {
    setCartOpen(true);
    navigate('/shop', { replace: true });
  }, [navigate, setCartOpen]);

  return null;
}

export function CheckoutPage() {
  usePageMeta({
    title: 'Checkout — Kinvai',
    description: 'Server-verified checkout for Kinvai digital products.',
    noindex: true,
  });

  const navigate = useNavigate();
  const { user } = useAuth();
  const {
    items,
    collections,
    ownedIds,
    removeFromCart,
    clearCart,
    hasPreviewItems,
  } = useCart();
  const flags = useMemo(() => getPublicConfig().flags, []);

  const [step, setStep] = useState<CheckoutStep>('review');
  const [provider, setProvider] = useState<Provider | null>(null);
  const [checkoutConfig, setCheckoutConfig] = useState<CheckoutConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [disabledProviders, setDisabledProviders] = useState<Provider[]>([]);
  const [newsletterEmail, setNewsletterEmail] = useState(user?.email ?? '');
  const [newsletterState, setNewsletterState] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [newsletterMessage, setNewsletterMessage] = useState<string | null>(null);

  const paypalContainerRef = useRef<HTMLDivElement>(null);
  const paypalMountedRef = useRef(false);
  const paypalOrderIdRef = useRef<string | null>(null);
  const internalOrderIdRef = useRef<string | null>(null);
  const configRequestRef = useRef(false);
  const latestItemsRef = useRef<CartItem[]>([]);
  const latestOwnedIdsRef = useRef<string[]>([]);
  latestItemsRef.current = items;
  latestOwnedIdsRef.current = ownedIds;

  const collectionsById = useMemo(
    () => new Map(collections.map((collection) => [collection.id, collection])),
    [collections]
  );

  const isOwned = useCallback(
    (item: CartItem) => ownedIds.includes(item.productId),
    [ownedIds]
  );

  const purchasableItems = useMemo(
    () => items.filter((item) => !ownedIds.includes(item.productId)),
    [items, ownedIds]
  );
  const purchasableTotalCents = useMemo(
    () => purchasableItems.reduce((sum, item) => sum + item.priceCents, 0),
    [purchasableItems]
  );
  const hasOwnedItems = items.some(isOwned);

  const providerAvailable = useCallback((name: Provider): boolean => {
    if (disabledProviders.includes(name)) return false;
    if (checkoutConfig) return checkoutConfig.providers[name];
    return flags[name];
  }, [disabledProviders, checkoutConfig, flags]);

  useEffect(() => {
    setNewsletterEmail((current) => current || user?.email || '');
  }, [user?.email]);

  useEffect(() => {
    if (step !== 'payment' || checkoutConfig || configRequestRef.current) return;
    let active = true;
    configRequestRef.current = true;
    setConfigLoading(true);
    authenticatedRequest<CheckoutConfig>('/api/checkout/config')
      .then((result) => {
        if (!active) return;
        setCheckoutConfig(result);
        const firstAvailable = (['razorpay', 'paypal'] as Provider[]).find(
          (name) => result.providers[name] && !disabledProviders.includes(name)
        );
        setProvider((current) => current || firstAvailable || null);
      })
      .catch((error) => {
        if (active) setConfigError(error instanceof Error ? error.message : 'Payment providers could not be loaded.');
      })
      .finally(() => {
        if (active) setConfigLoading(false);
      });
    return () => {
      active = false;
    };
  }, [step, checkoutConfig, configLoading, disabledProviders]);

  const createProviderOrder = useCallback(async (paymentProvider: Provider): Promise<CreatedOrder> => {
    const payload = await authenticatedRequest<{
      ok: boolean;
      orderId: string;
      orderNumber: string;
      providerOrderId: string;
      amount: number;
      currency: 'USD';
      razorpayKeyId?: string;
      providerUnavailable?: boolean;
    }>('/api/checkout/create', {
      productIds: latestItemsRef.current
        .filter((item) => !latestOwnedIdsRef.current.includes(item.productId))
        .map((item) => item.productId),
      provider: paymentProvider,
    });

    const created: CreatedOrder = {
      orderId: payload.orderId,
      orderNumber: payload.orderNumber,
      providerOrderId: payload.providerOrderId,
      amount: payload.amount,
      currency: payload.currency,
      razorpayKeyId: payload.razorpayKeyId,
    };
    internalOrderIdRef.current = created.orderId;
    return created;
  }, []);

  const startRazorpay = useCallback(async () => {
    if (paymentBusy || !providerAvailable('razorpay')) return;
    setPaymentBusy(true);
    setPaymentError(null);
    try {
      const config = checkoutConfig ?? await authenticatedRequest<CheckoutConfig>('/api/checkout/config');
      if (!config.providers.razorpay || !config.razorpayKeyId) {
        throw new Error('Razorpay is temporarily unavailable. Choose another available provider.');
      }
      await loadScript('kinvai-razorpay-checkout', 'https://checkout.razorpay.com/v1/checkout.js');
      const created = await createProviderOrder('razorpay');
      const key = created.razorpayKeyId || config.razorpayKeyId;
      if (!window.Razorpay || !key) throw new Error('Razorpay checkout could not be loaded. Please retry.');

      const instance = new window.Razorpay({
        key,
        amount: created.amount,
        currency: created.currency,
        name: 'Kinvai',
        description: 'Digital product purchase',
        order_id: created.providerOrderId,
        prefill: { email: user?.email || '' },
        notes: { kinvai_order_id: created.orderId },
        theme: { color: '#111111' },
        handler: async (response) => {
          try {
            await authenticatedRequest('/api/payments/razorpay/verify', response);
            clearCart();
            navigate('/checkout/success?order=' + encodeURIComponent(created.orderId));
          } catch (error) {
            navigate('/checkout/failed?order=' + encodeURIComponent(created.orderId), {
              state: { message: error instanceof Error ? error.message : 'Payment verification could not be completed.' },
            });
          }
        },
        modal: {
          ondismiss: () => {
            setPaymentBusy(false);
          },
        },
      });

      instance.on('payment.failed', (response) => {
        const detail = response.error?.description;
        setPaymentError(detail || 'The payment did not complete. Try again or choose another provider.');
        navigate('/checkout/failed?order=' + encodeURIComponent(created.orderId), {
          state: { message: detail || 'The payment did not complete.' },
        });
      });
      instance.open();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Razorpay could not start. Please retry.';
      setPaymentError(message);
      if (/temporarily unavailable for usd|currency is not enabled|usd on this account/i.test(message)) {
        setDisabledProviders((previous) => previous.includes('razorpay') ? previous : [...previous, 'razorpay']);
      }
      setPaymentBusy(false);
    }
  }, [
    paymentBusy,
    providerAvailable,
    checkoutConfig,
    createProviderOrder,
    user?.email,
    clearCart,
    navigate,
  ]);

  useEffect(() => {
    if (step !== 'payment' || provider !== 'paypal' || !providerAvailable('paypal')) return;
    const clientId = checkoutConfig?.paypalClientId;
    if (!clientId) return;
    let active = true;

    const mountButtons = async () => {
      try {
        const query = new URLSearchParams({
          'client-id': clientId,
          currency: 'USD',
          intent: 'capture',
          components: 'buttons',
        });
        await loadScript(
          'kinvai-paypal-sdk',
          'https://www.paypal.com/sdk/js?' + query.toString()
        );
        if (!active || !paypalContainerRef.current || !window.paypal || paypalMountedRef.current) return;

        const buttons = window.paypal.Buttons({
          createOrder: async () => {
            setPaymentBusy(true);
            setPaymentError(null);
            try {
              const created = await createProviderOrder('paypal');
              paypalOrderIdRef.current = created.providerOrderId;
              return created.providerOrderId;
            } catch (error) {
              setPaymentBusy(false);
              setPaymentError(error instanceof Error ? error.message : 'PayPal could not create an order.');
              throw error;
            }
          },
          onApprove: async (data) => {
            const internalOrderId = internalOrderIdRef.current;
            try {
              const result = await authenticatedRequest<{ ok: boolean }>(
                '/api/payments/paypal/capture',
                { paypalOrderId: data.orderID }
              );
              if (!result.ok || !internalOrderId) throw new Error('PayPal capture could not be confirmed.');
              clearCart();
              navigate('/checkout/success?order=' + encodeURIComponent(internalOrderId));
            } catch (error) {
              navigate(
                internalOrderId
                  ? '/checkout/failed?order=' + encodeURIComponent(internalOrderId)
                  : '/checkout/failed',
                {
                  state: { message: error instanceof Error ? error.message : 'PayPal capture failed.' },
                }
              );
            } finally {
              setPaymentBusy(false);
            }
          },
          onCancel: async () => {
            const providerOrderId = paypalOrderIdRef.current;
            const internalOrderId = internalOrderIdRef.current;
            if (providerOrderId) {
              await authenticatedRequest('/api/payments/paypal/cancel', { paypalOrderId: providerOrderId }).catch(() => undefined);
            }
            setPaymentBusy(false);
            navigate(internalOrderId ? '/checkout/cancelled?order=' + encodeURIComponent(internalOrderId) : '/checkout/cancelled');
          },
          onError: (error) => {
            setPaymentBusy(false);
            setPaymentError(error instanceof Error ? error.message : 'PayPal checkout could not complete. Please try again.');
          },
          style: { layout: 'vertical', shape: 'pill', label: 'paypal' },
        });
        await buttons.render(paypalContainerRef.current);
        paypalMountedRef.current = true;
      } catch (error) {
        if (active) {
          setPaymentError(error instanceof Error ? error.message : 'PayPal could not be loaded.');
        }
      }
    };

    void mountButtons();
    return () => {
      active = false;
      paypalMountedRef.current = false;
    };
  }, [
    step,
    provider,
    checkoutConfig?.paypalClientId,
    providerAvailable,
    createProviderOrder,
    clearCart,
    navigate,
  ]);

  const removeOwned = (item: CartItem) => {
    removeFromCart(item.productId);
  };

  const continueToPayment = () => {
    if (items.length === 0 || hasPreviewItems || hasOwnedItems || purchasableItems.length === 0) return;
    setPaymentError(null);
    setStep('payment');
  };

  const submitNewsletter = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setNewsletterState('saving');
    setNewsletterMessage(null);
    try {
      const response = await fetch('/api/newsletter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: newsletterEmail, website: '' }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof payload.error === 'string' ? payload.error : 'Please try again.');
      }
      setNewsletterState('success');
      setNewsletterMessage(typeof payload.message === 'string' ? payload.message : "You're on the list.");
    } catch (error) {
      setNewsletterState('error');
      setNewsletterMessage(error instanceof Error ? error.message : 'Please try again.');
    }
  };

  const selectPaymentProvider = (next: Provider) => {
    setProvider(next);
    setPaymentError(null);
    setPaymentBusy(false);
    paypalMountedRef.current = false;
  };

  const onPay = () => {
    if (!provider) return;
    if (provider === 'razorpay') {
      void startRazorpay();
      return;
    }
    document.getElementById('paypal-button-container')?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    });
  };

  const providerNames = (['razorpay', 'paypal'] as Provider[]).filter(providerAvailable);
  const previewBlocked = hasPreviewItems;

  return (
    <div className="kv-container max-w-6xl py-6 sm:py-8 lg:py-12 flex flex-col gap-6 sm:gap-8 pb-28 lg:pb-12">
      <Breadcrumb items={[{ label: 'Home', to: '/' }, { label: 'Checkout' }]} />

      <div className="flex flex-col gap-2">
        <TagPill>SECURE CHECKOUT</TagPill>
        <h1 className="type-h1 font-semibold text-ink">A clear path to <em className="font-serif font-normal">ownership.</em></h1>
        <p className="text-sm text-ink-2">1 licence per product. Yours for life. Prices are confirmed by the order service.</p>
      </div>

      {items.length === 0 ? (
        <Tile variant="white" radius="xl" padding="lg" className="max-w-2xl flex flex-col items-start gap-5">
          <p className="type-h3 font-semibold text-ink">Nothing here yet. Start with a head start.</p>
          <Button variant="primary" to="/shop">Continue browsing</Button>
        </Tile>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-5 items-start">
            <div className="lg:col-span-7 flex flex-col gap-4 min-w-0">
              <Tile variant="white" radius="xl" padding="lg" className="flex flex-col gap-5">
                <div className="flex items-center gap-3">
                  <div className={'inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs font-semibold ' + (step === 'review' ? 'bg-ink text-white' : 'bg-stone text-ink-2')}>
                    <span className="font-mono">01</span> Review
                  </div>
                  <div className="h-px flex-1 bg-line" />
                  <div className={'inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs font-semibold ' + (step === 'payment' ? 'bg-ink text-white' : 'bg-stone text-ink-2')}>
                    <span className="font-mono">02</span> Payment
                  </div>
                </div>

                {step === 'review' ? (
                  <>
                    <div>
                      <h2 className="type-h2 font-semibold text-ink">Review the order.</h2>
                      <p className="text-sm text-ink-2 mt-1">Check the products and delivery details before choosing one payment provider.</p>
                    </div>

                    <div className="divide-y divide-line">
                      {items.map((item) => {
                        const collection = item.collectionId
                          ? collectionsById.get(item.collectionId) ?? null
                          : null;
                        const alreadyOwned = isOwned(item);
                        return (
                          <div key={item.productId} className="py-4 first:pt-0 last:pb-0 flex items-start gap-3.5">
                            <div className="w-[68px] sm:w-[82px] shrink-0 overflow-hidden rounded-[14px] bg-stone">
                              <ProductCover
                                product={{
                                  name: item.name,
                                  sku: item.sku || 'KV',
                                  file_formats: item.fileFormats,
                                  cover_path: item.coverPath,
                                }}
                                collection={collection}
                                ratio="4/5"
                                size="sm"
                              />
                            </div>
                            <div className="min-w-0 flex-1">
                              <h3 className="font-semibold text-ink leading-snug">{item.name}</h3>
                              <p className="text-xs text-ink-2 mt-1">{item.sku}</p>
                              {alreadyOwned ? (
                                <div className="mt-2 rounded-[12px] bg-warning-bg px-3 py-2 flex flex-col sm:flex-row sm:items-center gap-2 sm:justify-between">
                                  <p className="text-xs text-warning">Already in your library. Remove it to continue checkout.</p>
                                  <button type="button" onClick={() => removeOwned(item)} className="inline-flex items-center gap-1.5 text-xs font-semibold text-warning underline underline-offset-4 min-h-[36px]">
                                    <Trash2 size={14} aria-hidden="true" /> Remove
                                  </button>
                                </div>
                              ) : (
                                <p className="text-xs text-ink-2 mt-2">Digital product · 1 licence</p>
                              )}
                            </div>
                            <div className="flex flex-col items-end gap-2 shrink-0">
                              <PriceTag cents={item.priceCents} />
                              <button type="button" aria-label={'Remove ' + item.name + ' from checkout'} onClick={() => removeFromCart(item.productId)} className="min-h-[36px] inline-flex items-center gap-1.5 text-xs text-ink-2 hover:text-ink">
                                <Trash2 size={14} aria-hidden="true" /> Remove
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div className="border-t border-dashed border-line-strong pt-4 flex items-center justify-between gap-4">
                      <span className="font-medium text-ink">Total (USD)</span>
                      <PriceTag cents={purchasableTotalCents} size="lg" />
                    </div>
                    <div className="rounded-[16px] bg-page px-4 py-3 flex items-center gap-3">
                      <ShieldCheck size={18} className="text-ink-2 shrink-0" aria-hidden="true" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-ink">Signed in as {user?.email || 'your Kinvai account'}</p>
                        <p className="text-xs text-ink-2 mt-0.5">Receipts and entitlements stay with this account.</p>
                      </div>
                    </div>
                    {hasOwnedItems && <p role="status" className="text-sm text-warning">Remove every already-owned product before moving to payment. Existing access will not be charged again.</p>}
                    {previewBlocked && <p role="alert" className="text-sm text-error">Preview products cannot be purchased. Add live products from the shop instead.</p>}
                    <div className="flex flex-wrap gap-3 pt-1">
                      <Button variant="primary" size="lg" disabled={previewBlocked || hasOwnedItems || purchasableItems.length === 0} onClick={continueToPayment}>
                        Continue to payment
                      </Button>
                      <Button variant="secondary" size="lg" to="/shop">Continue browsing</Button>
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <Button variant="quiet" size="sm" onClick={() => setStep('review')} icon={<ArrowLeft size={16} aria-hidden="true" />}>Back to review</Button>
                      <h2 className="type-h2 font-semibold text-ink mt-3">Choose payment.</h2>
                      <p className="text-sm text-ink-2 mt-1">The order total is in USD. One provider is used for this order.</p>
                    </div>

                    {configLoading && <Skeleton className="h-24 w-full" rounded="lg" />}
                    {configError && (
                      <div className="rounded-[16px] border border-error/20 bg-error-bg p-4">
                        <p role="alert" className="text-sm text-error">{configError}</p>
                        <Button
                        variant="secondary"
                        size="sm"
                        className="mt-3"
                        onClick={() => {
                          configRequestRef.current = false;
                          setConfigError(null);
                          setCheckoutConfig(null);
                        }}
                      >
                        Retry provider setup
                      </Button>
                      </div>
                    )}

                    {!configLoading && checkoutConfig?.temporarilyUnavailable.razorpay && (
                      <div role="status" className="rounded-[16px] bg-warning-bg px-4 py-3 text-sm text-warning">
                        Razorpay is temporarily unavailable for USD on this account. Choose PayPal when available.
                      </div>
                    )}

                    {!configLoading && providerNames.length === 0 && (
                      <div className="rounded-[24px] bg-peach/70 p-5 sm:p-6 flex flex-col gap-3">
                        <TagPill>PAYMENTS NOT OPEN</TagPill>
                        <h3 className="type-h3 font-semibold text-ink">Checkout opens soon.</h3>
                        <p className="text-sm text-ink-2">Payment providers are not enabled for this storefront yet. Leave an email address and we’ll send a note when checkout is available.</p>
                        <form onSubmit={submitNewsletter} className="flex flex-col sm:flex-row gap-2">
                          <input
                            type="email"
                            required
                            value={newsletterEmail}
                            onChange={(event) => setNewsletterEmail(event.target.value)}
                            placeholder="Email address"
                            aria-label="Email address for checkout updates"
                            className="flex-1 min-w-0 min-h-[48px] rounded-full border border-line bg-surface px-4 text-base text-ink placeholder:text-ink-3 focus:outline-2 focus:outline-brand"
                          />
                          <Button type="submit" variant="primary" loading={newsletterState === 'saving'}>Keep me posted</Button>
                        </form>
                        {newsletterMessage && <p role={newsletterState === 'error' ? 'alert' : 'status'} className={'text-sm ' + (newsletterState === 'error' ? 'text-error' : 'text-success')}>{newsletterMessage}</p>}
                      </div>
                    )}

                    {providerNames.length > 0 && (
                      <>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {(['razorpay', 'paypal'] as Provider[]).map((name) => {
                            if (!providerAvailable(name)) return null;
                            return (
                              <button
                                type="button"
                                key={name}
                                aria-pressed={provider === name}
                                onClick={() => selectPaymentProvider(name)}
                                className={'rounded-[18px] border p-4 min-h-[88px] text-left flex items-start gap-3 transition-colors ' + (provider === name ? 'border-ink bg-page' : 'border-line bg-surface hover:bg-page')}
                              >
                                <span className={'mt-0.5 w-5 h-5 rounded-full border flex items-center justify-center shrink-0 ' + (provider === name ? 'border-ink' : 'border-line-strong')}>
                                  {provider === name && <span className="w-2.5 h-2.5 rounded-full bg-ink" />}
                                </span>
                                <span className="min-w-0">
                                  <span className="block font-semibold text-ink">{name === 'razorpay' ? 'Razorpay' : 'PayPal'}</span>
                                  <span className="block text-xs text-ink-2 mt-1">{name === 'razorpay' ? 'Payment securely processed by Razorpay.' : 'Payment securely processed by PayPal.'}</span>
                                </span>
                              </button>
                            );
                          })}
                        </div>

                        {provider === 'razorpay' && providerAvailable('razorpay') && (
                          <div className="rounded-[16px] bg-page p-4 flex items-start gap-3">
                            <CreditCard size={20} className="text-ink-2 shrink-0" aria-hidden="true" />
                            <div>
                              <p className="text-sm font-semibold text-ink">Razorpay</p>
                              <p className="text-xs text-ink-2 mt-1">Available payment methods and currency acceptance are determined by the Razorpay account and checkout.</p>
                            </div>
                          </div>
                        )}

                        {provider === 'paypal' && providerAvailable('paypal') && (
                          <div className="rounded-[16px] bg-page p-4 flex items-start gap-3">
                            <Lock size={19} className="text-ink-2 shrink-0" aria-hidden="true" />
                            <div>
                              <p className="text-sm font-semibold text-ink">PayPal</p>
                              <p className="text-xs text-ink-2 mt-1">PayPal checkout will show the payment options available for this account and order.</p>
                            </div>
                          </div>
                        )}
                      </>
                    )}

                    {paymentError && (
                      <div className="rounded-[16px] border border-error/20 bg-error-bg p-4">
                        <p role="alert" className="text-sm text-error">{paymentError}</p>
                        <button type="button" onClick={() => setPaymentError(null)} className="mt-2 text-sm font-semibold text-error underline underline-offset-4">Dismiss</button>
                      </div>
                    )}
                    {paymentBusy && <p role="status" className="text-sm text-ink-2">Preparing secure payment…</p>}

                    {provider === 'paypal' && providerAvailable('paypal') && (
                      <div className="rounded-[18px] border border-line bg-surface p-3">
                        <div id="paypal-button-container" ref={paypalContainerRef} />
                        {!checkoutConfig?.paypalClientId && !configLoading && <p className="text-xs text-ink-2">PayPal is not ready. Retry provider setup above.</p>}
                      </div>
                    )}

                    {provider === 'razorpay' && providerAvailable('razorpay') && (
                      <Button variant="primary" size="lg" fullWidth loading={paymentBusy} onClick={() => void startRazorpay()}>
                        Pay {formatUsd(purchasableTotalCents)}
                      </Button>
                    )}
                  </>
                )}
              </Tile>

              <Tile variant="stone" radius="xl" padding="lg" className="flex items-start gap-3">
                <ShieldCheck size={19} className="text-ink shrink-0 mt-0.5" aria-hidden="true" />
                <div>
                  <p className="text-sm font-semibold text-ink">Server-verified order total</p>
                  <p className="text-xs text-ink-2 mt-1">The payment total is recalculated from published products in the database. The browser never submits prices or currency conversions.</p>
                </div>
              </Tile>
            </div>

            <aside className="lg:col-span-5 lg:sticky lg:top-28 flex flex-col gap-4">
              <Tile variant="white" radius="xl" padding="lg" className="flex flex-col gap-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="type-label text-ink-2">ORDER SUMMARY</span>
                  <TagPill>{items.length} {items.length === 1 ? 'ITEM' : 'ITEMS'}</TagPill>
                </div>
                <div className="flex flex-col gap-3">
                  {purchasableItems.map((item) => (
                    <div key={item.productId} className="flex items-center justify-between gap-3">
                      <span className="text-sm text-ink-2 min-w-0 truncate">{item.name}</span>
                      <span className="text-sm font-medium tabular-nums text-ink shrink-0">{formatUsd(item.priceCents)}</span>
                    </div>
                  ))}
                  {hasOwnedItems && <p className="text-xs text-warning">Already-owned items are excluded once removed from the cart.</p>}
                </div>
                <div className="border-t border-dashed border-line-strong pt-4 flex items-center justify-between gap-3">
                  <span className="font-semibold text-ink">Total (USD)</span>
                  <PriceTag cents={purchasableTotalCents} size="lg" />
                </div>
                <div className="rounded-[14px] bg-page px-3.5 py-3">
                  <p className="text-xs text-ink-2">Account</p>
                  <p className="text-sm font-medium text-ink break-all mt-0.5">{user?.email || 'Signed-in Kinvai account'}</p>
                </div>
                {step === 'review' ? (
                  <Button variant="primary" fullWidth size="lg" disabled={previewBlocked || hasOwnedItems || purchasableItems.length === 0} onClick={continueToPayment}>Continue to payment</Button>
                ) : provider === 'razorpay' ? (
                  <Button variant="primary" fullWidth size="lg" loading={paymentBusy} disabled={!providerAvailable('razorpay')} onClick={() => void startRazorpay()}>Pay {formatUsd(purchasableTotalCents)}</Button>
                ) : provider === 'paypal' ? (
                  <Button variant="primary" fullWidth size="lg" disabled={!providerAvailable('paypal') || paymentBusy} onClick={onPay}>Continue to PayPal</Button>
                ) : (
                  <Button variant="primary" fullWidth size="lg" disabled>Choose a payment provider</Button>
                )}
                <p className="text-[11px] uppercase tracking-[0.06em] text-ink-2">USD only · One provider per order</p>
              </Tile>
              <Tile variant="tint-butter" radius="xl" padding="lg" className="flex flex-col gap-2">
                <div className="flex items-center gap-2 text-ink"><PackageCheck size={18} aria-hidden="true" /><span className="font-semibold text-sm">Digital delivery</span></div>
                <p className="text-sm text-ink-2">Confirmed purchases appear in the Kinvai library after the payment provider verifies the capture.</p>
              </Tile>
            </aside>
          </div>
        </>
      )}

      {step === 'payment' && provider === 'razorpay' && providerAvailable('razorpay') && (
        <div className="lg:hidden fixed inset-x-0 bottom-0 z-[var(--z-header)] px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] pt-3 bg-page/95 backdrop-blur border-t border-line">
          <Button variant="primary" size="lg" fullWidth loading={paymentBusy} onClick={() => void startRazorpay()}>
            Pay {formatUsd(purchasableTotalCents)}
          </Button>
        </div>
      )}
      {step === 'payment' && provider === 'paypal' && providerAvailable('paypal') && (
        <div className="lg:hidden fixed inset-x-0 bottom-0 z-[var(--z-header)] px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] pt-3 bg-page/95 backdrop-blur border-t border-line">
          <Button variant="primary" size="lg" fullWidth disabled={paymentBusy} onClick={onPay}>
            Continue with PayPal
          </Button>
        </div>
      )}
    </div>
  );
}

export function CheckoutSuccessPage() {
  usePageMeta({ title: 'Order Confirmation — Kinvai', noindex: true });

  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const orderId = searchParams.get('order') || '';
  const { clearCart } = useCart();
  const [order, setOrder] = useState<AccountOrderSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [timedOut, setTimedOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (!/^[0-9a-f-]{36}$/i.test(orderId)) {
      setLoading(false);
      setError('The order reference is missing or invalid.');
      return;
    }

    let active = true;
    let timeoutId = 0;
    const started = Date.now();

    const poll = async () => {
      try {
        const response = await authenticatedRequest<{ order: AccountOrderSnapshot }>(
          '/api/orders/' + encodeURIComponent(orderId)
        );
        if (!active) return;

        const current = response.order;
        setOrder(current);
        if (current.status === 'paid') {
          clearCart();
          setLoading(false);
          setTimedOut(false);
          return;
        }
        if (current.status === 'failed') {
          navigate('/checkout/failed?order=' + encodeURIComponent(orderId), {
            replace: true,
            state: { message: 'The payment was not completed. The order is failed.' },
          });
          return;
        }
        if (current.status === 'cancelled') {
          navigate('/checkout/cancelled?order=' + encodeURIComponent(orderId), { replace: true });
          return;
        }
        if (Date.now() - started >= 30_000) {
          setLoading(false);
          setTimedOut(true);
          return;
        }
        timeoutId = window.setTimeout(() => void poll(), 1500);
      } catch (pollError) {
        if (!active) return;
        if (Date.now() - started >= 30_000) {
          setLoading(false);
          setTimedOut(true);
          setError(pollError instanceof Error ? pollError.message : 'Order confirmation is still pending.');
          return;
        }
        timeoutId = window.setTimeout(() => void poll(), 1500);
      }
    };

    setLoading(true);
    setError(null);
    setTimedOut(false);
    void poll();

    return () => {
      active = false;
      window.clearTimeout(timeoutId);
    };
  }, [orderId, retryKey, clearCart, navigate]);

  const paid = order?.status === 'paid';

  return (
    <div className="kv-container max-w-2xl py-12 md:py-16">
      <Tile variant="white" radius="xl" padding="lg" className="flex flex-col items-start gap-4">
        {loading ? (
          <>
            <div className="w-12 h-12 rounded-full bg-stone inline-flex items-center justify-center"><RefreshCw size={21} className="animate-spin" aria-hidden="true" /></div>
            <TagPill>CONFIRMING PAYMENT</TagPill>
            <h1 className="type-h2 font-semibold text-ink">Checking the order.</h1>
            <p className="text-sm text-ink-2">The payment provider is confirming the result. This page checks for up to 30 seconds.</p>
            {order?.orderNumber && <p className="text-xs text-ink-2 font-mono">{order.orderNumber}</p>}
          </>
        ) : paid ? (
          <>
            <div className="w-12 h-12 rounded-full bg-success-bg text-success inline-flex items-center justify-center"><CheckCircle2 size={24} strokeWidth={1.75} aria-hidden="true" /></div>
            <TagPill tone="success">PAYMENT CONFIRMED</TagPill>
            <h1 className="type-h2 font-semibold text-ink">Your order is confirmed.</h1>
            <p className="text-sm text-ink-2">The payment provider confirmed the capture. The products are now attached to this Kinvai account.</p>
            <div className="w-full rounded-[18px] bg-page p-4">
              <p className="text-xs text-ink-2">ORDER NUMBER</p>
              <p className="font-mono text-lg font-semibold text-ink mt-1">{order?.orderNumber}</p>
              <div className="border-t border-dashed border-line-strong my-3" />
              <div className="flex flex-col gap-2">
                {order?.items.map((item) => (
                  <div key={item.id} className="flex items-center justify-between gap-4 text-sm">
                    <span className="text-ink-2 min-w-0">{item.name}</span>
                    <span className="font-medium text-ink tabular-nums shrink-0">{formatUsd(item.unitPriceCents)}</span>
                  </div>
                ))}
              </div>
              <div className="border-t border-dashed border-line-strong mt-3 pt-3 flex items-center justify-between">
                <span className="font-semibold text-ink">Total (USD)</span>
                <span className="font-semibold tabular-nums text-ink">{formatUsd(order?.totalCents ?? 0)}</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button variant="primary" to="/account?tab=library" icon={<Download size={16} aria-hidden="true" />}>Go to your library</Button>
              <Button variant="secondary" to="/shop">Continue browsing</Button>
            </div>
          </>
        ) : timedOut ? (
          <>
            <div className="w-12 h-12 rounded-full bg-warning-bg text-warning inline-flex items-center justify-center"><CircleAlert size={23} aria-hidden="true" /></div>
            <TagPill tone="warning">STILL CONFIRMING</TagPill>
            <h1 className="type-h2 font-semibold text-ink">The order is taking longer.</h1>
            <p className="text-sm text-ink-2">The payment provider has not returned a final status yet. Library access will appear after confirmation. Check again in a moment or contact support before trying another payment.</p>
            {order?.orderNumber && <p className="font-mono text-sm text-ink">{order.orderNumber}</p>}
            <div className="flex flex-wrap gap-3">
              <Button variant="primary" onClick={() => setRetryKey((value) => value + 1)}>Check again</Button>
              <Button variant="secondary" to="/support">Contact support</Button>
            </div>
          </>
        ) : (
          <>
            <div className="w-12 h-12 rounded-full bg-error-bg text-error inline-flex items-center justify-center"><XCircle size={24} aria-hidden="true" /></div>
            <h1 className="type-h2 font-semibold text-ink">Order confirmation is unavailable.</h1>
            <p role="alert" className="text-sm text-ink-2">{error || 'The order could not be retrieved.'}</p>
            <Button variant="primary" onClick={() => setRetryKey((value) => value + 1)}>Retry confirmation</Button>
            <Button variant="secondary" to="/support">Contact support</Button>
          </>
        )}
      </Tile>
    </div>
  );
}

export function CheckoutCancelledPage() {
  usePageMeta({ title: 'Checkout Cancelled — Kinvai', noindex: true });

  return (
    <div className="kv-container py-12 md:py-16 max-w-2xl">
      <Tile variant="white" radius="xl" padding="lg" className="flex flex-col items-start gap-4">
        <div className="w-12 h-12 rounded-full bg-stone text-ink inline-flex items-center justify-center">
          <XCircle size={24} strokeWidth={1.75} aria-hidden="true" />
        </div>
        <TagPill>PAYMENT CANCELLED</TagPill>
        <h1 className="type-h2 font-semibold text-ink">No payment was completed.</h1>
        <p className="type-body text-ink-2">
          The checkout was cancelled before payment confirmation. The cart is still available to review.
        </p>
        <div className="mt-2 flex flex-wrap gap-3">
          <Button variant="primary" to="/checkout">Return to checkout</Button>
          <Button variant="secondary" to="/shop">Continue browsing</Button>
        </div>
      </Tile>
    </div>
  );
}

export function CheckoutFailedPage() {
  usePageMeta({ title: 'Payment not completed — Kinvai', noindex: true });

  const [searchParams] = useSearchParams();
  const location = useLocation();
  const messageFromState = (location.state as { message?: string } | null)?.message;

  return (
    <div className="kv-container py-12 md:py-16 max-w-2xl">
      <Tile variant="white" radius="xl" padding="lg" className="flex flex-col items-start gap-4">
        <div className="w-12 h-12 rounded-full bg-error-bg text-error inline-flex items-center justify-center">
          <CircleAlert size={24} strokeWidth={1.75} aria-hidden="true" />
        </div>
        <TagPill tone="warning">PAYMENT NOT COMPLETED</TagPill>
        <h1 className="type-h2 font-semibold text-ink">No confirmed payment yet.</h1>
        <p className="type-body text-ink-2">{messageFromState || 'The provider could not confirm this payment. Review the cart and try again. A new charge is not started from this page.'}</p>
        {searchParams.get('order') && <p className="font-mono text-xs text-ink-2">Order reference: {searchParams.get('order')}</p>}
        <div className="flex flex-wrap gap-3">
          <Button variant="primary" to="/checkout">Retry checkout</Button>
          <Button variant="secondary" to="/support">Contact support</Button>
        </div>
        <p className="text-xs text-ink-2">Need help? <a href="mailto:heyarkvoid@gmail.com" className="text-brand-deep underline underline-offset-4">heyarkvoid@gmail.com</a></p>
      </Tile>
    </div>
  );
}
