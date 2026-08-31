/**
 * POST /api/cards/issue
 * Real-time Kripicard creation with profit markup on user purchases.
 *
 * User session: debits USDT wallet (card load + admin markup), sends only
 * card load to Kripicard, records markup in platform_fee_events.
 *
 * Admin (X-Admin-Key): direct provider issue without wallet debit (legacy ops).
 *
 * Calls: POST https://appapi.kripicard.com/api/external/cards/createcard
 * Body to provider: { api_key, name_on_card, bin, amount }
 * Persists result to Supabase user_cards linked to the buyer.
 *
 * Auth (one of):
 *   - Authorization: Bearer <session token>
 *   - X-Admin-Key + body.user_id
 *
 * Request JSON:
 *   {
 *     user_id?: string|number,       // required for admin auth
 *     name_on_card: string,          // min 2 chars
 *     bin: string|number,            // chosen BIN
 *     amount: number,                // initial card load (Kripicard cost, not total charge)
 *     initial_load_usd?: number,     // alias for amount
 *     currency?: string,             // USD or USDT only (MMK rejected)
 *     payment_ref?: string,          // optional idempotency / payment id
 *     idempotency_key?: string,
 *     metadata?: object
 *   }
 */
import { createRequire } from 'node:module';
import { NextResponse } from 'next/server';

const require = createRequire(import.meta.url);
const { issueCardForUser, publicUserCard } = require('../../../../lib/cardIssue');
const { isSupabaseAdminEnabled } = require('../../../../lib/supabaseAdmin');
const { purchaseCardFromUsdtWallet } = require('../../../../backend/src/services/cardWalletService');
const { formatUsdt } = require('../../../../backend/src/services/walletService');

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
    const UserSession = require('../../../../backend/src/models/UserSession');
    const session = await UserSession.findByToken(token);
    if (!session || !session.user_id) return null;
    return session.user_id;
  } catch (err) {
    console.warn('[api/cards/issue] session lookup unavailable:', err.message);
    return null;
  }
}

function mapPurchaseError(err) {
  const code = err && err.code;
  const message = (err && err.message) || 'Unexpected error';

  if (code === 'INSUFFICIENT_USDT_BALANCE') {
    return {
      status: 400,
      body: {
        error: message,
        code,
        required_usdt: err.required_usdt,
        available_usdt: err.available_usdt,
      },
    };
  }
  if (
    code === 'USER_REQUIRED'
    || code === 'INVALID_NAME_ON_CARD'
    || code === 'INVALID_BIN'
    || code === 'INVALID_AMOUNT'
    || code === 'USDT_ONLY_CARD_ISSUANCE'
  ) {
    return { status: 400, body: { error: message, code, errors: err.errors } };
  }
  if (code === 'KRIPICARD_NOT_CONFIGURED' || code === 'SUPABASE_NOT_CONFIGURED') {
    return { status: 503, body: { error: message, code } };
  }
  if (
    code === 'KRIPICARD_HTTP_ERROR'
    || code === 'KRIPICARD_API_ERROR'
    || code === 'KRIPICARD_TIMEOUT'
    || code === 'KRIPICARD_BAD_RESPONSE'
    || code === 'KRIPICARD_MISSING_CARD_ID'
  ) {
    return {
      status: 502,
      body: {
        error: message,
        code,
        provider_status: err.status,
        refunded: !err.refund_failed,
      },
    };
  }
  if (code === 'USER_CARD_STORE_FAILED') {
    return { status: 500, body: { error: message, code } };
  }
  if (
    message.includes('Minimum initial deposit')
    || message.includes('must be')
    || message.includes('pending')
  ) {
    return { status: 400, body: { error: message, code } };
  }
  return { status: 500, body: { error: message, code: code || 'INTERNAL_ERROR' } };
}

function mapAdminIssueError(err) {
  const code = err && err.code;
  const message = (err && err.message) || 'Unexpected error';
  const errors = err && err.errors;

  if (
    code === 'USER_REQUIRED'
    || code === 'INVALID_NAME_ON_CARD'
    || code === 'INVALID_BIN'
    || code === 'INVALID_AMOUNT'
  ) {
    return { status: 400, body: { error: message, code, errors } };
  }
  if (code === 'KRIPICARD_NOT_CONFIGURED' || code === 'SUPABASE_NOT_CONFIGURED') {
    return { status: 503, body: { error: message, code } };
  }
  if (
    code === 'KRIPICARD_HTTP_ERROR'
    || code === 'KRIPICARD_API_ERROR'
    || code === 'KRIPICARD_TIMEOUT'
    || code === 'KRIPICARD_BAD_RESPONSE'
    || code === 'KRIPICARD_MISSING_CARD_ID'
  ) {
    return {
      status: 502,
      body: {
        error: message,
        code,
        provider_status: err.status,
      },
    };
  }
  if (code === 'USER_CARD_STORE_FAILED') {
    return { status: 500, body: { error: message, code } };
  }
  return { status: 500, body: { error: message, code: code || 'INTERNAL_ERROR' } };
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

    if (!String(process.env.KRIPICARD_API_KEY || '').trim()) {
      return json(
        { error: 'KRIPICARD_API_KEY is not configured', code: 'KRIPICARD_NOT_CONFIGURED' },
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
        return json({ error: 'Authentication required', code: 'AUTH_REQUIRED' }, 401);
      }
      const sessionUserId = await resolveUserIdFromSession(token);
      if (!sessionUserId) {
        if (userId == null) {
          return json({ error: 'Invalid or expired session', code: 'SESSION_INVALID' }, 401);
        }
      } else {
        userId = sessionUserId;
      }
    }

    if (isAdmin) {
      const result = await issueCardForUser({
        userId,
        nameOnCard: body.name_on_card || body.cardholder_name || body.cardHolderName,
        bin: body.bin ?? body.bank_bin ?? body.bankBin,
        amount: body.amount ?? body.purchase_amount ?? body.initial_amount ?? body.initial_load_usd,
        currency: body.currency || body.purchase_currency || 'USD',
        paymentRef: body.payment_ref || body.paymentRef || body.deposit_id || null,
        idempotencyKey: body.idempotency_key || body.idempotencyKey || null,
        metadata: {
          ...(body.metadata && typeof body.metadata === 'object' ? body.metadata : {}),
          source: 'api/cards/issue',
          issued_via: 'admin',
        },
      });

      return json({
        success: true,
        message: result.reused
          ? 'Card already issued for this payment'
          : 'Card issued successfully',
        reused: Boolean(result.reused),
        card: publicUserCard(result.user_card),
      });
    }

    const User = require('../../../../backend/src/models/User');
    const user = await User.findById(userId);
    const initialLoadUsd = parseFloat(
      body.initial_load_usd ?? body.amount ?? body.purchase_amount ?? body.initial_amount
    );

    const result = await purchaseCardFromUsdtWallet(userId, {
      initialLoadUsd,
      cardHolderName: body.name_on_card || body.cardholder_name || body.cardHolderName || user?.name,
      note: body.note,
      bin: body.bin ?? body.bank_bin ?? body.bankBin,
      paymentRef: body.payment_ref || body.paymentRef || body.idempotency_key || body.idempotencyKey || null,
    });

    return json({
      success: true,
      paid_from_wallet: true,
      pending: Boolean(result.pending),
      issued: Boolean(result.issued),
      wallet_type: 'usdt',
      message: result.message,
      card: result.card,
      card_request_id: result.card?.id,
      provider_card_id: result.provider_card_id || null,
      bin: result.bin || null,
      pricing_breakdown: {
        ...result.pricing,
        payment_method: 'USDT Wallet',
      },
      wallet: {
        debited_usdt: result.wallet_debit_usdt,
        balance_usdt: result.balance_usdt,
        usdt_formatted: formatUsdt(result.balance_usdt),
      },
    });
  } catch (err) {
    console.error('[api/cards/issue]', err);
    const adminKey = configuredAdminKey();
    const providedAdminKey = String(request.headers.get('x-admin-key') || '').trim();
    const isAdmin = Boolean(adminKey) && providedAdminKey === adminKey;
    const mapped = isAdmin ? mapAdminIssueError(err) : mapPurchaseError(err);
    return json(mapped.body, mapped.status);
  }
}
