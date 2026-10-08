/**
 * Pagocards webhook payload helpers (3DS OTP / card events) — CommonJS.
 *
 * Loaded by Express via require(). Keep this file free of ESM `export` so
 * Vercel/Node never throws "Unexpected token 'export'".
 *
 * Docs: https://pagocards.com/documentation
 */

'use strict';

function asRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value;
}

function pickString(...candidates) {
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
function pickOtp(...candidates) {
  const strings = candidates
    .map((c) => (c == null ? null : String(c).trim()))
    .filter(Boolean);
  const numeric = strings.find((s) => /^\d{4,8}$/.test(s));
  if (numeric) return numeric;
  return strings[0] || null;
}

function deepPick(obj, keys) {
  if (!obj) return [];
  const lowerKeys = new Set(keys.map((k) => k.toLowerCase()));
  const found = [];
  const visit = (node, depth) => {
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
function unwrapWebhookBody(body) {
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

  for (const key of ['body', 'payload', 'message', 'event', 'data']) {
    const nested = root[key];
    if (typeof nested === 'string' && nested.trim().startsWith('{')) {
      try {
        const parsed = JSON.parse(nested);
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
function normalizePagocardsWebhook(body) {
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
    nested && nested.eventType,
    nested && nested.event_type,
    nested && nested.type
  ) || 'unknown';

  const eventId = pickString(
    root.eventId,
    root.event_id,
    root.id,
    nested && nested.eventId,
    nested && nested.event_id,
    nested && nested.id,
    nested && nested.authId,
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
    nested && nested.otp,
    nested && nested.OTP,
    nested && nested.code,
    nested && nested.verificationCode,
    nested && nested.verification_code,
    nested && nested.secureCode,
    nested && nested.passcode,
    nested && nested.smsCode,
    ...deepPick(root, [
      'otp', 'OTP', 'code', 'verificationCode', 'verification_code',
      'secureCode', 'passcode', 'smsCode', 'threeDSOtp', 'threeds_otp', '3ds_otp',
    ]),
  ];
  const otp = pickOtp(...otpCandidates);

  const authId = pickString(
    root.authId,
    root.auth_id,
    nested && nested.authId,
    nested && nested.auth_id,
    nested && nested.id
  );

  const cardId = pickString(
    root.cardid,
    root.cardId,
    root.card_id,
    root.cardID,
    nested && nested.cardid,
    nested && nested.cardId,
    nested && nested.card_id,
    cardObj && cardObj.cardId,
    cardObj && cardObj.cardid,
    cardObj && cardObj.card_id,
    cardObj && cardObj.id,
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
      nested && nested.merchantName,
      nested && nested.merchant_name,
      merchantObj && merchantObj.name
    ),
    transactionAmount: pickString(
      root.transactionAmount,
      root.transaction_amount,
      nested && nested.transactionAmount,
      nested && nested.transaction_amount,
      amountObj && amountObj.amount,
      nested && (typeof nested.amount === 'number' || typeof nested.amount === 'string')
        ? nested.amount
        : null
    ),
    transactionCurrency: pickString(
      root.transactionCurrency,
      root.transaction_currency,
      nested && nested.transactionCurrency,
      nested && nested.transaction_currency,
      amountObj && amountObj.currency,
      nested && nested.currency,
      root.currency
    ),
    verificationType: pickString(
      root.verificationType,
      root.verification_type,
      nested && nested.verificationType,
      nested && nested.verification_type
    ),
    userBankcardId: pickString(
      root.userBankcardId,
      root.user_bankcard_id,
      nested && nested.userBankcardId,
      nested && nested.user_bankcard_id
    ),
    is3ds,
    raw: root,
  };
}

function summarizePagocardsEvent(event) {
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

const OTP_FIELD_NAMES = new Set([
  'otp',
  'verification_code',
  'verificationcode',
  'secure_code',
  'securecode',
  'smscode',
  'sms_code',
  'threedsotp',
  'threeds_otp',
  '3ds_otp',
  '3dsotp',
]);

/**
 * Walk a Pagocards card or transactions payload and pull numeric 3DS OTPs.
 * Only explicit OTP field names are used so merchant MCC / amounts are ignored.
 */
function collect3dsOtps(payload, fallbackCardId) {
  const found = [];
  const seen = new Set();

  const visit = (node, depth) => {
    if (node == null || depth > 6) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    if (typeof node !== 'object') return;

    let otp = null;
    for (const [key, value] of Object.entries(node)) {
      if (!OTP_FIELD_NAMES.has(String(key).toLowerCase())) continue;
      const text = value == null ? '' : String(value).trim();
      if (/^\d{4,8}$/.test(text)) otp = text;
    }

    if (otp) {
      const eventId = pickString(
        node.eventId,
        node.event_id,
        node.authId,
        node.auth_id,
        node.id,
        node.transaction_id,
        node.reference
      ) || `3ds-${fallbackCardId || 'card'}-${otp}`;
      if (!seen.has(eventId)) {
        seen.add(eventId);
        found.push({
          eventId,
          eventType: pickString(node.eventType, node.event_type, node.type) || '3ds',
          authId: pickString(node.authId, node.auth_id),
          otp,
          cardId: pickString(node.cardid, node.cardId, node.card_id, fallbackCardId),
          merchantName: pickString(node.merchantName, node.merchant_name),
          transactionAmount: pickString(
            node.transactionAmount,
            node.transaction_amount,
            node.display_amount,
            node.transCurrencyAmt
          ),
          transactionCurrency: pickString(
            node.transactionCurrency,
            node.transaction_currency,
            node.currency,
            node.transCurrency
          ),
          verificationType: pickString(node.verificationType, node.verification_type),
          userBankcardId: pickString(node.userBankcardId, node.user_bankcard_id),
          is3ds: true,
          raw: node,
        });
      }
    }

    for (const value of Object.values(node)) {
      if (value && typeof value === 'object') visit(value, depth + 1);
    }
  };

  visit(payload, 0);
  return found;
}

module.exports = {
  unwrapWebhookBody,
  normalizePagocardsWebhook,
  summarizePagocardsEvent,
  collect3dsOtps,
};
