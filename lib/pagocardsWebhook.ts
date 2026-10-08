/**
 * Pagocards webhook payload helpers (3DS OTP / card events).
 *
 * Docs: https://pagocards.com/documentation — 3DS events are forwarded to the
 * configured webhook URL. Deduplicate with `eventId` and ACK with 2xx promptly.
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
  /** True when this payload is a 3DS verification / OTP event. */
  is3ds: boolean;
  raw: Record<string, unknown>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function pickString(...candidates: unknown[]): string | null {
  for (const candidate of candidates) {
    if (candidate == null) continue;
    const text = String(candidate).trim();
    if (text) return text;
  }
  return null;
}

/**
 * Normalize flat Pagocards 3DS payloads and the nested `{ type, data }` shape.
 */
export function normalizePagocardsWebhook(body: unknown): Pagocards3dsEvent | null {
  const root = asRecord(body);
  if (!root) return null;

  const nested = asRecord(root.data) || asRecord(root.payload) || null;
  const cardObj = nested ? asRecord(nested.card) : null;
  const amountObj = nested ? asRecord(nested.amount) : null;
  const merchantObj = nested ? asRecord(nested.merchant) : null;

  const eventType = pickString(
    root.eventType,
    root.event_type,
    root.type,
    nested?.eventType,
    nested?.type
  ) || 'unknown';

  const eventId = pickString(
    root.eventId,
    root.event_id,
    root.id,
    nested?.eventId,
    nested?.id,
    nested?.authId,
    root.authId
  );

  if (!eventId) return null;

  const otp = pickString(root.otp, nested?.otp, root.code, nested?.code);
  const authId = pickString(root.authId, root.auth_id, nested?.authId, nested?.id);
  const cardId = pickString(
    root.cardid,
    root.cardId,
    root.card_id,
    nested?.cardid,
    nested?.cardId,
    nested?.card_id,
    cardObj?.cardId,
    cardObj?.cardid,
    cardObj?.id
  );

  const is3ds =
    /^3ds$/i.test(eventType)
    || /3ds/i.test(eventType)
    || Boolean(otp && authId);

  return {
    eventId,
    eventType,
    authId,
    otp,
    cardId,
    merchantName: pickString(
      root.merchantName,
      root.merchant_name,
      nested?.merchantName,
      merchantObj?.name
    ),
    transactionAmount: pickString(
      root.transactionAmount,
      root.transaction_amount,
      nested?.transactionAmount,
      amountObj?.amount,
      nested?.amount
    ),
    transactionCurrency: pickString(
      root.transactionCurrency,
      root.transaction_currency,
      nested?.transactionCurrency,
      amountObj?.currency,
      nested?.currency
    ),
    verificationType: pickString(
      root.verificationType,
      root.verification_type,
      nested?.verificationType
    ),
    userBankcardId: pickString(
      root.userBankcardId,
      root.user_bankcard_id,
      nested?.userBankcardId
    ),
    is3ds,
    raw: root,
  };
}

export function summarizePagocardsEvent(event: Pagocards3dsEvent): string {
  const parts = [
    event.eventType,
    event.otp ? `otp=${event.otp}` : null,
    event.cardId ? `card=${event.cardId}` : null,
    event.merchantName ? `merchant=${event.merchantName}` : null,
    event.transactionAmount
      ? `amount=${event.transactionAmount}${event.transactionCurrency ? ` ${event.transactionCurrency}` : ''}`
      : null,
  ].filter(Boolean);
  return parts.join(' ');
}
