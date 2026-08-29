/**
 * POST /api/admin/fetch-cards
 * Securely fetch pre-issued Kripicard virtual cards and upsert into card_pools.
 *
 * Auth: X-Admin-Key: <ADMIN_API_KEY>
 * Env:  KRIPICARD_API_KEY, SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_URL
 */
import { createRequire } from 'node:module';
import { NextResponse } from 'next/server';

const require = createRequire(import.meta.url);
const {
  fetchAndStorePoolCards,
  getPoolStats,
} = require('../../../../lib/cardPool');
const { isSupabaseAdminEnabled } = require('../../../../lib/supabaseAdmin');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function json(body, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function configuredAdminKey() {
  return String(process.env.ADMIN_API_KEY || '').trim();
}

function isAuthorizedAdmin(request) {
  const adminKey = configuredAdminKey();
  if (!adminKey) return false;
  const provided = String(request.headers.get('x-admin-key') || '').trim();
  return Boolean(provided) && provided === adminKey;
}

function mapError(err) {
  const code = err && err.code;
  const message = (err && err.message) || 'Unexpected error';

  if (code === 'KRIPICARD_NOT_CONFIGURED' || code === 'SUPABASE_NOT_CONFIGURED') {
    return { status: 503, body: { error: message, code } };
  }
  if (code === 'KRIPICARD_HTTP_ERROR') {
    return {
      status: 502,
      body: { error: message, code, provider_status: err.status },
    };
  }
  if (code === 'KRIPICARD_TIMEOUT' || code === 'KRIPICARD_BAD_RESPONSE') {
    return { status: 502, body: { error: message, code } };
  }
  return { status: 500, body: { error: message, code: code || 'INTERNAL_ERROR' } };
}

export async function POST(request) {
  try {
    if (!isAuthorizedAdmin(request)) {
      return json(
        { error: 'Valid admin key required', code: 'ADMIN_REQUIRED' },
        403
      );
    }

    if (!isSupabaseAdminEnabled()) {
      return json(
        {
          error:
            'Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
          code: 'SUPABASE_NOT_CONFIGURED',
        },
        503
      );
    }

    if (!String(process.env.KRIPICARD_API_KEY || '').trim()) {
      return json(
        { error: 'KRIPICARD_API_KEY is not configured', code: 'KRIPICARD_NOT_CONFIGURED' },
        503
      );
    }

    let query = {};
    try {
      const body = await request.json();
      if (body && typeof body === 'object') {
        query = body.query && typeof body.query === 'object' ? body.query : {};
        if (body.status) query.status = body.status;
        if (body.limit) query.limit = body.limit;
      }
    } catch {
      // empty body is fine
    }

    const result = await fetchAndStorePoolCards({ query });
    let pool = null;
    try {
      pool = await getPoolStats();
    } catch {
      pool = null;
    }

    return json({
      success: true,
      message: `Synced ${result.upserted} card(s) into pool (${result.inserted} new, ${result.updated} updated)`,
      ...result,
      pool,
    });
  } catch (err) {
    console.error('[api/admin/fetch-cards]', err);
    const mapped = mapError(err);
    return json(mapped.body, mapped.status);
  }
}

export async function GET(request) {
  try {
    if (!isAuthorizedAdmin(request)) {
      return json(
        { error: 'Valid admin key required', code: 'ADMIN_REQUIRED' },
        403
      );
    }

    if (!isSupabaseAdminEnabled()) {
      return json(
        {
          error: 'Supabase is not configured',
          code: 'SUPABASE_NOT_CONFIGURED',
        },
        503
      );
    }

    const pool = await getPoolStats();
    return json({ success: true, pool });
  } catch (err) {
    console.error('[api/admin/fetch-cards GET]', err);
    const mapped = mapError(err);
    return json(mapped.body, mapped.status);
  }
}
