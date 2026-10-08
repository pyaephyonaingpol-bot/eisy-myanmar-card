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
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return String(candidate);
    }
    const text = String(candidate).trim();
    if (text) return text;
  }
  return null;
}

/** Prefer values that look like short numeric OTPs (4–8 digits). */
function pickOtp(...candidates: unknown[]): string | null {
  const strings = candidates
    .map((c) => (c == null ? null : String(c).trim()))
    .filter(Boolean) as string[];
  const numeric = strings.find((s) => /^\d{4,8}$/.test(s));
  if (numeric) return numeric;
  return strings[0] || null;
}

function deepPick(obj: Record<string, unknown> | null, keys: string[]): unknown[] {
  if (!obj) return [];
  const lowerKeys = new Set(keys.map((k) => k.toLowerCase()));
  const found: unknown[] = [];
  const visit = (node: unknown, depth: number) => {
    if (depth > 4 || node == null) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    const rec = asRecord(node);
    if (!rec) return;
    for (const [key, value] of Object.entries(rec)) {
      if (lowerKeys.has(key.toLowerCase()) && value != null && typeof value !== 'object') {
        found.push(value);
      } else if (value && typeof value === 'object') {
        visit(value, depth + 1);
      }
    }
  };
  visit(obj, 0);
  return found;
}

/**
 * Unwrap common forwarding envelopes (string JSON, arrays, {body}, {payload}).
 */
export function unwrapWebhookBody(body: unknown): unknown {
  if (typeof body === 'string') {
    const trimmed = body.trim();
    if (!trimmed) return null;
    try {
      return unwrapWebhookBody(JSON.parse(trimmed));
    } catch {
      return null;
    }
  }
  if (Array.isArray(body)) {
    return body.length ? unwrapWebhookBody(body[0]) : null;
  }
  const root = asRecord(body);
  if (!root) return body;

  // Some proxies nest the Pagocards JSON under body/payload/message as a string.
  for (const key of ['body', 'payload', 'message', 'event', 'data']) {
    const nested = root[key];
    if (typeof nested === 'string' && nested.trim().startsWith('{')) {
      try {
        const parsed = JSON.parse(nested);
        // Prefer nested when it looks like a Pagocards event.
        if (asRecord(parsed) && (parsed.eventType || parsed.eventId || parsed.otp || parsed.type)) {
          return unwrapWebhookBody(parsed);
        }
      } catch {
        /* keep root */
      }
    }
  }
  return root;
}

/**
 * Normalize flat Pagocards 3DS payloads and the nested `{ type, data }` shape.
 */
export function normalizePagocardsWebhook(body: unknown): Pagocards3dsEvent | null {
  const unwrapped = unwrapWebhookBody(body);
  const root = asRecord(unwrapped);
  if (!root) return null;

  const nested = asRecord(root.data) || asRecord(root.payload) || asRecord(root.event) || null;
  const cardObj = nested ? asRecord(nested.card) : asRecord(root.card);
  const amountObj = nested ? asRecord(nested.amount) : asRecord(root.amount);
  const merchantObj = nested ? asRecord(nested.merchant) : asRecord(root.merchant);

  const eventType = pickString(
    root.eventType,
    root.event_type,
    root.type,
    nested?.eventType,
    nested?.event_type,
    nested?.type
  ) || 'unknown';

  const eventId = pickString(
    root.eventId,
    root.event_id,
    root.id,
    nested?.eventId,
    nested?.event_id,
    nested?.id,
    nested?.authId,
    root.authId,
    root.auth_id
  );

  if (!eventId) return null;

  const otpCandidates = [
    root.otp,
    root.OTP,
    root.Otp,
    root.code,
    root.verificationCode,
    root.verification_code,
    root.secureCode,
    root.secure_code,
    root.passcode,
    root.smsCode,
    root.sms_code,
    root.threeDSOtp,
    root.threeds_otp,
    root['3ds_otp'],
    nested?.otp,
    nested?.OTP,
    nested?.code,
    nested?.verificationCode,
    nested?.verification_code,
    nested?.secureCode,
    nested?.passcode,
    nested?.smsCode,
    ...deepPick(root, [
      'otp', 'OTP', 'code', 'verificationCode', 'verification_code',
      'secureCode', 'passcode', 'smsCode', 'threeDSOtp', 'threeds_otp', '3ds_otp',
    ]),
  ];
  const otp = pickOtp(...otpCandidates);

  const authId = pickString(
    root.authId,
    root.auth_id,
    nested?.authId,
    nested?.auth_id,
    nested?.id
  );

  const cardId = pickString(
    root.cardid,
    root.cardId,
    root.card_id,
    root.cardID,
    nested?.cardid,
    nested?.cardId,
    nested?.card_id,
    cardObj?.cardId,
    cardObj?.cardid,
    cardObj?.card_id,
    cardObj?.id,
    ...deepPick(root, ['cardid', 'cardId', 'card_id', 'cardID'])
  );

  const is3ds =
    /^3ds$/i.test(eventType)
    || /3ds/i.test(eventType)
    || Boolean(otp)
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
      nested?.merchant_name,
      merchantObj?.name
    ),
    transactionAmount: pickString(
      root.transactionAmount,
      root.transaction_amount,
      nested?.transactionAmount,
      nested?.transaction_amount,
      amountObj?.amount,
      typeof nested?.amount === 'number' || typeof nested?.amount === 'string' ? nested?.amount : null
    ),
    transactionCurrency: pickString(
      root.transactionCurrency,
      root.transaction_currency,
      nested?.transactionCurrency,
      nested?.transaction_currency,
      amountObj?.currency,
      nested?.currency,
      root.currency
    ),
    verificationType: pickString(
      root.verificationType,
      root.verification_type,
      nested?.verificationType,
      nested?.verification_type
    ),
    userBankcardId: pickString(
      root.userBankcardId,
      root.user_bankcard_id,
      nested?.userBankcardId,
      nested?.user_bankcard_id
    ),
    is3ds,
    raw: root,
  };
}

export function summarizePagocardsEvent(event: Pagocards3dsEvent): string {
  const parts = [
    event.eventType,
    event.otp ? `otp=${event.otp}` : 'otp=(missing)',
    event.cardId ? `card=${event.cardId}` : null,
    event.merchantName ? `merchant=${event.merchantName}` : null,
    event.transactionAmount
      ? `amount=${event.transactionAmount}${event.transactionCurrency ? ` ${event.transactionCurrency}` : ''}`
      : null,
  ].filter(Boolean);
  return parts.join(' ');
}
