/**
 * Development OTP exposure — never enable in production / Vercel.
 * Set DEV_SHOW_OTP=true explicitly for local testing only.
 */
function isDevOtpExposed() {
  const nodeEnv = String(process.env.NODE_ENV || '').toLowerCase();
  if (nodeEnv === 'production') return false;
  if (process.env.VERCEL === '1' || process.env.VERCEL_ENV === 'production') return false;
  // Opt-in only (was previously on by default in non-production).
  return ['1', 'true', 'yes', 'on'].includes(
    String(process.env.DEV_SHOW_OTP || '').trim().toLowerCase()
  );
}

function devOtpPayload(otp) {
  if (!isDevOtpExposed()) return {};
  return {
    dev_otp: otp,
    dev_mode: true,
    dev_message: 'Development mode: OTP shown for testing only',
  };
}

module.exports = { isDevOtpExposed, devOtpPayload };
