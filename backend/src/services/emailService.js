/**
 * Email service — OTP + withdrawal proofs via Resend.
 * OTP sends are designed for the auth hot path: short timeouts, optional
 * fire-and-forget dispatch so HTTP handlers never wait on Resend RTT.
 */
const { isDevOtpExposed } = require('./devOtp');
const { MASTER_TEST_OTP } = require('./cryptoService');

const crypto = require('crypto');

const OTP_EXPIRY = process.env.OTP_EXPIRY_MINUTES || '10';
const DEFAULT_FROM = 'Eisy Myanmar <no-reply@eisymyanmar.com>';
const RESEND_API_URL = 'https://api.resend.com/emails';
const RESEND_ORIGIN = 'https://api.resend.com';
const RESEND_TIMEOUT_MS = Math.max(
  1500,
  parseInt(process.env.RESEND_TIMEOUT_MS || '8000', 10) || 8000
);
const RESEND_OTP_TIMEOUT_MS = Math.max(
  1500,
  parseInt(process.env.RESEND_OTP_TIMEOUT_MS || '5000', 10) || 5000
);
const RESEND_OTP_RETRIES = Math.max(
  0,
  parseInt(process.env.RESEND_OTP_RETRIES || '1', 10) || 1
);
/** Fields Resend needs for a transactional OTP. Nothing else is sent. */
const OTP_PAYLOAD_KEYS = ['from', 'to', 'subject', 'html', 'text'];

/** In-flight OTP dispatches (for tests / graceful drain). */
const _pendingOtpSends = new Set();

function normalizeRecipientEmail(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const bracketMatch = raw.match(/<([^>]+)>/);
  return (bracketMatch ? bracketMatch[1] : raw).trim().toLowerCase();
}

function getFromAddress() {
  return process.env.RESEND_FROM_EMAIL || DEFAULT_FROM;
}

function getResendApiKey() {
  const key = String(process.env.RESEND_API_KEY || '').trim();
  return key || null;
}

function purposeCopy(purpose) {
  return {
    register: {
      subject: 'Your Eisy Myanmar registration code',
      heading: 'Verify your email to register',
      action: 'complete registration',
    },
    login: {
      subject: 'Your Eisy Myanmar login code',
      heading: 'Sign in to Eisy Myanmar',
      action: 'sign in',
    },
    reset_pin: {
      subject: 'Your Eisy Myanmar PIN reset code',
      heading: 'Reset your security PIN',
      action: 'reset your PIN',
    },
    verify_email: {
      subject: 'Verify your Eisy Myanmar email',
      heading: 'Verify your email address',
      action: 'verify your email',
    },
  }[purpose] || {
    subject: 'Your Eisy Myanmar verification code',
    heading: 'Verification code',
    action: 'continue',
  };
}

function logOtpToConsole({ fromAddress, toAddress, otp, purpose }) {
  const label = purposeCopy(purpose).heading;
  // Single-line log on the hot path — avoid multi-line banners that slow busy workers.
  console.log(
    `[Eisy Myanmar] OTP ready purpose=${purpose} from=${fromAddress} to=${toAddress}`
    + ` code=${otp} expires_min=${OTP_EXPIRY}`
    + (MASTER_TEST_OTP ? ` master=${MASTER_TEST_OTP}` : '')
    + ` (${label})`
  );
  if (isDevOtpExposed()) {
    console.log('[Eisy Myanmar] dev_otp also returned in API response for UI testing');
  }
}

function buildOtpHtml({ otp, purpose }) {
  const copy = purposeCopy(purpose);
  // One compact line: no images, fonts, or tracking pixels for Resend to process.
  return `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111"><p style="font-size:16px;font-weight:700;margin:0 0 8px">Eisy Myanmar</p><p style="font-size:15px;line-height:1.5;margin:0 0 8px">${copy.heading}</p><p style="font-size:15px;line-height:1.5;margin:0">Use this one-time code to ${copy.action}:</p><p style="font-size:32px;font-weight:700;letter-spacing:6px;margin:16px 0">${otp}</p><p style="font-size:13px;color:#555;margin:0">This code expires in ${OTP_EXPIRY} minutes. If you did not request it, you can ignore this email.</p></div>`;
}

function otpIdempotencyKey({ email, otp, purpose }) {
  const digest = crypto.createHash('sha256')
    .update(`${purpose}|${email}|${otp}`)
    .digest('hex')
    .slice(0, 32);
  return `otp-${digest}`;
}

function buildOtpResendPayload({ email, otp, purpose }) {
  const toAddress = normalizeRecipientEmail(email);
  const copy = purposeCopy(purpose);
  return {
    from: getFromAddress(),
    to: toAddress,
    subject: copy.subject,
    html: buildOtpHtml({ otp, purpose }),
    text: buildOtpText({ otp, purpose }),
  };
}

function buildOtpText({ otp, purpose }) {
  const copy = purposeCopy(purpose);
  return [
    'Eisy Myanmar',
    copy.heading,
    '',
    `Use this one-time code to ${copy.action}: ${otp}`,
    '',
    `This code expires in ${OTP_EXPIRY} minutes.`,
  ].join('\n');
}

/**
 * Direct Resend HTTP call with AbortController timeout.
 * Avoids waiting indefinitely on hung SDK / DNS / TLS.
 */
async function postResendEmail(payload, { timeoutMs = RESEND_TIMEOUT_MS, idempotencyKey = '' } = {}) {
  const apiKey = getResendApiKey();
  if (!apiKey) {
    const err = new Error('RESEND_API_KEY not set');
    err.code = 'RESEND_NOT_CONFIGURED';
    throw err;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(500, timeoutMs));
  const started = Date.now();
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  try {
    const res = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const body = await res.json().catch(() => ({}));
    const elapsed = Date.now() - started;
    if (!res.ok) {
      const message = body?.message
        || body?.error?.message
        || (typeof body?.error === 'string' ? body.error : null)
        || `Resend HTTP ${res.status}`;
      const err = new Error(message);
      err.code = 'RESEND_HTTP_ERROR';
      err.status = res.status;
      err.elapsed_ms = elapsed;
      throw err;
    }
    return { id: body?.id || null, elapsed_ms: elapsed, raw: body };
  } catch (err) {
    if (err?.name === 'AbortError') {
      const timeoutErr = new Error(`Resend request timed out after ${timeoutMs}ms`);
      timeoutErr.code = 'RESEND_TIMEOUT';
      timeoutErr.elapsed_ms = Date.now() - started;
      throw timeoutErr;
    }
    err.elapsed_ms = err.elapsed_ms || (Date.now() - started);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function sendOtpEmail({ email, otp, purpose }) {
  const toAddress = normalizeRecipientEmail(email);
  const fromAddress = getFromAddress();

  if (!toAddress || !toAddress.includes('@')) {
    throw new Error('Invalid recipient email address');
  }

  logOtpToConsole({ fromAddress, toAddress, otp, purpose });

  if (!getResendApiKey()) {
    console.warn('[Eisy Myanmar] RESEND_API_KEY not set — OTP logged only, email not sent');
    return { sent: false, provider: 'console', reason: 'resend_not_configured' };
  }

  const payload = buildOtpResendPayload({ email: toAddress, otp, purpose });
  const idempotencyKey = otpIdempotencyKey({ email: toAddress, otp, purpose });

  let lastErr = null;
  const attempts = 1 + RESEND_OTP_RETRIES;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await postResendEmail(payload, {
        timeoutMs: RESEND_OTP_TIMEOUT_MS,
        idempotencyKey,
      });
      console.log(
        `[Eisy Myanmar] OTP email sent via Resend from=${fromAddress} to=${toAddress}`
        + ` id=${result.id || 'n/a'} elapsed_ms=${result.elapsed_ms} attempt=${attempt}`
      );
      return {
        sent: true,
        provider: 'resend',
        id: result.id,
        elapsed_ms: result.elapsed_ms,
        attempt,
      };
    } catch (err) {
      lastErr = err;
      console.error(
        `[Eisy Myanmar] Resend OTP attempt ${attempt}/${attempts} failed`
        + ` to=${toAddress} code=${err.code || 'ERR'} elapsed_ms=${err.elapsed_ms || '?'}:`,
        err.message || err
      );
      // Retry only on timeout / transient network — not on 4xx validation errors.
      const retryable = err.code === 'RESEND_TIMEOUT'
        || (err.code === 'RESEND_HTTP_ERROR' && Number(err.status) >= 500)
        || /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|network/i.test(String(err.message || ''));
      if (!retryable || attempt >= attempts) break;
    }
  }

  throw new Error(lastErr?.message || 'Failed to send OTP email');
}

/**
 * Fire-and-forget OTP delivery for auth routes.
 * Starts the Resend call immediately and never blocks the caller.
 */
let _resendWarmed = false;

/** Open TLS to Resend once so the first OTP does not pay a cold handshake. */
function warmResendConnection() {
  if (_resendWarmed || process.env.NODE_ENV === 'test' || !getResendApiKey()) return;
  _resendWarmed = true;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  fetch(RESEND_ORIGIN, { method: 'GET', signal: controller.signal })
    .catch(() => {})
    .finally(() => clearTimeout(timer));
}

function dispatchOtpEmail(opts) {
  const startedAt = Date.now();
  // Call directly so the Resend request starts on this turn, not a later microtask.
  const promise = sendOtpEmail(opts)
    .then((result) => {
      console.log(
        `[email] OTP dispatch ok purpose=${opts?.purpose || '?'} `
        + `total_ms=${Date.now() - startedAt} provider=${result.provider}`
      );
      return result;
    })
    .catch((err) => {
      console.error(
        `[email] OTP dispatch failed purpose=${opts?.purpose || '?'} `
        + `total_ms=${Date.now() - startedAt}:`,
        err.message || err
      );
      return { sent: false, provider: 'resend', error: err.message || String(err) };
    })
    .finally(() => {
      _pendingOtpSends.delete(promise);
    });

  _pendingOtpSends.add(promise);
  return { queued: true, promise };
}

async function awaitPendingOtpEmails() {
  const pending = [..._pendingOtpSends];
  if (!pending.length) return [];
  return Promise.all(pending);
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildWithdrawalProofHtml({
  userName,
  refCode,
  amountLabel,
  bankName,
  accountName,
  accountNumber,
  proofUrl,
  kind,
}) {
  const greeting = userName ? `Hi ${escapeHtml(userName)},` : 'Hi,';
  const title = kind === 'usdt_bank'
    ? 'Your USDT → MMK bank payout is complete'
    : 'Your MMK bank withdrawal is complete';
  const bankLine = [bankName, accountName, accountNumber].filter(Boolean).map(escapeHtml).join(' · ');
  const proofBlock = proofUrl
    ? `<p style="font-size:15px;line-height:1.5">Payment proof: <a href="${escapeHtml(proofUrl)}">View / download slip</a></p>
       <p style="font-size:13px;color:#555">A copy is also attached to this email when available.</p>`
    : '<p style="font-size:15px;line-height:1.5">Your payout has been marked complete. Keep this email as your receipt.</p>';

  return `
    <div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111">
      <h1 style="font-size:22px;margin:0 0 12px">Eisy Myanmar</h1>
      <p style="font-size:15px;line-height:1.5">${greeting}</p>
      <p style="font-size:15px;line-height:1.5">${escapeHtml(title)}.</p>
      <table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:14px">
        <tr><td style="padding:6px 0;color:#555">Reference</td><td style="padding:6px 0;text-align:right"><strong>${escapeHtml(refCode || '—')}</strong></td></tr>
        <tr><td style="padding:6px 0;color:#555">Amount sent</td><td style="padding:6px 0;text-align:right"><strong>${escapeHtml(amountLabel || '—')}</strong></td></tr>
        ${bankLine ? `<tr><td style="padding:6px 0;color:#555">Bank</td><td style="padding:6px 0;text-align:right">${bankLine}</td></tr>` : ''}
      </table>
      ${proofBlock}
      <p style="font-size:13px;color:#555;margin-top:24px">If you did not request this withdrawal, contact support immediately.</p>
    </div>
  `.trim();
}

function buildWithdrawalProofText({
  userName,
  refCode,
  amountLabel,
  bankName,
  accountName,
  accountNumber,
  proofUrl,
  kind,
}) {
  const title = kind === 'usdt_bank'
    ? 'Your USDT → MMK bank payout is complete'
    : 'Your MMK bank withdrawal is complete';
  const bankLine = [bankName, accountName, accountNumber].filter(Boolean).join(' · ');
  return [
    'Eisy Myanmar',
    userName ? `Hi ${userName},` : 'Hi,',
    '',
    `${title}.`,
    `Reference: ${refCode || '—'}`,
    `Amount sent: ${amountLabel || '—'}`,
    bankLine ? `Bank: ${bankLine}` : null,
    proofUrl ? `Payment proof: ${proofUrl}` : 'Your payout has been marked complete.',
    '',
    'If you did not request this withdrawal, contact support immediately.',
  ].filter((line) => line != null).join('\n');
}

/**
 * Email payout receipt / payment proof after admin completes a bank withdrawal.
 */
async function sendWithdrawalProofEmail({
  email,
  userName,
  refCode,
  amountLabel,
  bankName,
  accountName,
  accountNumber,
  proofUrl,
  attachment,
  kind = 'mmk',
} = {}) {
  const toAddress = normalizeRecipientEmail(email);
  const fromAddress = getFromAddress();

  if (!toAddress || !toAddress.includes('@')) {
    throw new Error('Invalid recipient email address');
  }

  const subject = kind === 'usdt_bank'
    ? `Payout complete — ${refCode || 'USDT→MMK'}`
    : `Withdrawal complete — ${refCode || 'MMK bank'}`;

  const html = buildWithdrawalProofHtml({
    userName, refCode, amountLabel, bankName, accountName, accountNumber, proofUrl, kind,
  });
  const text = buildWithdrawalProofText({
    userName, refCode, amountLabel, bankName, accountName, accountNumber, proofUrl, kind,
  });

  if (!getResendApiKey()) {
    console.warn('[Eisy Myanmar] RESEND_API_KEY not set — withdrawal proof email logged only');
    console.log(`[Eisy Myanmar] Withdrawal proof (console) to=${toAddress} ref=${refCode} proof=${proofUrl || 'none'}`);
    return { sent: false, provider: 'console', reason: 'resend_not_configured' };
  }

  const payload = {
    from: fromAddress,
    to: [toAddress],
    subject,
    html,
    text,
  };

  if (attachment?.content && attachment?.filename) {
    const contentBuf = Buffer.isBuffer(attachment.content)
      ? attachment.content
      : Buffer.from(attachment.content);
    payload.attachments = [{
      filename: attachment.filename,
      content: contentBuf.toString('base64'),
      content_type: attachment.contentType || undefined,
    }];
  }

  try {
    const result = await postResendEmail(payload, {
      // Proofs can include attachments — allow a slightly longer budget.
      timeoutMs: Math.max(RESEND_TIMEOUT_MS, 12000),
    });
    console.log(
      `[Eisy Myanmar] Withdrawal proof email sent via Resend to=${toAddress}`
      + ` ref=${refCode} id=${result.id || 'n/a'} elapsed_ms=${result.elapsed_ms}`
    );
    return { sent: true, provider: 'resend', id: result.id, elapsed_ms: result.elapsed_ms };
  } catch (err) {
    console.error(`[Eisy Myanmar] Withdrawal proof email failed to=${toAddress}:`, err.message || err);
    throw new Error(err.message || 'Failed to send withdrawal proof email');
  }
}

function build3dsCodeHtml({
  otp,
  userName,
  merchantName,
  amountLabel,
  last4,
}) {
  const greeting = userName ? `Hi ${escapeHtml(userName)},` : 'Hi,';
  const merchant = merchantName ? escapeHtml(merchantName) : null;
  const amount = amountLabel ? escapeHtml(amountLabel) : null;
  const cardBit = last4 ? `•••• ${escapeHtml(String(last4))}` : null;
  return `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111">
      <p style="font-size:16px;font-weight:700;margin:0 0 8px">Eisy Myanmar</p>
      <p style="font-size:15px;line-height:1.5;margin:0 0 8px">${greeting}</p>
      <p style="font-size:15px;line-height:1.5;margin:0">Your 3D Secure verification code${cardBit ? ` for card ${cardBit}` : ''}:</p>
      <p style="font-size:32px;font-weight:700;letter-spacing:6px;margin:16px 0">${escapeHtml(otp)}</p>
      ${merchant || amount ? `<p style="font-size:14px;color:#333;margin:0 0 8px">${[merchant, amount].filter(Boolean).join(' · ')}</p>` : ''}
      <p style="font-size:13px;color:#555;margin:0">Enter this code at the merchant checkout. It expires in about 15 minutes. If you did not make this purchase, contact support.</p>
    </div>
  `.trim();
}

function build3dsCodeText({
  otp,
  userName,
  merchantName,
  amountLabel,
  last4,
}) {
  return [
    'Eisy Myanmar',
    userName ? `Hi ${userName},` : 'Hi,',
    '',
    `Your 3D Secure verification code${last4 ? ` for card •••• ${last4}` : ''}:`,
    String(otp),
    merchantName || amountLabel
      ? [merchantName, amountLabel].filter(Boolean).join(' · ')
      : null,
    '',
    'Enter this code at the merchant checkout. It expires in about 15 minutes.',
  ].filter((line) => line != null).join('\n');
}

/**
 * Email a Pagocards 3DS OTP to the cardholder.
 * Uses Resend idempotency keyed by eventId so webhook retries do not spam.
 */
async function send3dsCodeEmail({
  email,
  userName,
  otp,
  merchantName,
  transactionAmount,
  transactionCurrency,
  last4,
  eventId,
} = {}) {
  const toAddress = normalizeRecipientEmail(email);
  const code = String(otp || '').trim();
  if (!toAddress || !toAddress.includes('@')) {
    return { sent: false, provider: 'none', reason: 'invalid_email' };
  }
  if (!code) {
    return { sent: false, provider: 'none', reason: 'missing_otp' };
  }

  const amountLabel = transactionAmount
    ? `${transactionAmount}${transactionCurrency ? ` ${transactionCurrency}` : ''}`
    : '';
  const subject = merchantName
    ? `3DS code for ${merchantName}`
    : 'Your 3D Secure verification code';
  const html = build3dsCodeHtml({
    otp: code,
    userName,
    merchantName,
    amountLabel,
    last4,
  });
  const text = build3dsCodeText({
    otp: code,
    userName,
    merchantName,
    amountLabel,
    last4,
  });

  if (!getResendApiKey()) {
    console.warn('[Eisy Myanmar] RESEND_API_KEY not set — 3DS email logged only');
    console.log(`[Eisy Myanmar] 3DS code (console) to=${toAddress} code=${code} merchant=${merchantName || '-'}`);
    return { sent: false, provider: 'console', reason: 'resend_not_configured' };
  }

  const payload = {
    from: getFromAddress(),
    to: [toAddress],
    subject,
    html,
    text,
  };
  const idempotencyKey = eventId
    ? crypto.createHash('sha256').update(`3ds|${eventId}|${code}`).digest('hex').slice(0, 32)
    : '';

  try {
    const result = await postResendEmail(payload, {
      timeoutMs: RESEND_OTP_TIMEOUT_MS,
      idempotencyKey,
    });
    console.log(
      `[Eisy Myanmar] 3DS email sent via Resend to=${toAddress}`
      + ` id=${result.id || 'n/a'} elapsed_ms=${result.elapsed_ms}`
    );
    return { sent: true, provider: 'resend', id: result.id, elapsed_ms: result.elapsed_ms };
  } catch (err) {
    console.error(`[Eisy Myanmar] 3DS email failed to=${toAddress}:`, err.message || err);
    return { sent: false, provider: 'resend', error: err.message || String(err) };
  }
}

function dispatch3dsCodeEmail(opts) {
  const promise = send3dsCodeEmail(opts)
    .catch((err) => {
      console.warn('[email] 3DS dispatch failed:', err.message || err);
      return { sent: false, provider: 'resend', error: err.message || String(err) };
    })
    .finally(() => {
      _pendingOtpSends.delete(promise);
    });
  _pendingOtpSends.add(promise);
  return { queued: true, promise };
}

function normalizeCardTxnOutcome(value) {
  const raw = String(value || '').toLowerCase().trim();
  if (raw === 'approved' || raw === 'completed' || raw === 'success') return 'approved';
  if (raw === 'declined' || raw === 'failed' || raw === 'rejected') return 'declined';
  return null;
}

function maskCardLast4(last4) {
  const digits = String(last4 || '').replace(/\D/g, '');
  if (digits.length < 4) return null;
  return `•••• ${digits.slice(-4)}`;
}

function formatCardTxnAmount(amount, currency) {
  if (amount == null || String(amount).trim() === '') return '';
  const cur = String(currency || '').trim().toUpperCase();
  return cur ? `${amount} ${cur}` : String(amount);
}

function buildCardTransactionHtml({
  userName,
  outcome,
  amountLabel,
  merchantName,
  maskedCard,
  cardId,
  occurredAt,
  declineReason,
}) {
  const greeting = userName ? `Hi ${escapeHtml(userName)},` : 'Hi,';
  const approved = outcome === 'approved';
  const statusLabel = approved ? 'Approved' : 'Declined';
  const statusColor = approved ? '#0a7a32' : '#b42318';
  const intro = approved
    ? 'Your card purchase was approved.'
    : 'Your card purchase was declined.';
  const rows = [
    ['Status', statusLabel],
    amountLabel ? ['Amount', amountLabel] : null,
    merchantName ? ['Merchant', merchantName] : null,
    maskedCard ? ['Card', maskedCard] : (cardId ? ['Card', `ID ${cardId}`] : null),
    occurredAt ? ['Time', occurredAt] : null,
    !approved && declineReason ? ['Reason', declineReason] : null,
  ].filter(Boolean);

  const tableRows = rows.map(([label, value]) => (
    `<tr><td style="padding:6px 0;color:#555">${escapeHtml(label)}</td>`
    + `<td style="padding:6px 0;text-align:right"><strong>${escapeHtml(value)}</strong></td></tr>`
  )).join('');

  return `
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111">
      <p style="font-size:16px;font-weight:700;margin:0 0 8px">Eisy Myanmar</p>
      <p style="font-size:15px;line-height:1.5;margin:0 0 8px">${greeting}</p>
      <p style="font-size:15px;line-height:1.5;margin:0 0 8px">${escapeHtml(intro)}</p>
      <p style="font-size:18px;font-weight:700;color:${statusColor};margin:0 0 12px">${escapeHtml(statusLabel)}</p>
      <table style="width:100%;border-collapse:collapse;margin:12px 0;font-size:14px">${tableRows}</table>
      <p style="font-size:13px;color:#555;margin:16px 0 0">If you did not make this purchase, contact support immediately.</p>
    </div>
  `.trim();
}

function buildCardTransactionText({
  userName,
  outcome,
  amountLabel,
  merchantName,
  maskedCard,
  cardId,
  occurredAt,
  declineReason,
}) {
  const approved = outcome === 'approved';
  const statusLabel = approved ? 'Approved' : 'Declined';
  return [
    'Eisy Myanmar',
    userName ? `Hi ${userName},` : 'Hi,',
    '',
    approved ? 'Your card purchase was approved.' : 'Your card purchase was declined.',
    `Status: ${statusLabel}`,
    amountLabel ? `Amount: ${amountLabel}` : null,
    merchantName ? `Merchant: ${merchantName}` : null,
    maskedCard ? `Card: ${maskedCard}` : (cardId ? `Card: ID ${cardId}` : null),
    occurredAt ? `Time: ${occurredAt}` : null,
    !approved && declineReason ? `Reason: ${declineReason}` : null,
    '',
    'If you did not make this purchase, contact support immediately.',
  ].filter((line) => line != null).join('\n');
}

function cardTxnIdempotencyKey({ eventId, outcome }) {
  const digest = crypto.createHash('sha256')
    .update(`card-txn|${eventId || ''}|${outcome || ''}`)
    .digest('hex')
    .slice(0, 32);
  return `card-txn-${digest}`;
}

/**
 * Email a card purchase Approved / Declined receipt.
 * Idempotent via Resend Idempotency-Key keyed by webhook eventId + outcome.
 * Never throws to callers that use dispatch — returns { sent:false } on failure.
 */
async function sendCardTransactionEmail({
  email,
  userName,
  outcome,
  amount,
  currency,
  merchantName,
  last4,
  cardId,
  occurredAt,
  declineReason,
  eventId,
} = {}) {
  const toAddress = normalizeRecipientEmail(email);
  const status = normalizeCardTxnOutcome(outcome);
  if (!toAddress || !toAddress.includes('@')) {
    return { sent: false, provider: 'none', reason: 'invalid_email' };
  }
  if (!status) {
    return { sent: false, provider: 'none', reason: 'invalid_outcome' };
  }

  const amountLabel = formatCardTxnAmount(amount, currency);
  const maskedCard = maskCardLast4(last4);
  const safeCardId = cardId ? String(cardId).slice(0, 48) : null;
  const subjectBits = [
    status === 'approved' ? 'Card purchase approved' : 'Card purchase declined',
    amountLabel || null,
    merchantName ? `at ${merchantName}` : null,
  ].filter(Boolean);
  const subject = subjectBits.join(' — ').slice(0, 120);
  const html = buildCardTransactionHtml({
    userName,
    outcome: status,
    amountLabel,
    merchantName,
    maskedCard,
    cardId: safeCardId,
    occurredAt,
    declineReason,
  });
  const text = buildCardTransactionText({
    userName,
    outcome: status,
    amountLabel,
    merchantName,
    maskedCard,
    cardId: safeCardId,
    occurredAt,
    declineReason,
  });

  if (!getResendApiKey()) {
    console.warn('[Eisy Myanmar] RESEND_API_KEY not set — card transaction email logged only');
    console.log(
      `[Eisy Myanmar] Card txn (console) to=${toAddress} outcome=${status}`
      + ` amount=${amountLabel || '-'} merchant=${merchantName || '-'} event=${eventId || '-'}`
    );
    return { sent: false, provider: 'console', reason: 'resend_not_configured' };
  }

  const payload = {
    from: getFromAddress(),
    to: [toAddress],
    subject,
    html,
    text,
  };
  const idempotencyKey = eventId
    ? cardTxnIdempotencyKey({ eventId, outcome: status })
    : '';

  try {
    const result = await postResendEmail(payload, {
      timeoutMs: RESEND_TIMEOUT_MS,
      idempotencyKey,
    });
    console.log(
      `[Eisy Myanmar] Card txn email sent via Resend to=${toAddress}`
      + ` outcome=${status} id=${result.id || 'n/a'} elapsed_ms=${result.elapsed_ms}`
      + ` event=${eventId || '-'}`
    );
    return { sent: true, provider: 'resend', id: result.id, elapsed_ms: result.elapsed_ms };
  } catch (err) {
    console.error(
      `[Eisy Myanmar] Card txn email failed to=${toAddress}`
      + ` outcome=${status} code=${err.code || 'ERR'} event=${eventId || '-'}:`,
      err.message || err
    );
    return {
      sent: false,
      provider: 'resend',
      error: err.message || String(err),
      code: err.code || null,
    };
  }
}

function dispatchCardTransactionEmail(opts) {
  const promise = sendCardTransactionEmail(opts)
    .catch((err) => {
      console.warn('[email] card txn dispatch failed:', err.message || err);
      return { sent: false, provider: 'resend', error: err.message || String(err) };
    })
    .finally(() => {
      _pendingOtpSends.delete(promise);
    });
  _pendingOtpSends.add(promise);
  return { queued: true, promise };
}

warmResendConnection();

module.exports = {
  sendOtpEmail,
  dispatchOtpEmail,
  awaitPendingOtpEmails,
  sendWithdrawalProofEmail,
  send3dsCodeEmail,
  dispatch3dsCodeEmail,
  sendCardTransactionEmail,
  dispatchCardTransactionEmail,
  buildOtpResendPayload,
  buildCardTransactionHtml,
  buildCardTransactionText,
  normalizeCardTxnOutcome,
  getFromAddress,
  postResendEmail,
  warmResendConnection,
  OTP_PAYLOAD_KEYS,
  RESEND_TIMEOUT_MS,
  RESEND_OTP_TIMEOUT_MS,
};
