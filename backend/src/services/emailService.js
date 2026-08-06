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

module.exports = { sendOtpEmail, getFromAddress };
