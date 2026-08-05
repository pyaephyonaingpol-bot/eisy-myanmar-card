/**
 * Email service — logs OTP to console in development.
 * Replace with SendGrid/SES/Nodemailer in production.
 */
const { isDevOtpExposed } = require('./devOtp');

function sendOtpEmail({ email, otp, purpose }) {
  const label = {
    register: 'Registration',
    login: 'Login',
    reset_pin: 'PIN Reset',
    verify_email: 'Email Verification',
  }[purpose] || purpose;

  console.log('\n========================================');
  console.log(`[Eisy Myanmar] EMAIL OTP — ${label}`);
  console.log(`  To:      ${email}`);
  console.log(`  Code:    ${otp}`);
  console.log(`  Expires: ${process.env.OTP_EXPIRY_MINUTES || 10} minutes`);
  if (isDevOtpExposed()) {
    console.log('  (Also returned in API response as dev_otp for UI testing)');
  }
  console.log('========================================\n');

  return { sent: true, provider: 'console' };
}

module.exports = { sendOtpEmail };
