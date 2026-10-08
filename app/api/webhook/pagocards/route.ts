/**
 * Pagocards webhook — App Router shape (documentation / future Next hosting).
 *
 * IMPORTANT: Production on Vercel rewrites `/api/*` to Express (`api/index.js`).
 * Do not rely on this file as the live handler. Live path:
 *   POST /api/webhook/pagocards  →  backend/src/routes/webhook.js
 *
 * This module avoids ESM `import` of runtime helpers so a mistaken raw load
 * cannot surface "Unexpected token 'export'" from lib/pagocardsWebhook.ts.
 */

import { createRequire } from 'node:module';
import path from 'node:path';

// Resolve from repo root so this works whether Next compiles ESM or CJS.
const require = createRequire(path.join(process.cwd(), 'package.json'));

type PersistResult = {
  saved: boolean;
  duplicate?: boolean;
  id?: number | string | null;
  reason?: string;
};

function loadNormalizer(): {
  normalizePagocardsWebhook: (body: unknown) => {
    eventId: string;
    eventType: string;
    authId: string | null;
    otp: string | null;
    cardId: string | null;
    is3ds: boolean;
  } | null;
  summarizePagocardsEvent: (event: {
    eventType: string;
    otp: string | null;
    cardId: string | null;
    merchantName?: string | null;
    transactionAmount?: string | null;
    transactionCurrency?: string | null;
    authId?: string | null;
    is3ds?: boolean;
  }) => string;
} {
  // Plain CommonJS — safe on Vercel/Node without strip-types / ESM export.
  return require(path.join(process.cwd(), 'lib/pagocardsWebhook.js'));
}

async function tryPersist(rawBody: unknown): Promise<PersistResult> {
  try {
    const service = require(path.join(process.cwd(), 'backend/src/services/pago3dsWebhookService.js'));
    if (service && typeof service.handlePagocardsWebhook === 'function') {
      const result = await service.handlePagocardsWebhook(rawBody);
      return {
        saved: Boolean(result?.saved ?? result?.row),
        duplicate: Boolean(result?.duplicate),
        id: result?.row?.id ?? result?.id ?? null,
      };
    }
  } catch {
    // Backend service unavailable in a pure Next runtime — fall through to log-only.
  }
  return { saved: false, reason: 'express_persist_unavailable' };
}

function verifyOptionalSecret(request: Request): Response | null {
  const expected = String(process.env.PAGO_CARD_WEBHOOK_SECRET || '').trim();
  if (!expected) return null;
  const header =
    request.headers.get('x-pago-webhook-secret')
    || request.headers.get('x-pagocards-secret')
    || request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    || '';
  if (header !== expected) {
    return Response.json(
      { ok: false, error: 'Invalid webhook secret', code: 'PAGO_WEBHOOK_UNAUTHORIZED' },
      { status: 401 }
    );
  }
  return null;
}

export async function POST(request: Request): Promise<Response> {
  const authError = verifyOptionalSecret(request);
  if (authError) return authError;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { ok: false, error: 'Invalid JSON body', code: 'INVALID_JSON' },
      { status: 400 }
    );
  }

  const { normalizePagocardsWebhook, summarizePagocardsEvent } = loadNormalizer();
  const event = normalizePagocardsWebhook(body);
  if (!event) {
    console.warn('[webhook/pagocards] unrecognized payload', {
      keys: body && typeof body === 'object' ? Object.keys(body as object) : [],
    });
    return Response.json({ ok: true, received: true, ignored: true });
  }

  console.log('[webhook/pagocards]', summarizePagocardsEvent(event), {
    eventId: event.eventId,
    authId: event.authId,
    is3ds: event.is3ds,
  });

  const persist = await tryPersist(body);

  return Response.json({
    ok: true,
    received: true,
    eventId: event.eventId,
    eventType: event.eventType,
    is3ds: event.is3ds,
    hasOtp: Boolean(event.otp),
    otp: event.otp,
    cardId: event.cardId,
    saved: persist.saved,
    duplicate: persist.duplicate || false,
    id: persist.id ?? null,
  });
}

export async function GET(): Promise<Response> {
  return Response.json({
    ok: true,
    service: 'pagocards-webhook',
    accepts: ['3ds'],
    path: '/api/webhook/pagocards',
  });
}
