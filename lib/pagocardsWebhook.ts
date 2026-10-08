/**
 * Pagocards webhook payload helpers (3DS OTP / card events).
 *
 * Runtime exports use CommonJS `module.exports` (same pattern as lib/pagocard.ts)
 * so Express can load this via strip-types without "Unexpected token 'export'".
 * Prefer requiring lib/pagocardsWebhook.js in Node/Express.
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
  is3ds: boolean;
  raw: Record<string, unknown>;
};

// Re-export the CommonJS implementation for typed tooling / strip-types loaders.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const impl = require('./pagocardsWebhook.js') as {
  unwrapWebhookBody: (body: unknown) => unknown;
  normalizePagocardsWebhook: (body: unknown) => Pagocards3dsEvent | null;
  summarizePagocardsEvent: (event: Pagocards3dsEvent) => string;
  collect3dsOtps: (payload: unknown, fallbackCardId?: string | null) => Pagocards3dsEvent[];
};

function unwrapWebhookBody(body: unknown): unknown {
  return impl.unwrapWebhookBody(body);
}

function normalizePagocardsWebhook(body: unknown): Pagocards3dsEvent | null {
  return impl.normalizePagocardsWebhook(body);
}

function summarizePagocardsEvent(event: Pagocards3dsEvent): string {
  return impl.summarizePagocardsEvent(event);
}

function collect3dsOtps(payload: unknown, fallbackCardId?: string | null): Pagocards3dsEvent[] {
  return impl.collect3dsOtps(payload, fallbackCardId);
}

module.exports = {
  unwrapWebhookBody,
  normalizePagocardsWebhook,
  summarizePagocardsEvent,
  collect3dsOtps,
};
