/**
 * Read a Supabase PKCE callback.
 * supabase-js 2.112 exchangeCodeForSession() takes the raw `code` query
 * value. Passing the full callback URL is sent as auth_code and the
 * exchange fails.
 */
export function readGoogleOAuthCallback(href) {
  const url = new URL(String(href || ''), 'https://eisymyanmar.com');
  const code = url.searchParams.get('code') || '';
  const flowId = url.searchParams.get('sb_flow_id') || '';
  const errorMessage = url.searchParams.get('error_description') || url.searchParams.get('error') || '';
  return { code, flowId, errorMessage };
}

export function pkceExchangeArgs(callback) {
  const code = String(callback?.code || '');
  const flowId = String(callback?.flowId || '');
  if (!code) return null;
  return [code, flowId ? { flowId } : undefined];
}
