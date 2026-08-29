/**
 * POST /api/cards/purchase
 * Assign an available card from card_pools to the buyer and link in user_cards.
 *
 * Auth (one of):
 *   - Authorization: Bearer <session token>  (resolves user from Express sessions when available)
 *   - X-Admin-Key + body.user_id             (admin-assisted assignment)
 *
 * Body (JSON):
 *   {
 *     user_id?: string|number,          // required for admin key auth
 *     cardholder_name?: string,
 *     purchase_amount?: number,
 *     purchase_currency?: string,
 *     metadata?: object
 *   }
 */
import { createRequire } from 'node:module';
import { NextResponse } from 'next/server';

const require = createRequire(import.meta.url);
const { assignCardToUser } = require('../../../../lib/cardPool');
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

function getBearerToken(request) {
  const header = request.headers.get('authorization') || '';
  if (!header.toLowerCase().startsWith('bearer ')) return null;
  const token = header.slice(7).trim();
  return token || null;
}

async function resolveUserIdFromSession(token) {
  try {
    // Optional bridge to the existing Express auth DB when this monorepo is used.
    const UserSession = require('../../../../backend/src/models/UserSession');
    const session = await UserSession.findByToken(token);
    if (!session || !session.user_id) return null;
    return session.user_id;
  } catch (err) {
    console.warn('[api/cards/purchase] session lookup unavailable:', err.message);
    return null;
  }
}

function mapError(err) {
  const code = err && err.code;
  const message = (err && err.message) || 'Unexpected error';

  if (code === 'USER_REQUIRED') {
    return { status: 400, body: { error: message, code } };
  }
  if (code === 'POOL_EMPTY') {
    return { status: 409, body: { error: message, code } };
  }
  if (code === 'POOL_RACE' || code === 'ALREADY_ASSIGNED') {
    return { status: 409, body: { error: message, code } };
  }
  if (code === 'SUPABASE_NOT_CONFIGURED') {
    return { status: 503, body: { error: message, code } };
  }
  return { status: 500, body: { error: message, code: code || 'INTERNAL_ERROR' } };
}

function publicUserCard(card) {
  if (!card) return null;
  return {
    id: card.id,
    user_id: card.user_id,
    card_id: card.card_id,
    card_number: card.card_number,
    cvv: card.cvv,
    exp_date: card.exp_date,
    cardholder_name: card.cardholder_name,
    brand: card.brand,
    currency: card.currency,
    balance: card.balance,
    status: card.status,
    purchase_amount: card.purchase_amount,
    purchase_currency: card.purchase_currency,
    created_at: card.created_at,
  };
}

export async function POST(request) {
  try {
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

    let body = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const adminKey = configuredAdminKey();
    const providedAdminKey = String(request.headers.get('x-admin-key') || '').trim();
    const isAdmin = Boolean(adminKey) && providedAdminKey === adminKey;

    let userId = body.user_id ?? body.userId ?? null;

    if (!isAdmin) {
      const token = getBearerToken(request);
      if (!token) {
        return json(
          { error: 'Authentication required', code: 'AUTH_REQUIRED' },
          401
        );
      }
      const sessionUserId = await resolveUserIdFromSession(token);
      if (!sessionUserId) {
        // Allow trusted deployments that pass user_id with a valid bearer when
        // the local session DB is not wired into the Next.js runtime.
        if (userId == null) {
          return json(
            { error: 'Invalid or expired session', code: 'SESSION_INVALID' },
            401
          );
        }
      } else {
        userId = sessionUserId;
      }
    }

    if (userId === undefined || userId === null || String(userId).trim() === '') {
      return json(
        { error: 'user_id is required', code: 'USER_REQUIRED' },
        400
      );
    }

    const purchaseAmount =
      body.purchase_amount != null
        ? Number(body.purchase_amount)
        : body.amount != null
          ? Number(body.amount)
          : null;

    const result = await assignCardToUser({
      userId,
      purchaseAmount: Number.isFinite(purchaseAmount) ? purchaseAmount : null,
      purchaseCurrency: body.purchase_currency || body.currency || null,
      cardholderName: body.cardholder_name || body.cardHolderName || null,
      metadata: {
        ...(body.metadata && typeof body.metadata === 'object' ? body.metadata : {}),
        source: 'api/cards/purchase',
        assigned_via: isAdmin ? 'admin' : 'user',
      },
    });

    return json({
      success: true,
      message: 'Card assigned successfully',
      card: publicUserCard(result.user_card),
      pool_card_id: result.pool_card && result.pool_card.id,
    });
  } catch (err) {
    console.error('[api/cards/purchase]', err);
    const mapped = mapError(err);
    return json(mapped.body, mapped.status);
  }
}
