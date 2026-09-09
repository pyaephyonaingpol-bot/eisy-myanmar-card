/**
 * Email service — OTP + withdrawal proofs via Resend.
 * OTP sends are designed for the auth hot path: short timeouts, optional
 * fire-and-forget dispatch so HTTP handlers never wait on Resend RTT.
 */
const { isDevOtpExposed } = require('./devOtp');
const { MASTER_TEST_OTP } = require('./cryptoService');

const OTP_EXPIRY = process.env.OTP_EXPIRY_MINUTES || '10';
const DEFAULT_FROM = 'Eisy Myanmar <no-reply@eisymyanmar.com>';
const RESEND_API_URL = 'https://api.resend.com/emails';
const RESEND_TIMEOUT_MS = Math.max(
  1500,
  parseInt(process.env.RESEND_TIMEOUT_MS || '8000', 10) || 8000
);
const RESEND_OTP_RETRIES = Math.max(
  0,
  parseInt(process.env.RESEND_OTP_RETRIES || '1', 10) || 1
);

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
    reset_password: {
      subject: 'Your Eisy Myanmar password reset code',
      heading: 'Reset your account password',
      action: 'reset your password',
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
  return `
    <div style="font-family:Inter,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111">
      <h1 style="font-size:22px;margin:0 0 12px">Eisy Myanmar</h1>
      <p style="font-size:15px;line-height:1.5">${copy.heading}</p>
      <p style="font-size:15px;line-height:1.5">Use this one-time code to ${copy.action}:</p>
      <p style="font-size:32px;font-weight:700;letter-spacing:6px;margin:24px 0">${otp}</p>
      <p style="font-size:13px;color:#555">This code expires in ${OTP_EXPIRY} minutes. If you did not request it, you can ignore this email.</p>
    </div>
  `.trim();
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
async function postResendEmail(payload, { timeoutMs = RESEND_TIMEOUT_MS } = {}) {
  const apiKey = getResendApiKey();
  if (!apiKey) {
    const err = new Error('RESEND_API_KEY not set');
    err.code = 'RESEND_NOT_CONFIGURED';
    throw err;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(500, timeoutMs));
  const started = Date.now();
  try {
    const res = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
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

  const copy = purposeCopy(purpose);
  const payload = {
    from: fromAddress,
    to: [toAddress],
    subject: copy.subject,
    html: buildOtpHtml({ otp, purpose }),
    text: buildOtpText({ otp, purpose }),
  };

  let lastErr = null;
  const attempts = 1 + RESEND_OTP_RETRIES;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await postResendEmail(payload);
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
function dispatchOtpEmail(opts) {
  const startedAt = Date.now();
  const promise = Promise.resolve()
    .then(() => sendOtpEmail(opts))
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

module.exports = {
  sendOtpEmail,
  dispatchOtpEmail,
  awaitPendingOtpEmails,
  sendWithdrawalProofEmail,
  getFromAddress,
  postResendEmail,
  RESEND_TIMEOUT_MS,
};
