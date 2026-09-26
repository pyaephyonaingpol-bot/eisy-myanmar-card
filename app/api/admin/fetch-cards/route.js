/**
 * POST /api/admin/fetch-cards
 * Look up a Bitnob virtual card by provider card_id.
 * Pool sync has been retired — cards are issued on-demand via Bitnob.
 *
 * Auth: X-Admin-Key: <ADMIN_API_KEY>
 * Env:  BITNOB_CLIENT_ID, BITNOB_CLIENT_SECRET, SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_URL
 *
 * Body: { card_id: string }  — without card_id returns 410 BITNOB_ON_DEMAND_ONLY
 */
import { createRequire } from 'node:module';
import { NextResponse } from 'next/server';

const require = createRequire(import.meta.url);
const { getCardDetails } = require('../../../../lib/bitnob');
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

function isBitnobConfigured() {
  const clientId = String(process.env.BITNOB_CLIENT_ID || '').trim();
  const clientSecret = String(
    process.env.BITNOB_CLIENT_SECRET || process.env.BITNOB_SECRET_KEY || ''
  ).trim();
  return Boolean(clientId && clientSecret && !clientSecret.includes('...'));
}

function mapError(err) {
  const code = err && err.code;
  const message = (err && err.message) || 'Unexpected error';

  if (code === 'BITNOB_NOT_CONFIGURED' || code === 'SUPABASE_NOT_CONFIGURED') {
    return { status: 503, body: { error: message, code } };
  }
  if (code === 'BITNOB_CARD_ID_REQUIRED') {
    return { status: 400, body: { error: message, code } };
  }
  if (code === 'BITNOB_HTTP_ERROR') {
    return {
      status: 502,
      body: { error: message, code, provider_status: err.status },
    };
  }
  if (
    code === 'BITNOB_TIMEOUT'
    || code === 'BITNOB_BAD_RESPONSE'
    || code === 'BITNOB_API_ERROR'
    || code === 'BITNOB_NETWORK'
  ) {
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

    if (!isBitnobConfigured()) {
      return json(
        {
          error: 'Bitnob API credentials are not configured (BITNOB_CLIENT_ID / BITNOB_CLIENT_SECRET)',
          code: 'BITNOB_NOT_CONFIGURED',
        },
        503
      );
    }

    let body = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const cardId = String(body?.card_id || body?.cardId || '').trim();
    if (!cardId) {
      return json(
        {
          error:
            'Pool sync has been removed. Provide card_id to look up a Bitnob card, or issue on-demand via /api/cards/issue.',
          code: 'BITNOB_ON_DEMAND_ONLY',
        },
        410
      );
    }

    const result = await getCardDetails(cardId);
    return json({
      success: true,
      message: 'Bitnob card details retrieved',
      provider: 'bitnob',
      card: result.card,
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

    return json(
      {
        error:
          'Card pool inventory is retired. Cards are issued on-demand via Bitnob. Use POST with card_id to look up a card.',
        code: 'BITNOB_ON_DEMAND_ONLY',
        provider: 'bitnob',
      },
      410
    );
  } catch (err) {
    console.error('[api/admin/fetch-cards GET]', err);
    const mapped = mapError(err);
    return json(mapped.body, mapped.status);
  }
}
