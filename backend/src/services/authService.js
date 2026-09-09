const User = require('../models/User');
const { mapPublicUser } = require('./profileService');
const OtpCode = require('../models/OtpCode');
const UserSession = require('../models/UserSession');
const TransactionLog = require('../models/TransactionLog');
const { assertUserNotBlocked } = require('../lib/userAuthStatus');
const crypto = require('crypto');
const { dispatchOtpEmail } = require('./emailService');
const { devOtpPayload } = require('./devOtp');
const { addMinutes, addDays } = require('../lib/sqliteDatetime');
const { syncUserWalletById, ensureSupabaseUserWalletInBackground } = require('./supabaseSyncService');
const {
  hashPin, hashPinAsync, verifyPin, verifyPinAsync, generateOtp, generateSessionToken,
  createPinToken, validatePinFormat, normalizeEmail, hashToken,
  isDefaultTestPin, DEFAULT_TEST_PIN,
  hashPassword, verifyPassword, verifyPasswordAsync, validatePasswordFormat,
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

/** Stamp last_login_at in-memory so mapPublicUser stays fresh without a re-SELECT. */
function stampLoginLocally(user) {
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  user.last_login_at = now;
  user.updated_at = now;
  return user;
}

function logLoginEvent(payload) {
  TransactionLog.create(payload).catch((err) => {
    console.warn('[auth] login transaction log skipped:', err.message);
  });
}

/**
 * Parallelize session create + last_login update; keep ledger + Supabase off the critical path.
 */
async function finalizeLoginSession({
  user,
  ipAddress,
  deviceName,
  devicePlatform,
  logDescription,
  logMetadata = null,
  includePinToken = true,
}) {
  const [{ sessionToken, session }] = await Promise.all([
    createSession({
      userId: user.id,
      ipAddress,
      deviceName,
      devicePlatform,
    }),
    User.recordLogin(user.id),
  ]);

  stampLoginLocally(user);

  logLoginEvent({
    userId: user.id,
    type: 'login',
    description: logDescription,
    ipAddress,
    createdBy: 'user',
    metadata: logMetadata,
  });

  ensureSupabaseUserWalletInBackground(user.id);

  const hasPin = Boolean(user.pin_hash);
  const result = {
    user: mapPublicUser(user),
    sessionToken,
    session,
    session_expires_at: session?.expires_at || sessionExpiresAt(),
    has_pin: hasPin,
    ...pinTokenMeta(),
  };
  if (includePinToken && hasPin) {
    result.pin_token = createPinToken(user.id);
  }
  return result;
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

  // Do not block the HTTP response on Resend RTT — dispatch immediately after persist.
  dispatchOtpEmail({ email: normalized, otp, purpose: 'register' });

  return {
    email: normalized,
    expires_in_minutes: OTP_EXPIRY_MINUTES,
    email_queued: true,
    ...devOtpPayload(otp),
  };
}

async function completeRegistration({ email, otp, name, phone, pin, ipAddress, deviceName, devicePlatform }) {
  const normalized = normalizeEmail(email);
  const pinValue = pin != null && String(pin).trim() !== '' ? String(pin).trim() : null;
  if (pinValue && !validatePinFormat(pinValue)) {
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
      pinHash: pinValue ? hashPin(pinValue) : null,
    });
  } catch (err) {
    throw mapUserPersistenceError(err);
  }
  await User.verifyEmail(user.id);

  ensureSupabaseUserWalletInBackground(user.id, { syncIfExists: false });
  try {
    const { provisionDepositAddressInBackground } = require('./tronWalletService');
    provisionDepositAddressInBackground(user.id);
  } catch (err) {
    console.warn('[auth] TRON address provision hook failed:', err.message);
  }

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

  const hasPin = Boolean(pinValue);
  const result = {
    user: mapPublicUser(user),
    sessionToken,
    session,
    session_expires_at: session?.expires_at || sessionExpiresAt(),
    has_pin: hasPin,
    needs_pin_setup: !hasPin,
    ...pinTokenMeta(),
  };
  if (hasPin) {
    result.pin_token = createPinToken(user.id);
  }
  return result;
}

async function sendLoginOtp(email, ipAddress) {
  const normalized = normalizeEmail(email);
  const user = await User.findByEmail(normalized);
  if (!user) {
    const info = require('../db').getDatabaseInfo();
    console.warn('[auth] login OTP — no user for email:', normalized, 'db:', info.mode, info.warning || info.filePath || info.url);
    throw new Error('No account found for this email');
  }

  assertUserNotBlocked(user, { action: 'log in' });

  const otp = generateOtp();
  await OtpCode.create({
    userId: user.id,
    email: normalized,
    otpCode: otp,
    purpose: 'login',
    expiresAt: otpExpiresAt(),
    ipAddress,
  });

  dispatchOtpEmail({ email: normalized, otp, purpose: 'login' });
  return {
    email: normalized,
    expires_in_minutes: OTP_EXPIRY_MINUTES,
    email_queued: true,
    ...devOtpPayload(otp),
  };
}

async function loginWithPin({ email, pin, ipAddress, deviceName, devicePlatform }) {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    const err = new Error('Email is required');
    err.code = 'EMAIL_REQUIRED';
    throw err;
  }
  if (!validatePinFormat(pin)) {
    const err = new Error('PIN must be exactly 6 digits');
    err.code = 'INVALID_PIN_FORMAT';
    throw err;
  }

  const user = await User.findByEmail(normalized);
  if (!user) {
    const info = require('../db').getDatabaseInfo();
    console.warn('[auth] PIN login — no user for email:', normalized, 'db:', info.mode, info.warning || info.filePath || info.url);
    const err = new Error('No account found for this email. Register first or use email OTP after signing up.');
    err.code = 'USER_NOT_FOUND';
    throw err;
  }

  assertUserNotBlocked(user, { action: 'log in' });

  if (!user.pin_hash) {
    if (!isDefaultTestPin(pin)) {
      const err = new Error('PIN not set for this account. Use email OTP login or the default test PIN 123456.');
      err.code = 'PIN_NOT_SET';
      throw err;
    }
    const pinHash = await hashPinAsync(DEFAULT_TEST_PIN);
    await User.updatePin(user.id, pinHash);
    user.pin_hash = pinHash;
  } else if (!(await verifyPinAsync(pin, user.pin_hash))) {
    const err = new Error('Invalid PIN');
    err.code = 'INVALID_PIN';
    throw err;
  }

  return finalizeLoginSession({
    user,
    ipAddress,
    deviceName,
    devicePlatform,
    logDescription: 'User logged in via PIN',
  });
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
  assertUserNotBlocked(user, { action: 'log in' });

  if (record) {
    await OtpCode.markVerified(record.id);
  }

  return finalizeLoginSession({
    user,
    ipAddress,
    deviceName,
    devicePlatform,
    logDescription: 'User logged in via email OTP',
  });
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

  // Keep the mirrored Supabase profile/wallet row fresh after PIN setup.
  ensureSupabaseUserWalletInBackground(userId, { syncIfExists: true });

  return {
    pin_token: createPinToken(userId),
    message: 'PIN set successfully',
    has_pin: true,
    ...pinTokenMeta(),
  };
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
  const { isProductionRuntime } = require('./securityFlags');
  if (isProductionRuntime()) {
    const err = new Error('Default PIN reset is disabled. Use email OTP to reset your PIN.');
    err.code = 'PIN_RESET_EMAIL_REQUIRED';
    throw err;
  }

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

async function sendPinResetOtp(email, ipAddress) {
  const normalized = normalizeEmail(email);
  if (!normalized) throw new Error('Email is required');
  const user = await User.findByEmail(normalized);
  if (!user) {
    // Do not reveal whether the account exists.
    return {
      email: normalized,
      expires_in_minutes: OTP_EXPIRY_MINUTES,
      message: 'If an account exists for that email, a PIN reset code was sent.',
    };
  }

  assertUserNotBlocked(user, { action: 'reset PIN' });

  const otp = generateOtp();
  await OtpCode.create({
    userId: user.id,
    email: normalized,
    otpCode: otp,
    purpose: 'reset_pin',
    expiresAt: otpExpiresAt(),
    ipAddress,
  });
  dispatchOtpEmail({ email: normalized, otp, purpose: 'reset_pin' });

  return {
    email: normalized,
    expires_in_minutes: OTP_EXPIRY_MINUTES,
    message: 'PIN reset code sent to your email',
    email_queued: true,
    ...devOtpPayload(otp),
  };
}

async function completePinReset({ email, otp, pin, confirmPin, ipAddress, deviceName, devicePlatform }) {
  const normalized = normalizeEmail(email);
  if (!normalized) throw new Error('Email is required');
  if (!validatePinFormat(pin)) throw new Error('PIN must be exactly 6 digits');
  if (pin !== confirmPin) throw new Error('PIN confirmation does not match');

  const user = await User.findByEmail(normalized);
  if (!user) throw new Error('Invalid or expired reset code');

  assertUserNotBlocked(user, { action: 'reset PIN' });

  const record = await OtpCode.findLatestValid(normalized, 'reset_pin');
  if (!isMasterTestOtp(otp)) {
    if (!record) throw new Error('OTP expired or not found');
    if (record.otp_code !== otp) {
      await OtpCode.incrementAttempts(record.id);
      throw new Error('Invalid OTP');
    }
  }
  if (record) await OtpCode.markVerified(record.id);

  await User.updatePin(user.id, hashPin(pin));
  ensureSupabaseUserWalletInBackground(user.id, { syncIfExists: true });

  await TransactionLog.create({
    userId: user.id,
    type: 'pin_set',
    description: 'Security PIN reset via email OTP',
    ipAddress,
    createdBy: 'user',
    metadata: { reset_via: 'email_otp' },
  });

  const { sessionToken, session } = await createSession({
    userId: user.id,
    ipAddress,
    deviceName,
    devicePlatform,
  });

  const freshUser = await User.findById(user.id);
  return {
    user: mapPublicUser(freshUser),
    sessionToken,
    session,
    session_expires_at: session?.expires_at || sessionExpiresAt(),
    pin_token: createPinToken(user.id),
    has_pin: true,
    message: 'PIN updated successfully',
    ...pinTokenMeta(),
  };
}

async function sendPasswordResetOtp(email, ipAddress) {
  const normalized = normalizeEmail(email);
  if (!normalized) throw new Error('Email is required');
  const user = await User.findByEmail(normalized);
  if (!user) {
    return {
      email: normalized,
      expires_in_minutes: OTP_EXPIRY_MINUTES,
      message: 'If an account exists for that email, a password reset code was sent.',
    };
  }

  assertUserNotBlocked(user, { action: 'reset password' });

  const otp = generateOtp();
  await OtpCode.create({
    userId: user.id,
    email: normalized,
    otpCode: otp,
    purpose: 'reset_password',
    expiresAt: otpExpiresAt(),
    ipAddress,
  });
  dispatchOtpEmail({ email: normalized, otp, purpose: 'reset_password' });

  return {
    email: normalized,
    expires_in_minutes: OTP_EXPIRY_MINUTES,
    message: 'Password reset code sent to your email',
    email_queued: true,
    ...devOtpPayload(otp),
  };
}

async function completePasswordReset({ email, otp, newPassword, confirmPassword }) {
  const normalized = normalizeEmail(email);
  if (!normalized) throw new Error('Email is required');

  const next = String(newPassword || '');
  const confirm = String(confirmPassword || '');
  if (!next) throw new Error('New password is required');
  if (next !== confirm) throw new Error('New password and confirmation do not match');
  const format = validatePasswordFormat(next);
  if (!format.ok) throw new Error(format.error);

  const user = await User.findByEmail(normalized);
  if (!user) throw new Error('Invalid or expired reset code');

  assertUserNotBlocked(user, { action: 'reset password' });

  const record = await OtpCode.findLatestValid(normalized, 'reset_password');
  if (!isMasterTestOtp(otp)) {
    if (!record) throw new Error('OTP expired or not found');
    if (record.otp_code !== otp) {
      await OtpCode.incrementAttempts(record.id);
      throw new Error('Invalid OTP');
    }
  }
  if (record) await OtpCode.markVerified(record.id);

  await User.updatePassword(user.id, hashPassword(next));
  ensureSupabaseUserWalletInBackground(user.id, { syncIfExists: true });

  await TransactionLog.create({
    userId: user.id,
    type: 'password_changed',
    description: 'Account password reset via email OTP',
    createdBy: 'user',
    metadata: { reset_via: 'email_otp' },
  });

  return {
    message: 'Password updated successfully',
    has_password: true,
    email: normalized,
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

  assertUserNotBlocked(user, { action: 'log in' });

  const tokenHash = hashToken(deviceToken);
  if (tokenHash !== user.biometrics_token_hash) {
    throw new Error('Biometric verification failed');
  }

  return finalizeLoginSession({
    user,
    ipAddress,
    deviceName,
    devicePlatform,
    logDescription: 'User logged in via biometrics',
  });
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

  ensureSupabaseUserWalletInBackground(userId);

  return {
    ...mapPublicUser(user),
    has_pin: Boolean(user.pin_hash),
    has_password: Boolean(user.password_hash),
    kyc_status: (user.kyc_status || 'UNVERIFIED').toUpperCase(),
    is_kyc_verified: (user.kyc_status || '').toUpperCase() === 'VERIFIED',
  };
}

const GOOGLE_TOKEN_VERIFY_TIMEOUT_MS = parseInt(
  process.env.GOOGLE_TOKEN_VERIFY_TIMEOUT_MS || '2500',
  10
);

function decodeJwtPayloadUnsafe(token) {
  const parts = String(token || '').split('.');
  if (parts.length < 2) return null;
  try {
    const json = Buffer.from(parts[1], 'base64url').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * Prefer local HS256 verify with SUPABASE_JWT_SECRET (no network).
 * Fall back to a single timed auth.getUser — never dual remote round-trips.
 */
async function verifySupabaseAccessToken(accessToken) {
  const token = String(accessToken || '').trim();
  const { firstEnv } = require('../lib/envAliases');
  const jwtSecret = String(
    firstEnv('SUPABASE_JWT_SECRET', 'JWT_SECRET_SUPABASE') || ''
  ).trim();

  if (jwtSecret) {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('Malformed Supabase access token');
    const [headerB64, payloadB64, sigB64] = parts;
    const data = `${headerB64}.${payloadB64}`;
    const expected = crypto
      .createHmac('sha256', jwtSecret)
      .update(data)
      .digest();
    let sigBuf;
    try {
      sigBuf = Buffer.from(sigB64, 'base64url');
    } catch {
      throw new Error('Invalid Supabase access token encoding');
    }
    if (sigBuf.length !== expected.length || !crypto.timingSafeEqual(sigBuf, expected)) {
      throw new Error('Invalid Supabase access token signature');
    }
    const payload = decodeJwtPayloadUnsafe(token);
    if (!payload?.sub) throw new Error('Supabase token missing subject');
    if (payload.exp && Date.now() / 1000 > Number(payload.exp)) {
      throw new Error('Supabase access token expired');
    }
    return {
      id: payload.sub,
      email: payload.email || payload.user_metadata?.email || null,
      user_metadata: payload.user_metadata || {},
      app_metadata: payload.app_metadata || {},
    };
  }

  const { getSupabase } = require('../lib/supabase');
  const admin = getSupabase();
  if (!admin?.auth?.getUser) {
    throw new Error('Supabase Auth client unavailable');
  }

  const timeoutMs = Math.max(800, GOOGLE_TOKEN_VERIFY_TIMEOUT_MS);
  let timer = null;
  const { data, error } = await Promise.race([
    admin.auth.getUser(token),
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        const err = new Error(`Supabase auth.getUser timed out after ${timeoutMs}ms`);
        err.code = 'GOOGLE_TOKEN_TIMEOUT';
        reject(err);
      }, timeoutMs);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
  if (error) throw error;
  if (!data?.user) throw new Error('Supabase Auth returned no user');
  return data.user;
}

async function loginWithGoogleOAuth({
  accessToken,
  ipAddress,
  deviceName,
  devicePlatform,
}) {
  const token = String(accessToken || '').trim();
  if (!token) {
    const err = new Error('Google access token is required');
    err.code = 'GOOGLE_TOKEN_REQUIRED';
    throw err;
  }

  const { isPublicSupabaseEnabled } = require('../lib/supabase');
  if (!isPublicSupabaseEnabled()) {
    const err = new Error('Google Sign-In is not configured on this server');
    err.code = 'GOOGLE_NOT_CONFIGURED';
    throw err;
  }

  // Verify Supabase Auth JWT locally when possible; otherwise a single remote getUser.
  let supabaseUser = null;
  try {
    supabaseUser = await verifySupabaseAccessToken(token);
  } catch (err) {
    console.warn('[auth] Google token verify failed:', err.message);
    const mapped = new Error('Google Sign-In could not be verified. Please try again.');
    mapped.code = err.code || 'GOOGLE_TOKEN_INVALID';
    throw mapped;
  }

  const email = normalizeEmail(supabaseUser?.email);
  if (!email) {
    const err = new Error('Google account did not provide an email address');
    err.code = 'GOOGLE_EMAIL_REQUIRED';
    throw err;
  }

  const meta = supabaseUser.user_metadata || {};
  const displayName = String(
    meta.full_name || meta.name || [meta.given_name, meta.family_name].filter(Boolean).join(' ') || ''
  ).trim() || email.split('@')[0];

  let user = await User.findByEmail(email);
  let created = false;
  if (!user) {
    try {
      const phone = await resolveRegistrationPhone(email, null);
      user = await User.create({
        name: displayName,
        phone,
        email,
        pinHash: null,
      });
      await User.verifyEmail(user.id);
      user.email_verified = 1;
      created = true;
      ensureSupabaseUserWalletInBackground(user.id, { syncIfExists: false });
      try {
        const { provisionDepositAddressInBackground } = require('./tronWalletService');
        provisionDepositAddressInBackground(user.id);
      } catch (err) {
        console.warn('[auth] TRON address provision hook failed:', err.message);
      }
    } catch (err) {
      throw mapUserPersistenceError(err);
    }
  } else {
    assertUserNotBlocked(user, { action: 'log in' });
    if (!user.email_verified) {
      await User.verifyEmail(user.id);
      user.email_verified = 1;
    }
  }

  const result = await finalizeLoginSession({
    user,
    ipAddress,
    deviceName,
    devicePlatform,
    logDescription: created ? 'User registered via Google OAuth' : 'User logged in via Google OAuth',
    logMetadata: {
      provider: 'google',
      supabase_user_id: supabaseUser.id || null,
      created,
    },
    includePinToken: Boolean(user.pin_hash),
  });
  result.created = created;
  result.needs_pin_setup = !result.has_pin;
  return result;
}

module.exports = {
  sendRegistrationOtp,
  completeRegistration,
  sendLoginOtp,
  verifyLoginOtp,
  loginWithPin,
  loginWithGoogleOAuth,
  setPin,
  verifyPinCode,
  resetPinToDefault,
  sendPinResetOtp,
  completePinReset,
  sendPasswordResetOtp,
  completePasswordReset,
  changePassword,
  registerBiometrics,
  verifyBiometrics,
  getMe,
  createSession,
};
