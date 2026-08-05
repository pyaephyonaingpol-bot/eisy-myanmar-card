/**
 * Development OTP exposure — never enable in production.
 * Set DEV_SHOW_OTP=false to hide OTP from API responses (console still logs in dev).
 */
function isDevOtpExposed() {
  if (process.env.NODE_ENV === 'production') return false;
  if (process.env.DEV_SHOW_OTP === 'false') return false;
  return true;
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
