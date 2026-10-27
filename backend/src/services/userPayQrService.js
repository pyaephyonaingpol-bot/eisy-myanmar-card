'use strict';

/**
 * User-to-user USDT Pay QR (internal ledger transfer — not on-chain Scan Pay).
 */
const User = require('../models/User');

const USER_PAY_QR_VERSION = '1';
const MIN_USER_PAY_USDT = 0.01;
const MAX_USER_PAY_USDT = 50000;

function buildUserReceiveQrPayload({ userId, email }) {
  const em = String(email || '').trim().toLowerCase();
  const uid = Number(userId);
  if (!em && !(Number.isFinite(uid) && uid > 0)) {
    const err = new Error('User email or id required for Pay QR');
    err.code = 'PAY_QR_CONFIG';
    throw err;
  }
  const params = new URLSearchParams();
  params.set('v', USER_PAY_QR_VERSION);
  if (Number.isFinite(uid) && uid > 0) params.set('uid', String(Math.floor(uid)));
  if (em) params.set('email', em);
  return `eisy://pay?${params.toString()}`;
}

function parseUserPayQrPayload(rawInput) {
  const raw = String(rawInput || '').trim();
  if (!raw) {
    const err = new Error('QR payload is empty');
    err.code = 'EMPTY_QR';
    throw err;
  }

  if (raw.startsWith('{')) {
    try {
      const json = JSON.parse(raw);
      const type = String(json.type || json.kind || '').toLowerCase();
      if (type && type !== 'eisy_user_pay' && type !== 'user_pay') {
        const err = new Error('Unsupported QR JSON type');
        err.code = 'UNPARSEABLE_QR';
        throw err;
      }
      const email = json.email || json.to_email || json.recipient_email || null;
      const uid = json.user_id ?? json.uid ?? json.to_user_id ?? null;
      const amount = json.amount_usdt ?? json.amount ?? null;
      return normalizeParsedPayQr({
        to_email: email,
        to_user_id: uid,
        amount_usdt: amount != null ? Number(amount) : null,
        note: json.note || json.memo || null,
        raw,
      });
    } catch (err) {
      if (err.code) throw err;
      /* fall through */
    }
  }

  if (/^eisy:\/\//i.test(raw) || /^eisymyanmar:\/\//i.test(raw)) {
    try {
      const url = new URL(raw.replace(/^eisy:/i, 'https:').replace(/^eisymyanmar:/i, 'https:'));
      const path = url.pathname.replace(/^\//, '').toLowerCase();
      if (path && path !== 'pay') {
        const err = new Error('Unsupported Eisy payment link');
        err.code = 'UNPARSEABLE_QR';
        throw err;
      }
      const amount = url.searchParams.get('amount') || url.searchParams.get('amount_usdt');
      return normalizeParsedPayQr({
        to_email: url.searchParams.get('email') || url.searchParams.get('to_email'),
        to_user_id: url.searchParams.get('uid') || url.searchParams.get('user_id'),
        amount_usdt: amount != null ? Number(amount) : null,
        note: url.searchParams.get('note') || url.searchParams.get('memo'),
        raw,
      });
    } catch (err) {
      if (err.code) throw err;
      /* fall through */
    }
  }

  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
    return normalizeParsedPayQr({
      to_email: raw.toLowerCase(),
      to_user_id: null,
      amount_usdt: null,
      note: null,
      raw,
    });
  }

  const err = new Error('Could not parse a user Pay QR — scan an Eisy Pay code or enter recipient email');
  err.code = 'UNPARSEABLE_QR';
  throw err;
}

function normalizeParsedPayQr({ to_email, to_user_id, amount_usdt, note, raw }) {
  const email = to_email ? String(to_email).trim().toLowerCase() : null;
  let uid = to_user_id != null && to_user_id !== '' ? parseInt(to_user_id, 10) : null;
  if (!Number.isFinite(uid)) uid = null;

  if (!email && !uid) {
    const err = new Error('Pay QR must include recipient email or user id');
    err.code = 'UNPARSEABLE_QR';
    throw err;
  }

  let amount = null;
  if (amount_usdt != null && amount_usdt !== '') {
    amount = Number(amount_usdt);
    if (!Number.isFinite(amount) || amount < MIN_USER_PAY_USDT) {
      const err = new Error(`Invalid amount in QR (min ${MIN_USER_PAY_USDT} USDT)`);
      err.code = 'INVALID_AMOUNT';
      throw err;
    }
    if (amount > MAX_USER_PAY_USDT) {
      const err = new Error(`Amount in QR exceeds maximum (${MAX_USER_PAY_USDT} USDT)`);
      err.code = 'AMOUNT_TOO_LARGE';
      throw err;
    }
  }

  return {
    to_email: email,
    to_user_id: uid,
    amount_usdt: amount,
    note: note ? String(note).slice(0, 120) : null,
    raw,
    kind: 'user_internal',
  };
}

async function enrichParsedPayRecipient(parsed, { payerUserId } = {}) {
  const out = { ...parsed };
  let recipient = null;
  if (parsed.to_email) {
    recipient = await User.findByEmail(parsed.to_email);
  } else if (parsed.to_user_id) {
    recipient = await User.findById(parsed.to_user_id);
  }
  if (recipient && Number(recipient.id) === Number(payerUserId)) {
    const err = new Error('You cannot pay yourself');
    err.code = 'SELF_PAYMENT';
    throw err;
  }
  out.recipient_found = Boolean(recipient);
  out.recipient_label = recipient
    ? (recipient.name || recipient.email || `User #${recipient.id}`)
    : null;
  if (recipient && !out.to_email) out.to_email = recipient.email || null;
  if (recipient && !out.to_user_id) out.to_user_id = recipient.id;
  return out;
}

module.exports = {
  USER_PAY_QR_VERSION,
  MIN_USER_PAY_USDT,
  MAX_USER_PAY_USDT,
  buildUserReceiveQrPayload,
  parseUserPayQrPayload,
  enrichParsedPayRecipient,
};
