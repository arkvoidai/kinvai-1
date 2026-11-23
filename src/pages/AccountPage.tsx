import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, LogOut, Shield } from 'lucide-react';
import {
  Breadcrumb,
  Button,
  Skeleton,
  Tabs,
  TagPill,
  Tile,
} from '../components/primitives';
import { useAuth } from '../lib/auth/AuthProvider';
import { useCart } from '../lib/cart/CartProvider';
import { usePageMeta } from '../lib/seo/usePageMeta';

const VALID_TABS = new Set(['library', 'saved', 'orders', 'profile']);

const MORE_LINKS = [
  { label: 'Collections', to: '/collections', note: 'Four ways to get a head start' },
  { label: 'How it works', to: '/how-it-works', note: 'Instant downloads & lifetime access' },
  { label: 'Support', to: '/support', note: 'Help with orders and files' },
  { label: 'Licence', to: '/licence', note: '1 licence per product. Yours for life.' },
  { label: 'Privacy', to: '/legal/privacy', note: 'How Kinvai handles your data' },
  { label: 'Terms', to: '/legal/terms', note: 'Storefront terms of service' },
  { label: 'Refunds', to: '/legal/refunds', note: 'Digital product refund policy' },
  { label: 'Contact', to: '/support', note: 'heyarkvoid@gmail.com' },
];

export function AccountPage() {
  usePageMeta({
    title: 'Account — Kinvai',
    description: 'Manage your Kinvai library, saved items, orders and profile.',
    noindex: true,
  });

  const [searchParams, setSearchParams] = useSearchParams();
  const { user, profile, isAdmin, loading, configured, signOut } = useAuth();
  const { savedIds, openSignInSheet } = useCart();

  const rawTab = searchParams.get('tab') || 'library';
  const activeTab = VALID_TABS.has(rawTab) ? rawTab : 'library';

  const setTab = (tab: string) => {
    setSearchParams({ tab }, { replace: true });
  };

  // Charter: nothing auth-dependent renders until loading is false
  if (loading) {
    return (
      <div className="kv-container py-10 max-w-4xl flex flex-col gap-6">
        <Skeleton className="h-8 w-40" rounded="pill" />
        <Skeleton className="h-14 w-80" rounded="md" />
        <Skeleton className="h-64 w-full" rounded="lg" />
      </div>
    );
  }

  return (
    <div className="kv-container py-8 md:py-12 max-w-5xl flex flex-col gap-8">
      <Breadcrumb items={[{ label: 'Home', to: '/' }, { label: 'Account' }]} />

      {!user ? (
        <Tile variant="white" radius="xl" padding="lg" className="max-w-xl flex flex-col gap-5">
          <TagPill>Persistent session</TagPill>
          <h1 className="type-h2 font-semibold text-ink">Sign in to your library.</h1>
          <p className="type-body text-ink-2">
            Access your purchased downloads, saved shortlist and order receipts across devices.
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Button
              variant="primary"
              size="lg"
              onClick={() => openSignInSheet('/account')}
              disabled={!configured}
            >
              Sign in with Google
            </Button>
            <Button variant="secondary" size="lg" to="/shop">
              Continue browsing
            </Button>
          </div>
          {!configured && (
            <p className="text-xs text-ink-2">
              Google OAuth activates automatically once SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY
              are provided in Secrets.
            </p>
          )}
        </Tile>
      ) : (
        <>
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <TagPill>Member</TagPill>
                {isAdmin && <TagPill tone="brand">Owner</TagPill>}
              </div>
              <h1 className="type-h1 font-semibold text-ink mt-2">
                {profile?.display_name || user.email || 'Your account'}
              </h1>
            </div>
            <div className="flex items-center gap-2.5">
              {isAdmin && (
                <Button
                  variant="secondary"
                  size="sm"
                  to="/admin"
                  icon={<Shield size={16} strokeWidth={1.75} aria-hidden="true" />}
                >
                  Owner dashboard
                </Button>
              )}
              <Button
                variant="secondary"
                size="sm"
                onClick={signOut}
                icon={<LogOut size={16} strokeWidth={1.75} aria-hidden="true" />}
              >
                Sign out
              </Button>
            </div>
          </div>

          <Tabs
            ariaLabel="Account sections"
            activeId={activeTab}
            onChange={setTab}
            items={[
              {
                id: 'library',
                label: 'Library',
                content: (
                  <Tile variant="white" radius="lg" padding="lg">
                    <h2 className="type-h3 font-semibold text-ink">Purchased downloads</h2>
                    <p className="text-sm text-ink-2 mt-2">
                      Files unlocked by verified orders appear here with expiring private download
                      links.
                    </p>
                    <div className="mt-5">
                      <Button variant="primary" to="/shop">
                        Explore the shop
                      </Button>
                    </div>
                  </Tile>
                ),
              },
              {
                id: 'saved',
                label: 'Saved',
                badge: savedIds.length,
                content: (
                  <Tile variant="white" radius="lg" padding="lg">
                    <h2 className="type-h3 font-semibold text-ink">Saved items</h2>
                    <p className="text-sm text-ink-2 mt-2">
                      You have {savedIds.length} saved {savedIds.length === 1 ? 'item' : 'items'}.
                    </p>
                    <div className="mt-5">
                      <Button variant="secondary" to="/saved">
                        Open saved page
                      </Button>
                    </div>
                  </Tile>
                ),
              },
              {
                id: 'orders',
                label: 'Orders',
                content: (
                  <Tile variant="white" radius="lg" padding="lg">
                    <h2 className="type-h3 font-semibold text-ink">Order history</h2>
                    <p className="text-sm text-ink-2 mt-2">
                      No completed orders recorded yet.
                    </p>
                  </Tile>
                ),
              },
              {
                id: 'profile',
                label: 'Profile',
                content: (
                  <Tile variant="white" radius="lg" padding="lg" className="flex flex-col gap-3">
                    <h2 className="type-h3 font-semibold text-ink">Profile details</h2>
                    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 text-sm">
                      <div>
                        <dt className="type-label text-ink-2">Email</dt>
                        <dd className="mt-1 text-ink font-medium">{user.email}</dd>
                      </div>
                      <div>
                        <dt className="type-label text-ink-2">Display name</dt>
                        <dd className="mt-1 text-ink font-medium">
                          {profile?.display_name || 'Not set'}
                        </dd>
                      </div>
                    </dl>
                  </Tile>
                ),
              },
            ]}
          />
        </>
      )}

      {/* "More" navigation row inside Account */}
      <section aria-labelledby="account-more-heading" className="pt-2">
        <Tile variant="white" radius="xl" padding="lg" className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <span className="type-label text-ink-2">More</span>
              <h2 id="account-more-heading" className="type-h3 font-semibold text-ink mt-1">
                Pages, policies &amp; help
              </h2>
            </div>
          </div>
          <nav aria-label="More Kinvai links" className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {MORE_LINKS.map((item) => (
              <Link
                key={`${item.label}-${item.to}`}
                to={item.to}
                viewTransition
                className="group flex items-center justify-between gap-3 min-h-[52px] px-4 py-3 rounded-[16px] bg-page hover:bg-stone transition-colors kv-press"
              >
                <div className="min-w-0">
                  <span className="block text-sm font-medium text-ink">{item.label}</span>
                  <span className="block text-xs text-ink-2 truncate">{item.note}</span>
                </div>
                <ArrowRight
                  size={16}
                  strokeWidth={1.75}
                  className="text-ink-2 group-hover:text-ink shrink-0 transition-colors"
                  aria-hidden="true"
                />
              </Link>
            ))}
          </nav>
        </Tile>
      </section>
    </div>
  );
}
