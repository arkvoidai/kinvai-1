import { useEffect, useRef, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { Skeleton } from '../primitives';
import { useAuth } from '../../lib/auth/AuthProvider';
import { useCart } from '../../lib/cart/CartProvider';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const { openSignInSheet } = useCart();
  const location = useLocation();
  const promptedForPath = useRef<string | null>(null);

  const returnPath = location.pathname + location.search + location.hash;

  useEffect(() => {
    if (loading) return;
    if (user) {
      promptedForPath.current = null;
      return;
    }
    if (promptedForPath.current === returnPath) return;
    promptedForPath.current = returnPath;
    openSignInSheet(returnPath);
  }, [loading, user, returnPath, openSignInSheet]);

  if (loading) {
    return (
      <div className="kv-container py-10 max-w-4xl flex flex-col gap-5" aria-busy="true">
        <Skeleton className="h-8 w-40" rounded="pill" />
        <Skeleton className="h-14 w-80" rounded="md" />
        <Skeleton className="h-64 w-full" rounded="lg" />
      </div>
    );
  }

  return <>{children}</>;
}
