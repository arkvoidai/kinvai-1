import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  BookOpen,
  Download,
  Heart,
  LogOut,
  PackageCheck,
  ShieldCheck,
} from 'lucide-react';
import { ProductCard } from '../components/layout/ProductCard';
import {
  Breadcrumb,
  Button,
  Dialog,
  Input,
  ProductCover,
  Select,
  Sheet,
  Skeleton,
  TagPill,
  Tile,
} from '../components/primitives';
import { useAuth } from '../lib/auth/AuthProvider';
import { useCart } from '../lib/cart/CartProvider';
import { getSupabaseBrowserClient } from '../lib/supabase/client';
import {
  getAccountLibrary,
  getAccountOrders,
  getLibraryFileMetadata,
  saveOwnerProductReview,
  updateAccountProfile,
  type AccountLibraryItem,
  type AccountOrder,
  type LibraryFileMetadata,
} from '../lib/account/accountRepository';
import { usePageMeta } from '../lib/seo/usePageMeta';
import { useToast } from '../components/primitives/Toast';

const VALID_TABS = new Set(['library', 'saved', 'orders', 'profile']);
type TabId = 'library' | 'saved' | 'orders' | 'profile';
type DownloadStatus = 'idle' | 'preparing' | 'starting' | 'error';
type DownloadState = { status: DownloadStatus; error?: string };

const ACCOUNT_TABS: Array<{ id: TabId; label: string }> = [
  { id: 'library', label: 'Library' },
  { id: 'saved', label: 'Saved' },
  { id: 'orders', label: 'Orders' },
  { id: 'profile', label: 'Profile' },
];

const COUNTRY_OPTIONS = [
  { value: '', label: 'Choose a country' },
  { value: 'AU', label: 'Australia' },
  { value: 'AT', label: 'Austria' },
  { value: 'BD', label: 'Bangladesh' },
  { value: 'BE', label: 'Belgium' },
  { value: 'BR', label: 'Brazil' },
  { value: 'CA', label: 'Canada' },
  { value: 'CN', label: 'China' },
  { value: 'DK', label: 'Denmark' },
  { value: 'EG', label: 'Egypt' },
  { value: 'FI', label: 'Finland' },
  { value: 'FR', label: 'France' },
  { value: 'DE', label: 'Germany' },
  { value: 'IN', label: 'India' },
  { value: 'ID', label: 'Indonesia' },
  { value: 'IE', label: 'Ireland' },
  { value: 'IT', label: 'Italy' },
  { value: 'JP', label: 'Japan' },
  { value: 'MY', label: 'Malaysia' },
  { value: 'MX', label: 'Mexico' },
  { value: 'NP', label: 'Nepal' },
  { value: 'NL', label: 'Netherlands' },
  { value: 'NZ', label: 'New Zealand' },
  { value: 'NG', label: 'Nigeria' },
  { value: 'NO', label: 'Norway' },
  { value: 'PK', label: 'Pakistan' },
  { value: 'PH', label: 'Philippines' },
  { value: 'PL', label: 'Poland' },
  { value: 'PT', label: 'Portugal' },
  { value: 'SG', label: 'Singapore' },
  { value: 'ZA', label: 'South Africa' },
  { value: 'KR', label: 'South Korea' },
  { value: 'ES', label: 'Spain' },
  { value: 'LK', label: 'Sri Lanka' },
  { value: 'SE', label: 'Sweden' },
  { value: 'CH', label: 'Switzerland' },
  { value: 'TH', label: 'Thailand' },
  { value: 'TR', label: 'Türkiye' },
  { value: 'AE', label: 'United Arab Emirates' },
  { value: 'GB', label: 'United Kingdom' },
  { value: 'US', label: 'United States' },
  { value: 'VN', label: 'Vietnam' },
];

function formatUsd(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date unavailable';
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

function formatFileSize(size: number | null): string {
  if (size == null || !Number.isFinite(size)) return 'Size unavailable';
  if (size < 1024) return size + ' B';
  if (size < 1024 * 1024) return (size / 1024).toFixed(1) + ' KB';
  if (size < 1024 * 1024 * 1024) return (size / (1024 * 1024)).toFixed(1) + ' MB';
  return (size / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

function orderStatus(status: AccountOrder['status']): { label: string; className: string } {
  switch (status) {
    case 'paid':
      return { label: 'Paid', className: 'bg-success-bg text-success' };
    case 'pending':
    case 'created':
      return { label: 'Pending', className: 'bg-warning-bg text-warning' };
    case 'failed':
      return { label: 'Failed', className: 'bg-error-bg text-error' };
    case 'cancelled':
      return { label: 'Cancelled', className: 'bg-stone text-ink-2' };
    case 'refunded':
      return { label: 'Refunded', className: 'bg-warning-bg text-warning' };
    case 'partially_refunded':
      return { label: 'Partially refunded', className: 'bg-warning-bg text-warning' };
    default:
      return { label: 'Pending', className: 'bg-stone text-ink-2' };
  }
}

function InlineError({ children }: { children: string }) {
  return (
    <p role="alert" className="rounded-[14px] border border-error/20 bg-error-bg px-4 py-3 text-sm text-error">
      {children}
    </p>
  );
}

export function AccountPage() {
  usePageMeta({
    title: 'Account — Kinvai',
    description: 'Manage your Kinvai library, saved items, orders and profile.',
    noindex: true,
  });

  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    user,
    profile,
    isAdmin,
    loading: authLoading,
    configured,
    signOut,
    refreshProfile,
  } = useAuth();
  const {
    savedIds,
    collections,
    catalogueProducts,
    catalogueIsPreview,
    catalogueLoaded,
    openSignInSheet,
  } = useCart();
  const { toast } = useToast();

  const rawTab = searchParams.get('tab') ?? 'library';
  const activeTab: TabId = VALID_TABS.has(rawTab) ? rawTab as TabId : 'library';

  const [libraryItems, setLibraryItems] = useState<AccountLibraryItem[]>([]);
  const [orders, setOrders] = useState<AccountOrder[]>([]);
  const [libraryFiles, setLibraryFiles] = useState<LibraryFileMetadata[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [displayName, setDisplayName] = useState('');
  const [countryCode, setCountryCode] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [signOutOpen, setSignOutOpen] = useState(false);
  const [signOutLoading, setSignOutLoading] = useState(false);

  const [downloadStates, setDownloadStates] = useState<Record<string, DownloadState>>({});
  const [fileSheetProductId, setFileSheetProductId] = useState<string | null>(null);

  const [reviewProductId, setReviewProductId] = useState<string | null>(null);
  const [reviewRating, setReviewRating] = useState('5');
  const [reviewTitle, setReviewTitle] = useState('');
  const [reviewBody, setReviewBody] = useState('');
  const [reviewSaving, setReviewSaving] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewSubmitted, setReviewSubmitted] = useState(false);

  useEffect(() => {
    if (!VALID_TABS.has(rawTab)) {
      const next = new URLSearchParams(searchParams);
      next.set('tab', 'library');
      setSearchParams(next, { replace: true });
    }
  }, [rawTab, searchParams, setSearchParams]);

  useEffect(() => {
    setDisplayName(profile?.display_name ?? '');
    setCountryCode(profile?.country_code ?? '');
  }, [profile?.display_name, profile?.country_code]);

  useEffect(() => {
    if (!user || authLoading) {
      setLibraryItems([]);
      setOrders([]);
      setLibraryFiles([]);
      setDataLoading(false);
      return;
    }

    let active = true;
    setDataLoading(true);
    setLibraryError(null);
    setOrdersError(null);
    setFilesError(null);

    const load = async () => {
      const [libraryResult, orderResult, sessionResult] = await Promise.all([
        getAccountLibrary(user.id),
        getAccountOrders(user.id),
        getSupabaseBrowserClient()?.auth.getSession() ?? Promise.resolve({ data: { session: null }, error: null }),
      ]);

      if (!active) return;
      setLibraryItems(libraryResult.items);
      setOrders(orderResult.orders);
      setLibraryError(libraryResult.error);
      setOrdersError(orderResult.error);

      const token = sessionResult.data.session?.access_token;
      if (token) {
        const fileResult = await getLibraryFileMetadata(token);
        if (!active) return;
        setLibraryFiles(fileResult.files);
        setFilesError(fileResult.error);
      } else {
        setLibraryFiles([]);
        setFilesError('Download file details are unavailable. Sign in again to refresh them.');
      }
      if (active) setDataLoading(false);
    };

    void load().catch(() => {
      if (!active) return;
      setDataLoading(false);
      setLibraryError('Your account data could not be loaded. Please try again.');
      setOrdersError('Your account data could not be loaded. Please try again.');
    });

    return () => {
      active = false;
    };
  }, [user?.id, authLoading, reloadKey]);

  const collectionById = useMemo(
    () => new Map(collections.map((collection) => [collection.id, collection])),
    [collections]
  );

  const savedProducts = useMemo(
    () => catalogueProducts.filter((product) => savedIds.includes(product.id)),
    [catalogueProducts, savedIds]
  );

  const filesByProductId = useMemo(() => {
    const map = new Map<string, LibraryFileMetadata[]>();
    for (const file of libraryFiles) {
      const existing = map.get(file.product_id) ?? [];
      existing.push(file);
      map.set(file.product_id, existing);
    }
    return map;
  }, [libraryFiles]);

  const reviewingItem = libraryItems.find((item) => item.product.id === reviewProductId) ?? null;
  const fileSheetItem = libraryItems.find((item) => item.product.id === fileSheetProductId) ?? null;
  const fileSheetFiles = fileSheetItem ? filesByProductId.get(fileSheetItem.product.id) ?? [] : [];

  const selectTab = (tab: TabId) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', tab);
    setSearchParams(next);
  };

  const reloadAccountData = () => setReloadKey((value) => value + 1);

  const openReviewSheet = (item: AccountLibraryItem) => {
    setReviewProductId(item.product.id);
    setReviewRating(String(item.review?.rating ?? 5));
    setReviewTitle(item.review?.title ?? '');
    setReviewBody(item.review?.body ?? '');
    setReviewError(null);
    setReviewSubmitted(false);
  };

  const closeReviewSheet = () => {
    if (reviewSaving) return;
    setReviewProductId(null);
    setReviewError(null);
    setReviewSubmitted(false);
  };

  const closeFileSheet = () => setFileSheetProductId(null);

  const downloadFile = async (item: AccountLibraryItem, file?: LibraryFileMetadata) => {
    const productId = item.product.id;
    const key = productId + ':' + (file?.id ?? 'all');
    setDownloadStates((previous) => ({
      ...previous,
      [key]: { status: 'preparing' },
    }));

    try {
      const client = getSupabaseBrowserClient();
      if (!client) throw new Error('Secure downloads are unavailable right now.');
      const { data, error } = await client.auth.getSession();
      const token = data.session?.access_token;
      if (error || !token) {
        openSignInSheet('/account?tab=library');
        throw new Error('Your session expired. Sign in again, then retry the download.');
      }

      const query = file ? '?fileId=' + encodeURIComponent(file.id) : '';
      const response = await fetch('/api/download/' + encodeURIComponent(productId) + query, {
        method: 'GET',
        headers: { Authorization: 'Bearer ' + token },
        cache: 'no-store',
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(
          typeof payload.error === 'string'
            ? payload.error
            : 'The download could not start. Please try again.'
        );
      }

      setDownloadStates((previous) => ({
        ...previous,
        [key]: { status: 'starting' },
      }));

      const contentType = response.headers.get('content-type') ?? '';
      if (contentType.includes('application/json')) {
        const payload = await response.json();
        const returnedUrl =
          typeof payload.downloadUrl === 'string'
            ? payload.downloadUrl
            : typeof payload.url === 'string'
              ? payload.url
              : typeof payload.data?.url === 'string'
                ? payload.data.url
                : null;
        if (!returnedUrl) {
          throw new Error('The download service did not return a secure file link.');
        }
        const destination = new URL(returnedUrl, window.location.origin);
        if (destination.protocol !== 'https:' && destination.origin !== window.location.origin) {
          throw new Error('The download link was not secure.');
        }
        window.location.assign(destination.toString());
      } else if (response.redirected) {
        const destination = new URL(response.url);
        if (destination.protocol !== 'https:' && destination.origin !== window.location.origin) {
          throw new Error('The download link was not secure.');
        }
        window.location.assign(destination.toString());
      } else {
        const blob = await response.blob();
        if (blob.size === 0) throw new Error('The file was empty. Please try again.');
        const objectUrl = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = objectUrl;
        anchor.download = file?.file_name || item.product.name;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The download could not start. Please try again.';
      setDownloadStates((previous) => ({
        ...previous,
        [key]: { status: 'error', error: message },
      }));
    }
  };

  const startProductDownload = (item: AccountLibraryItem) => {
    const activeFiles = filesByProductId.get(item.product.id) ?? [];
    if (activeFiles.length > 1) {
      setFileSheetProductId(item.product.id);
      return;
    }
    void downloadFile(item, activeFiles[0]);
  };

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user || profileSaving) return;
    setProfileSaving(true);
    setProfileError(null);

    const result = await updateAccountProfile(user.id, {
      display_name: displayName,
      country_code: countryCode || null,
    });
    if (result.error) {
      setProfileError(result.error);
      toast({ title: 'Profile not saved', description: result.error, tone: 'error' });
    } else {
      await refreshProfile();
      toast({ title: 'Profile updated', description: 'The account details have been saved.', tone: 'success' });
    }
    setProfileSaving(false);
  };

  const submitReview = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user || !reviewingItem || reviewSaving) return;
    setReviewSaving(true);
    setReviewError(null);

    const result = await saveOwnerProductReview({
      userId: user.id,
      productId: reviewingItem.product.id,
      rating: Number(reviewRating),
      title: reviewTitle,
      body: reviewBody,
    });

    if (result.error || !result.review) {
      setReviewError(result.error || 'Your review could not be submitted. Please try again.');
    } else {
      setLibraryItems((previous) =>
        previous.map((item) =>
          item.product.id === reviewingItem.product.id
            ? { ...item, review: result.review }
            : item
        )
      );
      setReviewSubmitted(true);
      toast({
        title: 'Review submitted',
        description: 'Your review is awaiting approval.',
        tone: 'success',
      });
    }
    setReviewSaving(false);
  };

  const confirmSignOut = async () => {
    if (signOutLoading) return;
    setSignOutLoading(true);
    const result = await signOut();
    setSignOutLoading(false);
    if (result.error) {
      toast({ title: 'Could not sign out', description: result.error, tone: 'error' });
      return;
    }
    setSignOutOpen(false);
    toast({ title: 'Signed out', description: 'The Kinvai account is signed out on this browser.', tone: 'success' });
    navigate('/', { replace: true });
  };

  const userName =
    profile?.display_name?.trim() ||
    String(user?.user_metadata?.full_name ?? user?.user_metadata?.name ?? '').trim() ||
    user?.email?.split('@')[0] ||
    'Your account';
  const avatarUrl =
    profile?.avatar_url ||
    (typeof user?.user_metadata?.avatar_url === 'string' ? user.user_metadata.avatar_url : '') ||
    (typeof user?.user_metadata?.picture === 'string' ? user.user_metadata.picture : '');

  if (authLoading) {
    return (
      <div className="kv-container max-w-6xl py-10 flex flex-col gap-5" aria-busy="true">
        <Skeleton className="h-8 w-36" rounded="pill" />
        <Skeleton className="h-36 w-full" rounded="xl" />
        <Skeleton className="h-12 w-full" rounded="pill" />
        <Skeleton className="h-72 w-full" rounded="xl" />
      </div>
    );
  }

  return (
    <div className="kv-container max-w-6xl py-6 sm:py-8 lg:py-12 flex flex-col gap-6 sm:gap-8">
      <Breadcrumb items={[{ label: 'Home', to: '/' }, { label: 'Account' }]} />

      {!user ? (
        <Tile variant="white" radius="xl" padding="lg" className="max-w-xl flex flex-col gap-5">
          <TagPill>MEMBER ACCOUNT</TagPill>
          <h1 className="type-h2 font-semibold text-ink">Everything in one place.</h1>
          <p className="type-body text-ink-2">
            Sign in to access purchased downloads, saved products, order receipts and account details.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button variant="primary" size="lg" disabled={!configured} onClick={() => openSignInSheet('/account?tab=library')}>
              Sign in with Google
            </Button>
            <Button variant="secondary" size="lg" to="/shop">Explore the shop</Button>
          </div>
          {!configured && (
            <p className="text-sm text-ink-2">Google sign-in is unavailable until Supabase is configured.</p>
          )}
        </Tile>
      ) : (
        <>
          <section className="grid grid-cols-1 md:grid-cols-12 gap-3 sm:gap-4" aria-label="Account overview">
            <Tile variant="white" radius="xl" padding="lg" className="md:col-span-8 flex flex-col sm:flex-row sm:items-center gap-5">
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt=""
                  width={76}
                  height={76}
                  referrerPolicy="no-referrer"
                  className="w-[76px] h-[76px] rounded-full object-cover bg-stone border border-line shrink-0"
                />
              ) : (
                <div aria-hidden="true" className="w-[76px] h-[76px] rounded-full bg-ink text-white inline-flex items-center justify-center text-2xl font-semibold shrink-0">
                  {userName.charAt(0).toUpperCase()}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <TagPill>MEMBER</TagPill>
                  {isAdmin && <TagPill tone="brand">OWNER</TagPill>}
                </div>
                <h1 className="type-h2 font-semibold text-ink mt-2 break-words">{userName}</h1>
                <p className="text-sm text-ink-2 mt-1 break-all">{user.email}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                {isAdmin && (
                  <Button variant="secondary" size="sm" to="/admin" icon={<ShieldCheck size={16} aria-hidden="true" />}>
                    Owner tools
                  </Button>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setSignOutOpen(true)}
                  icon={<LogOut size={16} strokeWidth={1.75} aria-hidden="true" />}
                >
                  Sign out
                </Button>
              </div>
            </Tile>

            <Tile variant="tint-butter" radius="xl" padding="lg" className="md:col-span-4 flex flex-col justify-between gap-5">
              <span className="type-label text-ink-2">YOUR KINVAI</span>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="type-display-sm font-semibold text-ink tabular-nums">{dataLoading ? '—' : libraryItems.length}</span>
                  <p className="text-sm text-ink-2 mt-1">Owned</p>
                </div>
                <div>
                  <span className="type-display-sm font-semibold text-ink tabular-nums">{savedIds.length}</span>
                  <p className="text-sm text-ink-2 mt-1">Saved</p>
                </div>
              </div>
              <p className="text-xs text-ink-2">Your products and shortlist, together.</p>
            </Tile>
          </section>

          <nav
            aria-label="Account sections"
            className="sticky top-[64px] lg:top-[76px] z-[var(--z-header)] -mx-4 px-4 py-2 bg-page/95 backdrop-blur-md border-y border-line/70 sm:mx-0 sm:px-0 sm:border-0 sm:bg-transparent"
          >
            <div role="tablist" aria-label="Account sections" className="inline-flex max-w-full gap-1 rounded-full bg-stone p-1 border border-line overflow-x-auto">
              {ACCOUNT_TABS.map((tab) => (
                <button
                  key={tab.id}
                  id={'account-tab-' + tab.id}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  aria-controls="account-tab-panel"
                  onClick={() => selectTab(tab.id)}
                  className={
                    'inline-flex min-h-[42px] items-center justify-center rounded-full px-4 text-sm font-medium whitespace-nowrap transition-colors ' +
                    (activeTab === tab.id
                      ? 'bg-ink text-white'
                      : 'text-ink-2 hover:bg-surface hover:text-ink')
                  }
                >
                  {tab.label}
                  {tab.id === 'saved' && <span className="ml-2 font-mono text-[11px] tabular-nums opacity-75">{savedIds.length}</span>}
                  {tab.id === 'library' && <span className="ml-2 font-mono text-[11px] tabular-nums opacity-75">{dataLoading ? '…' : libraryItems.length}</span>}
                </button>
              ))}
            </div>
          </nav>

          <section id="account-tab-panel" role="tabpanel" aria-labelledby={'account-tab-' + activeTab} tabIndex={0} className="min-w-0 focus-visible:outline-none">
            {activeTab === 'library' && (
              <Tile variant="white" radius="xl" padding="lg" className="flex flex-col gap-5">
                <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
                  <div>
                    <TagPill>YOUR PURCHASES</TagPill>
                    <h2 className="type-h2 font-semibold text-ink mt-2">The library.</h2>
                    <p className="text-sm text-ink-2 mt-1">Every active licence, ready when the work is.</p>
                  </div>
                  {!dataLoading && <span className="type-label text-ink-2">{libraryItems.length} OWNED</span>}
                </div>

                {dataLoading ? (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {[1, 2].map((n) => <Skeleton key={n} className="h-52 w-full" rounded="lg" />)}
                  </div>
                ) : libraryError ? (
                  <div className="flex flex-col items-start gap-4">
                    <InlineError>{libraryError}</InlineError>
                    <Button variant="secondary" onClick={reloadAccountData}>Retry library</Button>
                  </div>
                ) : libraryItems.length === 0 ? (
                  <div className="rounded-[24px] bg-page p-6 sm:p-8 flex flex-col items-start gap-4">
                    <span className="w-12 h-12 rounded-full bg-peach flex items-center justify-center text-ink" aria-hidden="true"><BookOpen size={20} /></span>
                    <div>
                      <h3 className="type-h3 font-semibold text-ink">Your library is empty. Start with a head start.</h3>
                      <p className="text-sm text-ink-2 mt-2">Products purchased with this account will appear here.</p>
                    </div>
                    <Button variant="primary" to="/shop">Shop</Button>
                  </div>
                ) : (
                  <>
                    {filesError && (
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-[14px] bg-page px-4 py-3">
                        <p className="text-sm text-ink-2">{filesError}</p>
                        <button type="button" onClick={reloadAccountData} className="text-sm font-medium text-brand-deep underline underline-offset-4">Retry file details</button>
                      </div>
                    )}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {libraryItems.map((item) => {
                        const activeFiles = filesByProductId.get(item.product.id) ?? [];
                        const primaryKey = item.product.id + ':' + (activeFiles.length === 1 ? activeFiles[0].id : 'all');
                        const state = downloadStates[primaryKey];
                        return (
                          <article key={item.entitlementId} className="rounded-[24px] border border-line bg-surface p-3 sm:p-4 flex flex-col gap-4">
                            <div className="grid grid-cols-[104px_minmax(0,1fr)] sm:grid-cols-[132px_minmax(0,1fr)] gap-4">
                              <div className="overflow-hidden rounded-[18px] bg-stone">
                                <ProductCover
                                  product={item.product}
                                  collection={item.collection}
                                  ratio="4/5"
                                  size="sm"
                                />
                              </div>
                              <div className="min-w-0 flex flex-col items-start">
                                <TagPill>IN YOUR LIBRARY</TagPill>
                                <h3 className="text-lg font-semibold text-ink leading-snug mt-2 break-words">{item.product.name}</h3>
                                <p className="text-xs text-ink-2 mt-1">Version {item.product.version || '1.0'}</p>
                                <div className="flex flex-wrap gap-1.5 mt-3">
                                  {(item.product.file_formats.length ? item.product.file_formats : ['Digital']).slice(0, 4).map((format) => (
                                    <span key={format} className="rounded-full bg-stone px-2.5 py-1 text-[11px] text-ink-2">{format}</span>
                                  ))}
                                </div>
                                <p className="text-xs text-ink-2 mt-auto pt-3">
                                  {activeFiles.length > 0
                                    ? activeFiles.length + (activeFiles.length === 1 ? ' active file' : ' active files')
                                    : 'Secure download'}
                                </p>
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
                              <Button
                                variant="primary"
                                size="sm"
                                loading={state?.status === 'preparing' || state?.status === 'starting'}
                                onClick={() => startProductDownload(item)}
                                icon={<Download size={16} strokeWidth={1.75} aria-hidden="true" />}
                              >
                                {state?.status === 'preparing' ? 'Preparing…' : state?.status === 'starting' ? 'Starting…' : 'Download'}
                              </Button>
                              <Button variant="secondary" size="sm" to={'/products/' + item.product.slug}>View product</Button>
                              <Button variant="quiet" size="sm" onClick={() => openReviewSheet(item)}>
                                {item.review ? 'Edit review' : 'Write a review'}
                              </Button>
                            </div>
                            {state?.status === 'error' && (
                              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-[14px] bg-error-bg px-3.5 py-3">
                                <p role="alert" className="text-sm text-error">{state.error}</p>
                                <button type="button" onClick={() => void downloadFile(item, activeFiles.length === 1 ? activeFiles[0] : undefined)} className="text-sm font-semibold text-error underline underline-offset-4 shrink-0">Retry</button>
                              </div>
                            )}
                            {item.review?.status === 'pending' && (
                              <p className="text-xs text-ink-2">Review status: <span className="font-medium text-warning">Awaiting approval</span></p>
                            )}
                          </article>
                        );
                      })}
                    </div>
                  </>
                )}
              </Tile>
            )}

            {activeTab === 'saved' && (
              <Tile variant="white" radius="xl" padding="lg" className="flex flex-col gap-5">
                <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
                  <div>
                    <TagPill>YOUR SHORTLIST</TagPill>
                    <h2 className="type-h2 font-semibold text-ink mt-2">Saved for later.</h2>
                  </div>
                  <span className="type-label text-ink-2">{savedIds.length} SAVED</span>
                </div>
                {!catalogueLoaded ? (
                  <div className="grid grid-cols-1 min-[340px]:grid-cols-2 xl:grid-cols-3 gap-4">
                    {[1, 2, 3].map((n) => <Skeleton key={n} className="h-72" rounded="lg" />)}
                  </div>
                ) : savedProducts.length > 0 ? (
                  <div className="grid grid-cols-1 min-[340px]:grid-cols-2 xl:grid-cols-3 gap-4">
                    {savedProducts.map((product) => (
                      <ProductCard
                        key={product.id}
                        product={product}
                        collection={product.collection_id ? collectionById.get(product.collection_id) ?? null : null}
                        isPreviewData={catalogueIsPreview}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="rounded-[24px] bg-page p-6 sm:p-8 flex flex-col items-start gap-4">
                    <span className="w-12 h-12 rounded-full bg-lilac flex items-center justify-center text-ink" aria-hidden="true"><Heart size={20} /></span>
                    <div>
                      <h3 className="type-h3 font-semibold text-ink">Nothing saved yet.</h3>
                      <p className="text-sm text-ink-2 mt-2">Save a product with its heart button and it will be waiting here.</p>
                    </div>
                    <Button variant="primary" to="/shop">Explore the shop</Button>
                  </div>
                )}
              </Tile>
            )}

            {activeTab === 'orders' && (
              <Tile variant="white" radius="xl" padding="lg" className="flex flex-col gap-5">
                <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
                  <div>
                    <TagPill>PAYMENT HISTORY</TagPill>
                    <h2 className="type-h2 font-semibold text-ink mt-2">Orders.</h2>
                    <p className="text-sm text-ink-2 mt-1">Receipts and order status for this account.</p>
                  </div>
                  {!dataLoading && <span className="type-label text-ink-2">{orders.length} ORDERS</span>}
                </div>
                {dataLoading ? (
                  <div className="flex flex-col gap-3">
                    {[1, 2].map((n) => <Skeleton key={n} className="h-24 w-full" rounded="lg" />)}
                  </div>
                ) : ordersError ? (
                  <div className="flex flex-col items-start gap-4">
                    <InlineError>{ordersError}</InlineError>
                    <Button variant="secondary" onClick={reloadAccountData}>Retry orders</Button>
                  </div>
                ) : orders.length === 0 ? (
                  <div className="rounded-[24px] bg-page p-6 sm:p-8 flex flex-col items-start gap-4">
                    <span className="w-12 h-12 rounded-full bg-butter flex items-center justify-center text-ink" aria-hidden="true"><PackageCheck size={20} /></span>
                    <div>
                      <h3 className="type-h3 font-semibold text-ink">No orders yet.</h3>
                      <p className="text-sm text-ink-2 mt-2">Completed purchases and payment updates will appear here.</p>
                    </div>
                    <Button variant="primary" to="/shop">Browse products</Button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {orders.map((order) => {
                      const status = orderStatus(order.status);
                      return (
                        <details key={order.id} className="group rounded-[20px] border border-line bg-surface overflow-hidden">
                          <summary className="list-none cursor-pointer p-4 sm:p-5 min-h-[88px] flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-5 [&::-webkit-details-marker]:hidden">
                            <div className="min-w-0 flex-1">
                              <p className="font-mono text-xs text-ink-2">{order.order_number}</p>
                              <p className="text-sm font-medium text-ink mt-1">{formatDate(order.created_at)} · {order.order_items.length} {order.order_items.length === 1 ? 'item' : 'items'}</p>
                            </div>
                            <div className="flex flex-wrap items-center gap-3 sm:justify-end">
                              <span className="text-sm font-semibold tabular-nums text-ink">{formatUsd(order.total_cents)}</span>
                              <span className={'inline-flex rounded-full px-2.5 py-1 text-xs font-medium ' + status.className}>{status.label}</span>
                              <span className="text-xs text-ink-2">{order.provider ? order.provider === 'razorpay' ? 'Razorpay' : 'PayPal' : 'Provider pending'}</span>
                              <ArrowRight size={16} className="text-ink-2 transition-transform group-open:rotate-90" aria-hidden="true" />
                            </div>
                          </summary>
                          <div className="border-t border-line bg-page/70 px-4 sm:px-5 py-4">
                            <ul className="flex flex-col divide-y divide-line">
                              {order.order_items.map((item) => (
                                <li key={item.id} className="py-3 first:pt-0 last:pb-0 flex items-center justify-between gap-4">
                                  <div className="min-w-0">
                                    <p className="text-sm font-medium text-ink">{item.product_name}</p>
                                    <p className="text-xs text-ink-2 mt-0.5">{item.sku}</p>
                                  </div>
                                  <span className="text-sm font-medium tabular-nums text-ink">{formatUsd(item.unit_price_cents)}</span>
                                </li>
                              ))}
                            </ul>
                            {order.status === 'refunded' && (
                              <p className="mt-4 rounded-[14px] bg-warning-bg px-3.5 py-3 text-sm text-warning">
                                This order was refunded. Access to its products was removed.
                              </p>
                            )}
                            {order.status === 'partially_refunded' && order.refunded_cents > 0 && (
                              <p className="mt-4 text-sm text-ink-2">Refunded: {formatUsd(order.refunded_cents)} of {formatUsd(order.total_cents)}.</p>
                            )}
                          </div>
                        </details>
                      );
                    })}
                  </div>
                )}
              </Tile>
            )}

            {activeTab === 'profile' && (
              <Tile variant="white" radius="xl" padding="lg" className="max-w-3xl flex flex-col gap-5">
                <div>
                  <TagPill>ACCOUNT DETAILS</TagPill>
                  <h2 className="type-h2 font-semibold text-ink mt-2">Profile.</h2>
                  <p className="text-sm text-ink-2 mt-1">Keep the details connected to this account up to date.</p>
                </div>
                <form onSubmit={saveProfile} className="flex flex-col gap-4">
                  <Input
                    label="Display name"
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    maxLength={80}
                    autoComplete="name"
                    placeholder="How should Kinvai address you?"
                  />
                  <Select
                    label="Country"
                    value={countryCode}
                    onChange={(event) => setCountryCode(event.target.value)}
                    options={COUNTRY_OPTIONS}
                  />
                  <Input label="Email address" value={user.email ?? ''} readOnly hint="Email is managed by Google and cannot be changed here." />
                  {profileError && <InlineError>{profileError}</InlineError>}
                  <div className="flex flex-wrap items-center gap-3 pt-2">
                    <Button type="submit" variant="primary" loading={profileSaving}>Save profile</Button>
                    <span className="text-xs text-ink-2">Only display name and country are editable.</span>
                  </div>
                </form>
                <div className="border-t border-line pt-5">
                  <h3 className="text-sm font-semibold text-ink">Account data and support</h3>
                  <p className="text-sm text-ink-2 mt-1">For a data request or account assistance, contact the Kinvai support team.</p>
                  <Link to="/support" className="inline-flex items-center gap-2 mt-3 text-sm font-medium text-brand-deep underline underline-offset-4">
                    Contact support <ArrowRight size={15} aria-hidden="true" />
                  </Link>
                </div>
              </Tile>
            )}
          </section>
        </>
      )}

      <Dialog
        open={signOutOpen}
        onClose={() => setSignOutOpen(false)}
        title="Sign out of Kinvai?"
        description="The account will be signed out on this browser. Saved purchases stay attached to the account."
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setSignOutOpen(false)} disabled={signOutLoading}>Stay signed in</Button>
            <Button variant="primary" size="sm" onClick={() => void confirmSignOut()} loading={signOutLoading}>Sign out</Button>
          </>
        }
      >
        <p className="text-sm text-ink-2">This does not delete the account or any order records.</p>
      </Dialog>

      <Sheet
        open={Boolean(fileSheetItem)}
        onClose={closeFileSheet}
        title="Choose a file"
        description={fileSheetItem ? 'Active downloads for ' + fileSheetItem.product.name + '.' : undefined}
      >
        {fileSheetItem && (
          <div className="flex flex-col gap-3">
            {fileSheetFiles.map((file) => {
              const state = downloadStates[fileSheetItem.product.id + ':' + file.id];
              return (
                <div key={file.id} className="rounded-[18px] border border-line bg-page p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-ink break-words">{file.file_name}</p>
                    <p className="text-xs text-ink-2 mt-1">{formatFileSize(file.size_bytes)}{file.version ? ' · v' + file.version : ''}</p>
                    {state?.status === 'error' && <p role="alert" className="text-xs text-error mt-2">{state.error}</p>}
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    loading={state?.status === 'preparing' || state?.status === 'starting'}
                    onClick={() => void downloadFile(fileSheetItem, file)}
                    icon={<Download size={15} aria-hidden="true" />}
                  >
                    {state?.status === 'preparing' ? 'Preparing…' : state?.status === 'starting' ? 'Starting…' : state?.status === 'error' ? 'Retry' : 'Download'}
                  </Button>
                </div>
              );
            })}
            {fileSheetFiles.length === 0 && (
              <p className="text-sm text-ink-2">No active files were returned. The product download service can still be tried from the library card.</p>
            )}
          </div>
        )}
      </Sheet>

      <Sheet
        open={Boolean(reviewingItem)}
        onClose={closeReviewSheet}
        title={reviewSubmitted ? 'Review received' : reviewingItem?.review ? 'Edit your review' : 'Write a review'}
        description={reviewingItem ? 'A verified purchase review for ' + reviewingItem.product.name + '.' : undefined}
        footer={
          reviewSubmitted ? (
            <Button variant="primary" fullWidth onClick={closeReviewSheet}>Done</Button>
          ) : (
            <Button variant="primary" fullWidth loading={reviewSaving} onClick={() => {
              const form = document.getElementById('account-review-form') as HTMLFormElement | null;
              form?.requestSubmit();
            }}>
              Submit review
            </Button>
          )
        }
      >
        {reviewSubmitted ? (
          <div className="rounded-[18px] bg-success-bg p-4">
            <p className="font-semibold text-success">Awaiting approval</p>
            <p className="text-sm text-ink-2 mt-1">The review is saved and will appear publicly after approval.</p>
          </div>
        ) : (
          <form id="account-review-form" onSubmit={submitReview} className="flex flex-col gap-4">
            {reviewingItem?.review?.status === 'pending' && (
              <p className="rounded-[14px] bg-warning-bg px-3.5 py-3 text-sm text-warning">This review is awaiting approval. Editing and resubmitting will return it to the approval queue.</p>
            )}
            <Select
              label="Rating"
              value={reviewRating}
              onChange={(event) => setReviewRating(event.target.value)}
              options={[5, 4, 3, 2, 1].map((rating) => ({ value: String(rating), label: rating + ' out of 5 stars' }))}
            />
            <Input
              label="Review title"
              value={reviewTitle}
              onChange={(event) => setReviewTitle(event.target.value)}
              maxLength={120}
              required
              placeholder="What stood out?"
            />
            <div className="flex flex-col gap-1.5">
              <label htmlFor="account-review-body" className="text-sm font-medium text-ink">Your review</label>
              <textarea
                id="account-review-body"
                value={reviewBody}
                onChange={(event) => setReviewBody(event.target.value)}
                maxLength={4000}
                required
                rows={5}
                className="w-full rounded-[14px] bg-surface px-4 py-3 text-base text-ink placeholder:text-ink-3 border border-line hover:border-line-strong focus:border-ink focus-visible:outline-2 focus-visible:outline-brand resize-y"
                placeholder="Share how the product helped with the work."
              />
              <p className="text-xs text-ink-2">{reviewBody.length}/4,000 characters</p>
            </div>
            {reviewError && <InlineError>{reviewError}</InlineError>}
          </form>
        )}
      </Sheet>
    </div>
  );
}
