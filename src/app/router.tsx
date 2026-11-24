import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom';
import { RequireAuth } from '../components/auth/RequireAuth';
import { Shell } from '../components/layout/Shell';
import { HomePage } from '../pages/HomePage';

const AccountPage = lazy(() => import('../pages/AccountPage').then((module) => ({ default: module.AccountPage })));
const AdminShellPage = lazy(() => import('../pages/AdminShellPage').then((module) => ({ default: module.AdminShellPage })));
const AuthCallbackPage = lazy(() => import('../pages/AuthCallbackPage').then((module) => ({ default: module.AuthCallbackPage })));
const CheckoutPages = {
  CartRedirectPage: lazy(() => import('../pages/CheckoutPages').then((module) => ({ default: module.CartRedirectPage }))),
  CheckoutCancelledPage: lazy(() => import('../pages/CheckoutPages').then((module) => ({ default: module.CheckoutCancelledPage }))),
  CheckoutFailedPage: lazy(() => import('../pages/CheckoutPages').then((module) => ({ default: module.CheckoutFailedPage }))),
  CheckoutPage: lazy(() => import('../pages/CheckoutPages').then((module) => ({ default: module.CheckoutPage }))),
  CheckoutSuccessPage: lazy(() => import('../pages/CheckoutPages').then((module) => ({ default: module.CheckoutSuccessPage }))),
};
const CollectionsPages = {
  CollectionDetailPage: lazy(() => import('../pages/CollectionsPages').then((module) => ({ default: module.CollectionDetailPage }))),
  CollectionsPage: lazy(() => import('../pages/CollectionsPages').then((module) => ({ default: module.CollectionsPage }))),
};
const DesignPage = lazy(() => import('../pages/DesignPage').then((module) => ({ default: module.DesignPage })));
const InfoPages = {
  AboutPage: lazy(() => import('../pages/InfoPages').then((module) => ({ default: module.AboutPage }))),
  HowItWorksPage: lazy(() => import('../pages/InfoPages').then((module) => ({ default: module.HowItWorksPage }))),
  LicencePage: lazy(() => import('../pages/InfoPages').then((module) => ({ default: module.LicencePage }))),
  PrivacyPage: lazy(() => import('../pages/InfoPages').then((module) => ({ default: module.PrivacyPage }))),
  RefundsPage: lazy(() => import('../pages/InfoPages').then((module) => ({ default: module.RefundsPage }))),
  SupportPage: lazy(() => import('../pages/InfoPages').then((module) => ({ default: module.SupportPage }))),
  TermsPage: lazy(() => import('../pages/InfoPages').then((module) => ({ default: module.TermsPage }))),
};
const NotFoundPage = lazy(() => import('../pages/NotFoundPage').then((module) => ({ default: module.NotFoundPage })));
const ProductDetailPage = lazy(() => import('../pages/ProductDetailPage').then((module) => ({ default: module.ProductDetailPage })));
const SavedPage = lazy(() => import('../pages/SavedPage').then((module) => ({ default: module.SavedPage })));
const SearchPage = lazy(() => import('../pages/SearchPage').then((module) => ({ default: module.SearchPage })));
const ShopPage = lazy(() => import('../pages/ShopPage').then((module) => ({ default: module.ShopPage })));

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [pathname]);
  return null;
}

function RouteLoading() {
  return (
    <main className="kv-container py-16 min-h-[45vh]" role="status" aria-live="polite">
      <span className="inline-flex items-center gap-2 text-sm text-ink-2"><span className="w-2 h-2 rounded-full bg-brand kv-dot-pulse" />Loading page…</span>
    </main>
  );
}

export function AppRouter() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <Suspense fallback={<RouteLoading />}>
        <Routes>
          <Route element={<Shell />}>
            <Route path="/" element={<HomePage />} />
            <Route path="/shop" element={<ShopPage />} />
            <Route path="/collections" element={<CollectionsPages.CollectionsPage />} />
            <Route path="/collections/:slug" element={<CollectionsPages.CollectionDetailPage />} />
            <Route path="/products/:slug" element={<ProductDetailPage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/saved" element={<SavedPage />} />
            <Route path="/cart-redirect" element={<CheckoutPages.CartRedirectPage />} />
            <Route path="/checkout" element={<RequireAuth><CheckoutPages.CheckoutPage /></RequireAuth>} />
            <Route path="/checkout/success" element={<RequireAuth><CheckoutPages.CheckoutSuccessPage /></RequireAuth>} />
            <Route path="/checkout/cancelled" element={<CheckoutPages.CheckoutCancelledPage />} />
            <Route path="/checkout/failed" element={<RequireAuth><CheckoutPages.CheckoutFailedPage /></RequireAuth>} />
            <Route path="/account" element={<RequireAuth><AccountPage /></RequireAuth>} />
            <Route path="/auth/callback" element={<AuthCallbackPage />} />
            <Route path="/about" element={<InfoPages.AboutPage />} />
            <Route path="/how-it-works" element={<InfoPages.HowItWorksPage />} />
            <Route path="/support" element={<InfoPages.SupportPage />} />
            <Route path="/licence" element={<InfoPages.LicencePage />} />
            <Route path="/legal/privacy" element={<InfoPages.PrivacyPage />} />
            <Route path="/legal/terms" element={<InfoPages.TermsPage />} />
            <Route path="/legal/refunds" element={<InfoPages.RefundsPage />} />
            <Route path="/admin/*" element={<AdminShellPage />} />
            <Route path="/design" element={<DesignPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
