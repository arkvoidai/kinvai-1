import { useEffect, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { Button, Spinner, Tile } from '../components/primitives';
import { useAuth } from '../lib/auth/AuthProvider';
import { validateNextPath } from '../lib/auth/authHelpers';
import { usePageMeta } from '../lib/seo/usePageMeta';
import { getSupabaseBrowserClient } from '../lib/supabase/client';

export function AuthCallbackPage() {
  usePageMeta({ title: 'Signing in — Kinvai', noindex: true });

  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { signInWithGoogle } = useAuth();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  const safeNext = validateNextPath(searchParams.get('next'), '/account');
  const callbackSearch = location.search;

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams(callbackSearch);
    if (params.get('error')) {
      setErrorMessage(
        'Google sign-in could not be completed. No account changes were made. Please try again.'
      );
      return () => { active = false; };
    }

    const client = getSupabaseBrowserClient();
    if (!client) {
      setErrorMessage('Sign-in is unavailable right now. Please try again later.');
      return () => { active = false; };
    }

    // detectSessionInUrl is enabled on the singleton client. getSession waits for its
    // initialization and PKCE callback processing, avoiding a second code exchange.
    client.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error || !data.session) {
        setErrorMessage('The sign-in link could not be verified. It may have expired. Please try again.');
        return;
      }
      window.history.replaceState({}, document.title, location.pathname);
      window.location.replace(safeNext);
    }).catch(() => {
      if (active) setErrorMessage('The sign-in link could not be verified. Please try again.');
    });

    return () => { active = false; };
  }, [callbackSearch, location.pathname, safeNext]);

  const retrySignIn = async () => {
    if (retrying) return;
    setRetrying(true);
    setErrorMessage(null);
    const result = await signInWithGoogle(safeNext);
    if (result.error) setErrorMessage(result.error);
    setRetrying(false);
  };

  return (
    <div className="kv-container py-16 max-w-lg">
      <Tile variant="white" radius="xl" padding="lg" className="flex flex-col items-start gap-4">
        {errorMessage ? (
          <>
            <span className="w-11 h-11 rounded-full bg-peach inline-flex items-center justify-center text-ink" aria-hidden="true">
              <RefreshCw size={19} strokeWidth={1.75} />
            </span>
            <h1 className="type-h3 font-semibold text-ink">Sign-in could not complete.</h1>
            <p role="alert" className="text-sm text-ink-2">{errorMessage}</p>
            <Button variant="primary" loading={retrying} onClick={() => void retrySignIn()} icon={<RefreshCw size={16} strokeWidth={1.75} aria-hidden="true" />}>
              Try Google sign-in again
            </Button>
            <Link to="/account" className="inline-flex items-center gap-2 min-h-[44px] text-sm font-medium text-ink-2 hover:text-ink">
              <ArrowLeft size={16} aria-hidden="true" /> Return to account
            </Link>
          </>
        ) : (
          <div className="flex items-center gap-3">
            <Spinner label="Completing sign-in" />
            <p className="text-base font-medium text-ink">Completing sign-in…</p>
          </div>
        )}
      </Tile>
    </div>
  );
}
