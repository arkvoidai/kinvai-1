import { Outlet, useLocation } from 'react-router-dom';
import { PageTransition } from '../../lib/motion';
import { AnnouncementBar } from './AnnouncementBar';
import { CartFlightOverlay } from './CartFlightOverlay';
import { CartSheet } from './CartSheet';
import { CommandSearch } from './CommandSearch';
import { Footer } from './Footer';
import { Header } from './Header';
import { MobileBottomBar } from './MobileBottomBar';
import { ScrollProgressBar } from './ScrollProgressBar';
import { SignInSheet } from './SignInSheet';

export function Shell() {
  const { pathname } = useLocation();
  const isAdminRoute = pathname === '/admin' || pathname.startsWith('/admin/');

  return (
    <div className="min-h-dvh flex flex-col bg-page text-ink">
      {!isAdminRoute ? (
        <>
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:rounded-full focus:bg-ink focus:text-white focus:px-4 focus:py-2 focus:text-sm"
          >
            Skip to content
          </a>
          <ScrollProgressBar />
          <AnnouncementBar />
          <Header />
        </>
      ) : null}

      <main id="main-content" className="flex-1">
        <PageTransition>
          <Outlet />
        </PageTransition>
      </main>

      {!isAdminRoute ? (
        <>
          <Footer />
          <MobileBottomBar />
          <CartSheet />
          <CommandSearch />
          <SignInSheet />
          <CartFlightOverlay />
        </>
      ) : null}
    </div>
  );
}
