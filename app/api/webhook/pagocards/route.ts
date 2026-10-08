/**
 * Pagocards webhook — App Router shape.
 *
 * Receives 3DS OTP / card event payloads from Pagocards, extracts verification
 * codes, and acknowledges with 2xx. In this monorepo production traffic is
 * rewritten to Express (`/api/webhook/pagocards`), which persists events for
 * the dashboard UI. This route mirrors the same contract for Next.js tooling
 * and future App Router hosting.
 *
 * Register in Pagocards: https://YOUR_DOMAIN/api/webhook/pagocards
 *
 * Example 3DS payload:
 * {
 *   "eventId": "...",
 *   "eventType": "3ds",
 *   "otp": "234562",
 *   "authId": "...",
 *   "cardid": "card_...",
 *   "merchantName": "MYPAL",
 *   "transactionAmount": "10",
 *   "transactionCurrency": "USD"
 * }
 */

import {
  normalizePagocardsWebhook,
  summarizePagocardsEvent,
  type Pagocards3dsEvent,
} from '../../../../lib/pagocardsWebhook';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type PersistResult = {
  saved: boolean;
  duplicate?: boolean;
  id?: number | string | null;
  reason?: string;
};

async function tryPersist(event: Pagocards3dsEvent, rawBody: unknown): Promise<PersistResult> {
  try {
    // Prefer the Express service when this process is the backend (strip-types / CJS bridge).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const service = require('../../../../backend/src/services/pago3dsWebhookService');
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

  const event = normalizePagocardsWebhook(body);
  if (!event) {
    console.warn('[webhook/pagocards] unrecognized payload', {
      keys: body && typeof body === 'object' ? Object.keys(body as object) : [],
    });
    // ACK unknown shapes so Pagocards does not retry forever on schema drift.
    return Response.json({ ok: true, received: true, ignored: true });
  }

  console.log('[webhook/pagocards]', summarizePagocardsEvent(event), {
    eventId: event.eventId,
    authId: event.authId,
    is3ds: event.is3ds,
  });

  const persist = await tryPersist(event, body);

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

/** Health / config probe for webhook URL verification. */
export async function GET(): Promise<Response> {
  return Response.json({
    ok: true,
    service: 'pagocards-webhook',
    accepts: ['3ds'],
    path: '/api/webhook/pagocards',
  });
}
