# Kinvai Google sign-in setup

This guide configures Google OAuth for the existing Kinvai browser client. It does not require a database migration or any service-role credentials in the browser.

## Project details

| Setting | Value |
| --- | --- |
| Supabase project | Kinvai Arkvoid |
| Project reference | `dqgjbmpvwsoxhatadbdw` |
| Supabase URL | `https://dqgjbmpvwsoxhatadbdw.supabase.co` |
| Production site URL | `https://kinvai.arkvoid.com` |
| Production app callback | `https://kinvai.arkvoid.com/auth/callback` |
| Google authorized redirect URI | `https://dqgjbmpvwsoxhatadbdw.supabase.co/auth/v1/callback` |

The Google redirect URI is the Supabase Auth callback, **not** the Kinvai `/auth/callback` route. Supabase sends the user back to the Kinvai callback after the provider response is processed through its PKCE flow.

## 1. Configure Supabase Auth URLs

In the [Kinvai Arkvoid Supabase dashboard](https://supabase.com/dashboard/project/dqgjbmpvwsoxhatadbdw/auth/url-configuration):

1. Set **Site URL** to `https://kinvai.arkvoid.com`.
2. Add these to **Redirect URLs**:
   - `https://kinvai.arkvoid.com/auth/callback`
   - `http://localhost:3000/auth/callback` (local Express/Vite development).
3. Add the exact active AI Studio preview or Cloud Run callback URLs as described below. Do not add a broad wildcard for unrelated Google domains.

### AI Studio preview URL

AI Studio preview origins can be session- and workspace-specific; the repository does not contain a stable preview hostname. When testing OAuth:

1. Use the sign-in sheet's **Open Kinvai in a new tab** link so the Google flow is not trapped inside the preview iframe.
2. Copy the exact origin from the address bar of the opened preview tab.
3. Add `<exact-preview-origin>/auth/callback` to Supabase **Redirect URLs**. Replace the placeholder with the host actually displayed by AI Studio.

### Cloud Run URL

For each Cloud Run service used to preview this app:

1. Open Cloud Run in Google Cloud Console and copy that service's assigned HTTPS URL.
2. Add `<exact-cloud-run-service-url>/auth/callback` to Supabase **Redirect URLs**.
3. If the service URL changes, update the allowlist entry. Prefer the exact service URL over a platform-wide wildcard.

The repository does not contain the current AI Studio preview hostname or Cloud Run service URL, so those two values must be copied from their respective consoles rather than guessed.

## 2. Enable Google as a Supabase provider

1. In Supabase, open **Authentication → Providers → Google**.
2. Enable Google.
3. Create or select the Google OAuth 2.0 **Web application** client in Google Cloud Console.
4. Copy the Google **Client ID** and **Client Secret** into the matching Supabase provider fields, then save.
5. Keep the client secret in Supabase only. Never add it to `.env.example`, browser code, GitHub, or a `VITE_*` variable.

## 3. Configure Google Cloud Console

In [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials), open the OAuth 2.0 Client ID used by Supabase:

- **Application type:** Web application.
- **Authorized redirect URIs:** add exactly `https://dqgjbmpvwsoxhatadbdw.supabase.co/auth/v1/callback`.
- **Authorized JavaScript origins:** add `https://kinvai.arkvoid.com`. Add `http://localhost:3000` only for local testing. Add an AI Studio or Cloud Run origin only when that exact origin is being used.

On the OAuth consent screen, set the app name and support/developer contact details, configure basic OpenID profile and email scopes, and publish or add test users as required by the Google project's audience settings.

## 4. Client behavior in Kinvai

`src/lib/supabase/client.ts` uses `@supabase/supabase-js` with:

- `flowType: 'pkce'`
- `persistSession: true`
- `autoRefreshToken: true`
- `detectSessionInUrl: true`

The callback route waits for the singleton client's URL/session initialization and validates the `next` path as a same-origin relative path before redirecting. Protected account and checkout routes wait for auth boot before opening the sign-in sheet.

## 5. Verify configuration

1. Open `https://kinvai.arkvoid.com/account?tab=library` in a normal browser tab.
2. Complete **Sign in with Google** and confirm the browser returns to the same account tab.
3. Refresh the page and close/reopen the browser; the account should remain signed in while the Supabase session is valid.
4. Open `/checkout` while signed out; confirm the sign-in sheet appears and returns to `/checkout` after sign-in.
5. Sign out using the account confirmation dialog, then confirm protected routes request sign-in again.

If the provider reports a redirect mismatch, compare the exact origin and path in the browser address bar with the Supabase Redirect URLs allowlist and verify that Google's authorized redirect URI is the Supabase `/auth/v1/callback` value above.
