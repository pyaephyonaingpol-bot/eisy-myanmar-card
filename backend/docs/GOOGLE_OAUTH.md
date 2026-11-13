# Google Sign-In (Supabase Auth)

## Symptom

Browser shows: `Unable to exchange external code: 4/0A…`

That message comes from **Supabase GoTrue** when it cannot redeem Google's
authorization code (redirect_uri / client mismatch), not from our Express app.

## Correct URL wiring

| Place | Value |
|-------|--------|
| Google Cloud → OAuth client → **Authorized redirect URIs** | `https://<PROJECT_REF>.supabase.co/auth/v1/callback` only |
| Google Cloud → **Authorized JavaScript origins** | `https://eisymyanmar.com`, `http://localhost:3000` (optional for local) |
| Supabase → Authentication → Providers → Google | Same Google **Client ID** + **Client Secret** |
| Supabase → Authentication → URL Configuration → **Site URL** | `https://eisymyanmar.com` |
| Supabase → **Redirect URLs** | `https://eisymyanmar.com/auth/callback`, `https://eisymyanmar.com/**` |
| App `signInWithOAuth` `redirectTo` | `${origin}/auth/callback` (already in `auth.js` / `supabaseService.js`) |
| Vercel `NEXT_PUBLIC_SUPABASE_URL` | Bare `https://<PROJECT_REF>.supabase.co` (upstream) |
| Browser client URL (optional proxy) | `https://eisymyanmar.com/supabase` via `/api/config/supabase` |

### What must stay on `*.supabase.co`

Google → Supabase callback:

`https://<PROJECT_REF>.supabase.co/auth/v1/callback`

Do **not** put `https://eisymyanmar.com/supabase/auth/v1/callback` in Google Cloud.
GoTrue always exchanges the code with the project callback URL; a rewritten
`redirect_uri` makes Google issue a code that GoTrue cannot redeem.

### What stays on your domain

After Supabase finishes, the user returns to:

`https://eisymyanmar.com/auth/callback?code=…`

The SPA calls `exchangeCodeForSession(code)` then `POST /api/auth/oauth/google`.

## Same-origin `/supabase` proxy

The proxy may forward Auth/REST requests so the browser talks to
`eisymyanmar.com/supabase`. It must:

- **Not** rewrite Google `redirect_uri` query params
- **Not** send the site hostname as `X-Forwarded-Host` to GoTrue
- Leave `/auth/v1/callback` Location headers on `*.supabase.co`

Disable the proxy if needed: `SUPABASE_BROWSER_PROXY=false`.

## Checklist after changing Google / Supabase settings

1. Confirm Google redirect URI is exactly the Supabase callback (copy from
   Supabase → Authentication → Providers → Google).
2. Confirm Client ID/Secret in Supabase match that Google OAuth client.
3. Confirm Redirect URLs include `https://eisymyanmar.com/auth/callback`.
4. Hard-refresh the app (or bump cache) and try Google Sign-In again in a private window.
