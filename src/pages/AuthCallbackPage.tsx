import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Spinner, Tile } from '../components/primitives';
import { validateNextPath } from '../lib/auth/authHelpers';
import { usePageMeta } from '../lib/seo/usePageMeta';
import { getSupabaseBrowserClient } from '../lib/supabase/client';

export function AuthCallbackPage() {
  usePageMeta({ title: 'Signing in — Kinvai', noindex: true });

  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const safeNext = validateNextPath(searchParams.get('next'), '/account');
    const client = getSupabaseBrowserClient();

    if (!client) {
      navigate(safeNext, { replace: true });
      return;
    }

    const code = searchParams.get('code');
    if (code) {
      client.auth
        .exchangeCodeForSession(code)
        .then(({ error }) => {
          if (error) {
            setErrorMessage(error.message);
          } else {
            navigate(safeNext, { replace: true });
          }
        })
        .catch(() => {
          setErrorMessage('That did not work. Try again, or write to heyarkvoid@gmail.com.');
        });
      return;
    }

    client.auth.getSession().then(() => {
      navigate(safeNext, { replace: true });
    });
  }, [navigate, searchParams]);

  return (
    <div className="kv-container py-16 max-w-lg">
      <Tile variant="white" radius="xl" padding="lg" className="flex flex-col items-start gap-4">
        {errorMessage ? (
          <>
            <h1 className="type-h3 font-semibold text-ink">Sign-in could not complete.</h1>
            <p className="text-sm text-ink-2">{errorMessage}</p>
            <Button variant="primary" to="/account">
              Return to account
            </Button>
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
