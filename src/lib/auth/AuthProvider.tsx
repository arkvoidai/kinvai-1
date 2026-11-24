import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { getPublicConfig } from '../config';
import { ProfileSchema, type Profile } from '../data/types';
import { getSupabaseBrowserClient } from '../supabase/client';
import { buildOAuthRedirectUrl } from './authHelpers';

export interface AuthContextValue {
  user: User | null;
  profile: Profile | null;
  isAdmin: boolean;
  loading: boolean;
  configured: boolean;
  signInWithGoogle: (redirectPath?: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<{ error: string | null }>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function fetchUserProfile(userId: string): Promise<Profile | null> {
  const client = getSupabaseBrowserClient();
  if (!client) return null;

  try {
    const { data, error } = await client
      .from('profiles')
      .select('id, display_name, avatar_url, country_code, is_admin')
      .eq('id', userId)
      .maybeSingle();

    if (error || !data) return null;
    const parsed = ProfileSchema.safeParse(data);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const profileRequestRef = useRef(0);

  const client = getSupabaseBrowserClient();
  const configured = Boolean(client);

  const syncSession = useCallback(async (session: Session | null) => {
    const requestId = ++profileRequestRef.current;
    const nextUser = session?.user ?? null;

    setUser(nextUser);
    setProfile(null);

    if (!nextUser) return;

    const nextProfile = await fetchUserProfile(nextUser.id);
    if (requestId === profileRequestRef.current) {
      setProfile(nextProfile);
    }
  }, []);

  useEffect(() => {
    if (!client) {
      setUser(null);
      setProfile(null);
      setLoading(false);
      return;
    }

    let active = true;
    const bootRevision = profileRequestRef.current;

    // Subscribe before reading the stored session so a sign-in/sign-out event cannot be missed.
    // Keep this callback synchronous; profile reads run after it returns.
    let initialSessionEventReceived = false;
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === 'INITIAL_SESSION') initialSessionEventReceived = true;

      // Defer all Supabase reads until this auth callback has returned to avoid lock contention.
      queueMicrotask(() => {
        if (!active) return;
        void syncSession(session).finally(() => {
          if (active && event === 'INITIAL_SESSION') setLoading(false);
        });
      });
    });

    client.auth
      .getSession()
      .then(async ({ data, error }) => {
        if (
          !active ||
          initialSessionEventReceived ||
          profileRequestRef.current !== bootRevision
        ) return;
        if (error) {
          setUser(null);
          setProfile(null);
        } else {
          await syncSession(data.session);
        }
        if (active && !initialSessionEventReceived) setLoading(false);
      })
      .catch(() => {
        if (!active || profileRequestRef.current !== bootRevision) return;
        setUser(null);
        setProfile(null);
        setLoading(false);
      });

    return () => {
      active = false;
      profileRequestRef.current += 1;
      subscription.unsubscribe();
    };
  }, [client, syncSession]);

  const signInWithGoogle = useCallback(
    async (redirectPath = '/account'): Promise<{ error: string | null }> => {
      if (!client) {
        return { error: 'Sign-in is unavailable until Supabase authentication is configured.' };
      }

      const { siteUrl } = getPublicConfig();
      const runtimeOrigin = typeof window !== 'undefined' ? window.location.origin : '';
      const redirectTo = buildOAuthRedirectUrl(siteUrl, redirectPath, runtimeOrigin);

      try {
        const { error } = await client.auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo },
        });
        return { error: error ? error.message : null };
      } catch {
        return { error: 'Google sign-in could not start. Please try again.' };
      }
    },
    [client]
  );

  const signOut = useCallback(async (): Promise<{ error: string | null }> => {
    if (!client) return { error: 'Sign-out is unavailable right now.' };

    try {
      const { error } = await client.auth.signOut();
      if (error) return { error: error.message };
      setUser(null);
      setProfile(null);
      return { error: null };
    } catch {
      return { error: 'Sign-out could not be completed. Please try again.' };
    }
  }, [client]);

  const refreshProfile = useCallback(async () => {
    if (!user) return;
    const nextProfile = await fetchUserProfile(user.id);
    setProfile(nextProfile);
  }, [user]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      profile,
      isAdmin: Boolean(profile?.is_admin),
      loading,
      configured,
      signInWithGoogle,
      signOut,
      refreshProfile,
    }),
    [user, profile, loading, configured, signInWithGoogle, signOut, refreshProfile]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
