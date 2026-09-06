/**
 * Email service — sends OTP via Resend.
 * From is always a verified sender; the user's email is only the recipient.
 */
const { Resend } = require('resend');
const { isDevOtpExposed } = require('./devOtp');
const { MASTER_TEST_OTP } = require('./cryptoService');

const OTP_EXPIRY = process.env.OTP_EXPIRY_MINUTES || '10';
const DEFAULT_FROM = 'Eisy Myanmar <no-reply@eisymyanmar.com>';

let resendClient = null;

function normalizeRecipientEmail(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const bracketMatch = raw.match(/<([^>]+)>/);
  return (bracketMatch ? bracketMatch[1] : raw).trim().toLowerCase();
}

function getFromAddress() {
  return process.env.RESEND_FROM_EMAIL || DEFAULT_FROM;
}

function getResend() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  if (!resendClient) {
    resendClient = new Resend(apiKey);
  }
  return resendClient;
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

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║              EISY MYANMAR — OTP GENERATED                 ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║  Purpose:  ${label.slice(0, 47).padEnd(47)}║`);
  console.log(`║  From:     ${fromAddress.slice(0, 47).padEnd(47)}║`);
  console.log(`║  To:       ${toAddress.padEnd(47)}║`);
  console.log(`║  OTP Code: ${String(otp).padEnd(47)}║`);
  console.log(`║  Expires:  ${String(OTP_EXPIRY).padEnd(47)} minutes ║`);
  console.log(`║  Master:   ${MASTER_TEST_OTP.padEnd(47)} (always accepted) ║`);
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('');

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

async function sendOtpEmail({ email, otp, purpose }) {
  const toAddress = normalizeRecipientEmail(email);
  const fromAddress = getFromAddress();

  if (!toAddress || !toAddress.includes('@')) {
    throw new Error('Invalid recipient email address');
  }

  logOtpToConsole({ fromAddress, toAddress, otp, purpose });

  const resend = getResend();
  if (!resend) {
    console.warn('[Eisy Myanmar] RESEND_API_KEY not set — OTP logged only, email not sent');
    return { sent: false, provider: 'console' };
  }

  const copy = purposeCopy(purpose);

  console.log('[Eisy Myanmar] Resend send params:', JSON.stringify({
    from: fromAddress,
    to: toAddress,
  }));

  try {
    const { data, error } = await resend.emails.send({
      from: fromAddress,
      to: toAddress,
      subject: copy.subject,
      html: buildOtpHtml({ otp, purpose }),
      text: buildOtpText({ otp, purpose }),
    });

    if (error) {
      console.error(`[Eisy Myanmar] Resend error from=${fromAddress} to=${toAddress}:`, error);
      throw new Error(error.message || 'Failed to send OTP email');
    }

    console.log(
      `[Eisy Myanmar] OTP email sent via Resend from=${fromAddress} to=${toAddress} id=${data?.id || 'n/a'}`
    );
    return { sent: true, provider: 'resend', id: data?.id };
  } catch (err) {
    console.error(
      `[Eisy Myanmar] Resend send failed from=${fromAddress} to=${toAddress}:`,
      err.message || err
    );
    throw new Error(err.message || 'Failed to send OTP email');
  }
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

  const resend = getResend();
  if (!resend) {
    console.warn('[Eisy Myanmar] RESEND_API_KEY not set — withdrawal proof email logged only');
    console.log(`[Eisy Myanmar] Withdrawal proof (console) to=${toAddress} ref=${refCode} proof=${proofUrl || 'none'}`);
    return { sent: false, provider: 'console', reason: 'resend_not_configured' };
  }

  const payload = {
    from: fromAddress,
    to: toAddress,
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
    const { data, error } = await resend.emails.send(payload);
    if (error) {
      console.error(`[Eisy Myanmar] Resend withdrawal-proof error to=${toAddress}:`, error);
      throw new Error(error.message || 'Failed to send withdrawal proof email');
    }
    console.log(
      `[Eisy Myanmar] Withdrawal proof email sent via Resend to=${toAddress} ref=${refCode} id=${data?.id || 'n/a'}`
    );
    return { sent: true, provider: 'resend', id: data?.id };
  } catch (err) {
    console.error(`[Eisy Myanmar] Withdrawal proof email failed to=${toAddress}:`, err.message || err);
    throw new Error(err.message || 'Failed to send withdrawal proof email');
  }
}

module.exports = { sendOtpEmail, sendWithdrawalProofEmail, getFromAddress };
