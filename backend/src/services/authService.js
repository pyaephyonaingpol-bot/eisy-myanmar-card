const User = require('../models/User');
const OtpCode = require('../models/OtpCode');
const UserSession = require('../models/UserSession');
const TransactionLog = require('../models/TransactionLog');
const { sendOtpEmail } = require('./emailService');
const { devOtpPayload } = require('./devOtp');
const {
  hashPin, verifyPin, generateOtp, generateSessionToken,
  createPinToken, validatePinFormat, normalizeEmail, hashToken,
  isDefaultTestPin, DEFAULT_TEST_PIN,
  hashPassword, verifyPassword, validatePasswordFormat,
  isMasterTestOtp,
} = require('./cryptoService');

const OTP_EXPIRY_MINUTES = parseInt(process.env.OTP_EXPIRY_MINUTES || '10', 10);
const SESSION_EXPIRY_DAYS = parseInt(process.env.SESSION_EXPIRY_DAYS || '30', 10);

function otpExpiresAt() {
  const d = new Date();
  d.setMinutes(d.getMinutes() + OTP_EXPIRY_MINUTES);
  return d.toISOString();
}

function sessionExpiresAt() {
  const d = new Date();
  d.setDate(d.getDate() + SESSION_EXPIRY_DAYS);
  return d.toISOString();
}

function syntheticPhone(email) {
  return `e.${email.replace(/[^a-z0-9]/gi, '').slice(0, 20)}`;
}

async function sendRegistrationOtp(email, ipAddress) {
  const normalized = normalizeEmail(email);
  const existing = await User.findByEmail(normalized);
  if (existing) {
    throw new Error('Email already registered');
  }

  const otp = generateOtp();
  await OtpCode.create({
    email: normalized,
    otpCode: otp,
    purpose: 'register',
    expiresAt: otpExpiresAt(),
    ipAddress,
  });

  await sendOtpEmail({ email: normalized, otp, purpose: 'register' });

  return {
    email: normalized,
    expires_in_minutes: OTP_EXPIRY_MINUTES,
    ...devOtpPayload(otp),
  };
}

async function completeRegistration({ email, otp, name, phone, pin, ipAddress, deviceName, devicePlatform }) {
  const normalized = normalizeEmail(email);
  if (!validatePinFormat(pin)) {
    throw new Error('PIN must be exactly 6 digits');
  }

  const record = await OtpCode.findLatestValid(normalized, 'register');
  if (!isMasterTestOtp(otp)) {
    if (!record) throw new Error('OTP expired or not found');
    if (record.otp_code !== otp) {
      await OtpCode.incrementAttempts(record.id);
      throw new Error('Invalid OTP');
    }
  }
  if (record) {
    await OtpCode.markVerified(record.id);
  }

  const userPhone = phone || syntheticPhone(normalized);
  const user = await User.create({
    name: name || normalized.split('@')[0],
    phone: userPhone,
    email: normalized,
    pinHash: hashPin(pin),
  });
  await User.verifyEmail(user.id);

  const { sessionToken, session } = await createSession({
    userId: user.id,
    ipAddress,
    deviceName,
    devicePlatform,
  });

  await TransactionLog.create({
    userId: user.id,
    type: 'login',
    description: 'User registered and logged in',
    ipAddress,
    createdBy: 'user',
  });

  return { user: User.stripPrivate(user), sessionToken, session, pin_token: createPinToken(user.id) };
}

async function sendLoginOtp(email, ipAddress) {
  const normalized = normalizeEmail(email);
  const user = await User.findByEmail(normalized);
  if (!user) throw new Error('No account found for this email');

  const otp = generateOtp();
  await OtpCode.create({
    userId: user.id,
    email: normalized,
    otpCode: otp,
    purpose: 'login',
    expiresAt: otpExpiresAt(),
    ipAddress,
  });

  await sendOtpEmail({ email: normalized, otp, purpose: 'login' });
  return {
    email: normalized,
    expires_in_minutes: OTP_EXPIRY_MINUTES,
    ...devOtpPayload(otp),
  };
}

async function verifyLoginOtp({ email, otp, ipAddress, deviceName, devicePlatform }) {
  const normalized = normalizeEmail(email);
  const user = await User.findByEmail(normalized);
  if (!user) throw new Error('No account found');

  const record = await OtpCode.findLatestValid(normalized, 'login');
  if (!isMasterTestOtp(otp)) {
    if (!record) throw new Error('OTP expired or not found');
    if (record.otp_code !== otp) {
      await OtpCode.incrementAttempts(record.id);
      throw new Error('Invalid OTP');
    }
  }
  if (record) {
    await OtpCode.markVerified(record.id);
  }
  await User.recordLogin(user.id);

  const { sessionToken, session } = await createSession({
    userId: user.id,
    ipAddress,
    deviceName,
    devicePlatform,
  });

  await TransactionLog.create({
    userId: user.id,
    type: 'login',
    description: 'User logged in via email OTP',
    ipAddress,
    createdBy: 'user',
  });

  const freshUser = await User.findById(user.id);
  return {
    user: User.stripPrivate(freshUser),
    sessionToken,
    session,
    has_pin: Boolean(freshUser.pin_hash),
    pin_token: freshUser.pin_hash ? null : null,
  };
}

async function createSession({ userId, ipAddress, deviceName, devicePlatform }) {
  const sessionToken = generateSessionToken();
  const session = await UserSession.create({
    userId,
    sessionToken,
    ipAddress,
    deviceName,
    devicePlatform,
    expiresAt: sessionExpiresAt(),
  });
  return { sessionToken, session };
}

async function setPin(userId, pin, confirmPin) {
  if (!validatePinFormat(pin)) throw new Error('PIN must be exactly 6 digits');
  if (pin !== confirmPin) throw new Error('PIN confirmation does not match');

  await User.updatePin(userId, hashPin(pin));
  await TransactionLog.create({
    userId,
    type: 'pin_set',
    description: 'Security PIN set or updated',
    createdBy: 'user',
  });

  return { pin_token: createPinToken(userId), message: 'PIN set successfully' };
}

async function verifyPinCode(userId, pin) {
  if (!validatePinFormat(pin)) {
    throw new Error('PIN must be exactly 6 digits');
  }

  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');

  if (!user.pin_hash) {
    if (!isDefaultTestPin(pin)) {
      throw new Error('PIN not set up yet. Use 123456 or 000000 for testing, or set a PIN in Settings.');
    }
    await User.updatePin(userId, hashPin(DEFAULT_TEST_PIN));
    await TransactionLog.create({
      userId,
      type: 'pin_set',
      description: 'Default test PIN applied on first unlock',
      createdBy: 'user',
      metadata: { default_test_pin: true },
    });
  } else if (!verifyPin(pin, user.pin_hash)) {
    throw new Error('Invalid PIN');
  }

  await TransactionLog.create({
    userId,
    type: 'otp_verified',
    description: 'Security PIN verified for sensitive access',
    createdBy: 'user',
  });

  return {
    pin_token: createPinToken(userId),
    expires_in_seconds: 15 * 60,
    has_pin: true,
  };
}

async function resetPinToDefault(userId) {
  await User.updatePin(userId, hashPin(DEFAULT_TEST_PIN));
  await TransactionLog.create({
    userId,
    type: 'pin_set',
    description: 'Security PIN reset to default test PIN (123456)',
    createdBy: 'user',
    metadata: { default_test_pin: true, reset: true },
  });

  return {
    pin_token: createPinToken(userId),
    expires_in_seconds: 15 * 60,
    message: 'PIN reset to 123456 — sensitive access unlocked',
    has_pin: true,
  };
}

async function registerBiometrics(userId, deviceToken, deviceName) {
  if (!deviceToken || deviceToken.length < 16) {
    throw new Error('Invalid biometric device token');
  }

  await User.setBiometricsToken(userId, hashToken(deviceToken), true);
  await TransactionLog.create({
    userId,
    type: 'biometric_registered',
    description: `Biometrics registered${deviceName ? `: ${deviceName}` : ''}`,
    metadata: { device_name: deviceName },
    createdBy: 'user',
  });

  return { message: 'Biometrics registered', biometrics_enabled: true };
}

async function verifyBiometrics(email, deviceToken, ipAddress, deviceName, devicePlatform) {
  const normalized = normalizeEmail(email);
  const user = await User.findByEmail(normalized);
  if (!user) throw new Error('Account not found');
  if (!user.biometrics_enabled || !user.biometrics_token_hash) {
    throw new Error('Biometrics not enabled for this account');
  }

  const tokenHash = hashToken(deviceToken);
  if (tokenHash !== user.biometrics_token_hash) {
    throw new Error('Biometric verification failed');
  }

  await User.recordLogin(user.id);
  const { sessionToken, session } = await createSession({
    userId: user.id,
    ipAddress,
    deviceName,
    devicePlatform,
  });

  await TransactionLog.create({
    userId: user.id,
    type: 'login',
    description: 'User logged in via biometrics',
    ipAddress,
    createdBy: 'user',
  });

  return {
    user: User.stripPrivate(user),
    sessionToken,
    session,
    pin_token: createPinToken(user.id),
  };
}

async function changePassword(userId, { currentPassword, newPassword, confirmPassword }) {
  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');

  const next = String(newPassword || '');
  const confirm = String(confirmPassword || '');
  if (!next) throw new Error('New password is required');
  if (next !== confirm) throw new Error('New password and confirmation do not match');

  const format = validatePasswordFormat(next);
  if (!format.ok) throw new Error(format.error);

  if (user.password_hash) {
    const current = String(currentPassword || '');
    if (!current) throw new Error('Current password is required');
    if (!verifyPassword(current, user.password_hash)) {
      throw new Error('Current password is incorrect');
    }
    if (verifyPassword(next, user.password_hash)) {
      throw new Error('New password must be different from your current password');
    }
  }

  await User.updatePassword(userId, hashPassword(next));
  await TransactionLog.create({
    userId,
    type: 'password_changed',
    description: user.password_hash ? 'Account password changed' : 'Account password set',
    createdBy: 'user',
  });

  return { message: 'Password updated successfully', has_password: true };
}

async function getMe(userId) {
  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');
  return {
    ...User.stripPrivate(user),
    has_pin: Boolean(user.pin_hash),
    has_password: Boolean(user.password_hash),
    kyc_status: (user.kyc_status || 'UNVERIFIED').toUpperCase(),
    is_kyc_verified: (user.kyc_status || '').toUpperCase() === 'VERIFIED',
  };
}

module.exports = {
  sendRegistrationOtp,
  completeRegistration,
  sendLoginOtp,
  verifyLoginOtp,
  setPin,
  verifyPinCode,
  resetPinToDefault,
  changePassword,
  registerBiometrics,
  verifyBiometrics,
  getMe,
  createSession,
};
