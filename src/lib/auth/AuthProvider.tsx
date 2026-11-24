import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { User } from '@supabase/supabase-js';
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
    // is_admin is read-only here; the browser never writes or upserts role information.
    const { data, error } = await client
      .from('profiles')
      .select('id, display_name, avatar_url, country_code, is_admin')
      .eq('id', userId)
      .maybeSingle();
    if (error) {
      if (import.meta.env.DEV) console.error('[kinvai-auth] Profile read failed.', error);
      return null;
    }
    if (!data) return null;
    const parsed = ProfileSchema.safeParse(data);
    if (!parsed.success && import.meta.env.DEV) console.error('[kinvai-auth] Profile row did not match its schema.', parsed.error.issues);
    return parsed.success ? parsed.data : null;
  } catch (error) {
    if (import.meta.env.DEV) console.error('[kinvai-auth] Profile read threw.', error);
    return null;
  }
}

async function syncProfileAndFetch(user: User): Promise<Profile | null> {
  const client = getSupabaseBrowserClient();
  if (!client) return null;

  // This function is called from a React effect, never inside onAuthStateChange.
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  const session = data.session;
  if (!session || session.user.id !== user.id) return null;

  const response = await fetch('/api/profile/sync', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { Authorization: `Bearer ${session.access_token}`, Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Profile sync failed (HTTP ${response.status}).`);
  return fetchUserProfile(user.id);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const client = getSupabaseBrowserClient();
  const configured = Boolean(client);

  useEffect(() => {
    if (!client) {
      setUser(null);
      setProfile(null);
      setLoading(false);
      return;
    }

    let active = true;
    // The singleton client's detectSessionInUrl=true handler owns the PKCE exchange and emits
    // INITIAL_SESSION after restoring the session. This callback is deliberately synchronous.
    const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      const nextUser = session?.user ?? null;
      setUser(nextUser);
      setProfile((current) => current?.id === nextUser?.id ? current : null);
      if (event === 'INITIAL_SESSION') setLoading(false);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [client]);

  // Profile sync and the database read happen after the auth callback has returned, keyed by user ID.
  useEffect(() => {
    if (!client || !user) {
      setProfile(null);
      return;
    }
    let active = true;
    const currentUser = user;
    void syncProfileAndFetch(currentUser)
      .then((nextProfile) => {
        if (active) setProfile(nextProfile);
      })
      .catch((error) => {
        if (active && import.meta.env.DEV) console.error('[kinvai-auth] Profile sync failed.', error);
      });
    return () => {
      active = false;
    };
  }, [client, user?.id]);

  const signInWithGoogle = useCallback(
    async (redirectPath = '/account'): Promise<{ error: string | null }> => {
      if (!client) return { error: 'Sign-in is unavailable until Supabase authentication is configured.' };
      const { siteUrl } = getPublicConfig();
      const runtimeOrigin = typeof window !== 'undefined' ? window.location.origin : '';
      const redirectTo = buildOAuthRedirectUrl(siteUrl, redirectPath, runtimeOrigin);
      try {
        const { error } = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
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
      return { error: error ? error.message : null };
    } catch {
      return { error: 'Sign-out could not be completed. Please try again.' };
    }
  }, [client]);

  const refreshProfile = useCallback(async () => {
    if (!user) return;
    try {
      setProfile(await syncProfileAndFetch(user));
    } catch (error) {
      if (import.meta.env.DEV) console.error('[kinvai-auth] Profile refresh failed.', error);
    }
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
