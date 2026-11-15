import { NextRequest, NextResponse } from 'next/server';

/**
 * Google OAuth callback — App Router shape (documentation / future Next hosting).
 *
 * IMPORTANT: Production on Vercel rewrites non-file paths to Express (`api/index.js`),
 * which serves the SPA at `GET /auth/callback` (`backend/src/index.js`). The live
 * PKCE exchange + app session handoff runs in the browser
 * (`Auth.completeGoogleOAuth` → `SupabaseBridge.getOAuthAccessToken`).
 *
 * Do not rely on this file as the live handler. If Next ever hosts this path,
 * preserve the OAuth query string and send the browser to the SPA callback.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl.clone();
  url.pathname = '/auth/callback';
  // Keep code / error / sb_flow_id for the SPA PKCE exchange.
  return NextResponse.redirect(url, 307);
}
