/**
 * Pagocards webhook payload helpers (3DS OTP / card status).
 *
 * Runtime exports use CommonJS `module.exports` (same pattern as lib/pagocard.ts).
 * The implementation is lib/pagocardsWebhook.cjs. This file assigns that
 * exports object directly — it must not wrap calls as `impl.fn()`, because a
 * circular alias left `impl` empty and threw
 * "impl.normalizePagocardsWebhook is not a function".
 *
 * Docs: https://pagocards.com/documentation
 */

export type Pagocards3dsEvent = {
  eventId: string;
  eventType: string;
  authId: string | null;
  otp: string | null;
  cardId: string | null;
  merchantName: string | null;
  transactionAmount: string | null;
  transactionCurrency: string | null;
  verificationType: string | null;
  userBankcardId: string | null;
  cardStatus: string | null;
  localStatus: string | null;
  is3ds: boolean;
  raw: Record<string, unknown>;
};

type WebhookLib = {
  unwrapWebhookBody: (body: unknown) => unknown;
  normalizePagocardsWebhook: (body: unknown) => Pagocards3dsEvent | null;
  summarizePagocardsEvent: (event: Pagocards3dsEvent) => string;
  collect3dsOtps: (payload: unknown, fallbackCardId?: string | null) => Pagocards3dsEvent[];
  mapWebhookCardStatus: (rawStatus: unknown, eventType?: unknown) => string | null;
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const loaded = require('./pagocardsWebhook.cjs') as WebhookLib & { default?: WebhookLib };

const resolved: WebhookLib | null =
  loaded && typeof loaded.normalizePagocardsWebhook === 'function'
    ? loaded
    : loaded && loaded.default && typeof loaded.default.normalizePagocardsWebhook === 'function'
      ? loaded.default
      : null;

if (!resolved || typeof resolved.normalizePagocardsWebhook !== 'function') {
  throw new Error('pagocardsWebhook.cjs did not export normalizePagocardsWebhook');
}

module.exports = resolved;
