const { mapPublicUser } = require('./profileService');
const OtpCode = require('../models/OtpCode');
const UserSession = require('../models/UserSession');
const TransactionLog = require('../models/TransactionLog');
const crypto = require('crypto');
const { sendOtpEmail } = require('./emailService');
const { devOtpPayload } = require('./devOtp');
const { addMinutes, addDays } = require('../lib/sqliteDatetime');
const { syncUserWalletById } = require('./supabaseSyncService');
const {
  hashPin, verifyPin, generateOtp, generateSessionToken,
  createPinToken, validatePinFormat, normalizeEmail, hashToken,
  isDefaultTestPin, DEFAULT_TEST_PIN,
  hashPassword, verifyPassword, validatePasswordFormat,
  isMasterTestOtp, PIN_TOKEN_TTL_MS,
} = require('./cryptoService');

const OTP_EXPIRY_MINUTES = parseInt(process.env.OTP_EXPIRY_MINUTES || '10', 10);
const SESSION_EXPIRY_DAYS = parseInt(process.env.SESSION_EXPIRY_DAYS || '30', 10);

function otpExpiresAt() {
  return addMinutes(OTP_EXPIRY_MINUTES);
}

function sessionExpiresAt() {
  return addDays(SESSION_EXPIRY_DAYS);
}

function pinTokenMeta() {
  return {
    pin_token_ttl_hours: PIN_TOKEN_TTL_MS / (60 * 60 * 1000),
    expires_in_seconds: Math.floor(PIN_TOKEN_TTL_MS / 1000),
  };
}

const {
  isSyntheticPhone,
  syntheticPhone,
  normalizePhoneInput,
} = require('../lib/phoneUtils');

function mapUserPersistenceError(err) {
  const msg = String(err?.message || err || '');
  if (/users\.email|UNIQUE constraint failed: users\.email/i.test(msg)) {
    const mapped = new Error('Email already registered — switch to Login');
    mapped.code = 'EMAIL_ALREADY_REGISTERED';
    return mapped;
  }
  if (/users\.phone|UNIQUE constraint failed: users\.phone/i.test(msg)) {
    const mapped = new Error('Phone number already registered — use a different number or log in');
    mapped.code = 'PHONE_ALREADY_REGISTERED';
    return mapped;
  }
  if (/NOT NULL constraint failed: users\.phone/i.test(msg)) {
    return new Error('Phone number is required');
  }
  console.error('[auth] User persistence failed:', msg);
  const mapped = new Error('Could not create account — please try again or contact support');
  mapped.code = 'USER_CREATE_FAILED';
  return mapped;
}

async function resolveRegistrationPhone(normalizedEmail, phone) {
  const trimmed = String(phone || '').trim();
  if (trimmed) {
    const normalized = normalizePhoneInput(trimmed);
    const existing = await User.findByPhone(normalized);
    if (existing) {
      const err = new Error('Phone number already registered — use a different number or log in');
      err.code = 'PHONE_ALREADY_REGISTERED';
      throw err;
    }
    return normalized;
  }

  let candidate = syntheticPhone(normalizedEmail);
  if (await User.findByPhone(candidate)) {
    candidate = `e${crypto.randomBytes(6).toString('hex')}`;
  }
  return candidate;
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

  const existing = await User.findByEmail(normalized);
  if (existing) {
    const err = new Error('Email already registered — switch to Login');
    err.code = 'EMAIL_ALREADY_REGISTERED';
    throw err;
  }

  const userPhone = await resolveRegistrationPhone(normalized, phone);
  let user;
  try {
    user = await User.create({
      name: name || normalized.split('@')[0],
      phone: userPhone,
      email: normalized,
      pinHash: hashPin(pin),
    });
  } catch (err) {
    throw mapUserPersistenceError(err);
  }
  await User.verifyEmail(user.id);

  syncUserWalletById(user.id).catch((err) => {
    console.warn('[auth] Supabase wallet sync after register:', err.message);
  });

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

  return {
    user: mapPublicUser(user),
    sessionToken,
    session,
    session_expires_at: session?.expires_at || sessionExpiresAt(),
    pin_token: createPinToken(user.id),
    ...pinTokenMeta(),
  };
}

async function sendLoginOtp(email, ipAddress) {
  const normalized = normalizeEmail(email);
  const user = await User.findByEmail(normalized);
  if (!user) {
    const info = require('../db').getDatabaseInfo();
    console.warn('[auth] login OTP — no user for email:', normalized, 'db:', info.mode, info.warning || info.filePath || info.url);
    throw new Error('No account found for this email');
  }

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

async function loginWithPin({ email, pin, ipAddress, deviceName, devicePlatform }) {
  const normalized = normalizeEmail(email);
  if (!validatePinFormat(pin)) {
    throw new Error('PIN must be exactly 6 digits');
  }

  const user = await User.findByEmail(normalized);
  if (!user) {
    const info = require('../db').getDatabaseInfo();
    console.warn('[auth] PIN login — no user for email:', normalized, 'db:', info.mode, info.warning || info.filePath || info.url);
    throw new Error('No account found for this email');
  }

  if (!user.pin_hash) {
    if (!isDefaultTestPin(pin)) {
      throw new Error('PIN not set for this account. Use email OTP login or the default test PIN 123456.');
    }
    await User.updatePin(user.id, hashPin(DEFAULT_TEST_PIN));
  } else if (!verifyPin(pin, user.pin_hash)) {
    throw new Error('Invalid PIN');
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
    description: 'User logged in via PIN',
    ipAddress,
    createdBy: 'user',
  });

  const freshUser = await User.findById(user.id);
  return {
    user: mapPublicUser(freshUser),
    sessionToken,
    session,
    session_expires_at: session?.expires_at || sessionExpiresAt(),
    has_pin: Boolean(freshUser.pin_hash),
    pin_token: createPinToken(user.id),
    ...pinTokenMeta(),
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
    user: mapPublicUser(freshUser),
    sessionToken,
    session,
    session_expires_at: session?.expires_at || sessionExpiresAt(),
    has_pin: Boolean(freshUser.pin_hash),
    pin_token: createPinToken(user.id),
    ...pinTokenMeta(),
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

  return { pin_token: createPinToken(userId), message: 'PIN set successfully', ...pinTokenMeta() };
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
    has_pin: true,
    ...pinTokenMeta(),
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
    message: 'PIN reset to 123456 — sensitive access unlocked',
    has_pin: true,
    ...pinTokenMeta(),
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
    user: mapPublicUser(user),
    sessionToken,
    session,
    session_expires_at: session?.expires_at || sessionExpiresAt(),
    pin_token: createPinToken(user.id),
    ...pinTokenMeta(),
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
    ...mapPublicUser(user),
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
  loginWithPin,
  setPin,
  verifyPinCode,
  resetPinToDefault,
  changePassword,
  registerBiometrics,
  verifyBiometrics,
  getMe,
  createSession,
};
