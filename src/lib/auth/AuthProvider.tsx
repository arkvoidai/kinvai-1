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
  signOut: () => Promise<void>;
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
  const bootedRef = useRef(false);

  const client = getSupabaseBrowserClient();
  const configured = Boolean(client);

  const syncSession = useCallback(async (session: Session | null) => {
    const nextUser = session?.user ?? null;
    setUser(nextUser);
    if (nextUser) {
      const nextProfile = await fetchUserProfile(nextUser.id);
      setProfile(nextProfile);
    } else {
      setProfile(null);
    }
  }, []);

  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;

    if (!client) {
      setLoading(false);
      return;
    }

    let active = true;

    // Resolve the session ONCE at boot via getSession()
    client.auth
      .getSession()
      .then(async ({ data }) => {
        if (!active) return;
        await syncSession(data.session);
        if (active) {
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setUser(null);
          setProfile(null);
          setLoading(false);
        }
      });

    // Keep session live on subsequent auth state changes
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      void syncSession(session);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [client, syncSession]);

  const signInWithGoogle = useCallback(
    async (redirectPath = '/account'): Promise<{ error: string | null }> => {
      if (!client) {
        return {
          error: 'Sign-in is unavailable until Supabase authentication is configured.',
        };
      }
      const { siteUrl } = getPublicConfig();
      const runtimeOrigin = typeof window !== 'undefined' ? window.location.origin : '';
      const redirectTo = buildOAuthRedirectUrl(siteUrl, redirectPath, runtimeOrigin);

      const { error } = await client.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo,
        },
      });
      return { error: error ? error.message : null };
    },
    [client]
  );

  const signOut = useCallback(async () => {
    if (!client) return;
    await client.auth.signOut();
    setUser(null);
    setProfile(null);
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
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}
