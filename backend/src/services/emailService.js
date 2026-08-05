/**
 * Email service — sends OTP via Amazon SES.
 * Source is ALWAYS a verified identity — never the user's email.
 */
const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
const { isDevOtpExposed } = require('./devOtp');
const { MASTER_TEST_OTP } = require('./cryptoService');

const AWS_REGION = process.env.AWS_REGION || 'eu-north-1';
const OTP_EXPIRY = process.env.OTP_EXPIRY_MINUTES || '10';

/** Hardcoded verified SES senders — user input can NEVER become Source. */
const VERIFIED_SENDERS = Object.freeze([
  'eisymyanmar@gmail.com',
  'noreply@eisymyanmar.com',
]);

/** Primary verified sender used for every outbound OTP. */
const VERIFIED_SENDER = 'eisymyanmar@gmail.com';

let sesClient = null;

function normalizeRecipientEmail(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const bracketMatch = raw.match(/<([^>]+)>/);
  const address = (bracketMatch ? bracketMatch[1] : raw).trim().toLowerCase();
  return address;
}

function getSesClient() {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) return null;

  if (!sesClient) {
    sesClient = new SESClient({
      region: AWS_REGION,
      credentials: { accessKeyId, secretAccessKey },
    });
  }
  return sesClient;
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

function logOtpToConsole({ toAddress, otp, purpose }) {
  const label = purposeCopy(purpose).heading;

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║              EISY MYANMAR — OTP GENERATED                 ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║  Purpose:  ${label.slice(0, 47).padEnd(47)}║`);
  console.log(`║  Source:   ${VERIFIED_SENDER.padEnd(47)}║`);
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

  if (!toAddress || !toAddress.includes('@')) {
    throw new Error('Invalid recipient email address');
  }

  // Safety guard: recipient must never be used as SES Source.
  if (VERIFIED_SENDERS.includes(toAddress)) {
    console.warn('[Eisy Myanmar] Recipient matches a verified sender address; still sending as ToAddresses only');
  }

  logOtpToConsole({ toAddress, otp, purpose });

  const ses = getSesClient();
  if (!ses) {
    console.warn('[Eisy Myanmar] AWS SES credentials not set — OTP logged only, email not sent');
    return { sent: false, provider: 'console' };
  }

  const copy = purposeCopy(purpose);

  const sesParams = {
    Source: VERIFIED_SENDER,
    Destination: {
      ToAddresses: [toAddress],
    },
    Message: {
      Subject: { Data: copy.subject, Charset: 'UTF-8' },
      Body: {
        Html: { Data: buildOtpHtml({ otp, purpose }), Charset: 'UTF-8' },
        Text: { Data: buildOtpText({ otp, purpose }), Charset: 'UTF-8' },
      },
    },
  };

  console.log('[Eisy Myanmar] SES SendEmailCommand params:', JSON.stringify({
    Source: sesParams.Source,
    Destination: sesParams.Destination,
    region: AWS_REGION,
  }));

  try {
    const result = await ses.send(new SendEmailCommand(sesParams));

    console.log(
      `[Eisy Myanmar] OTP email sent via Amazon SES Source=${VERIFIED_SENDER} To=${toAddress} MessageId=${result.MessageId || 'n/a'}`
    );
    return { sent: true, provider: 'ses', id: result.MessageId };
  } catch (err) {
    console.error(
      `[Eisy Myanmar] Amazon SES error Source=${VERIFIED_SENDER} To=${toAddress}:`,
      err.message || err
    );
    throw new Error(err.message || 'Failed to send OTP email');
  }
}

module.exports = { sendOtpEmail, VERIFIED_SENDER, VERIFIED_SENDERS };
