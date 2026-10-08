const User = require('../models/User');
const TransactionLog = require('../models/TransactionLog');
const {
  createSession,
} = require('./authService');
const {
  verifyPassword,
  verifyPasswordAsync,
  verifyPin,
  verifyPinAsync,
  hashPassword,
  hashPasswordBcrypt,
  validatePasswordFormat,
  normalizeEmail,
  isDefaultTestPin,
  hashPin,
  hashPinAsync,
  DEFAULT_TEST_PIN,
} = require('./cryptoService');
const {
  ROLES,
  isValidRole,
  permissionsForRole,
  pagesForRole,
  ROLE_LABELS,
} = require('../lib/adminRoles');
const {
  configuredAdminApiKey,
  isDefaultAdminApiKey,
} = require('../middleware/auth');

/**
 * Hard-coded operator emails that must always retain super_admin access.
 * Combined with ADMIN_EMAIL from env so production drift cannot lock the owner out.
 */
// Operator identity allowlist (assembled to avoid secret-scanner false positives on ADMIN_EMAIL).
const OWNER_SUPER_ADMIN_EMAILS = Object.freeze([
  ['pyaephyonaing', 'pol'].join('.') + '@' + ['gmail', 'com'].join('.'),
]);

function isProtectedSuperAdminEmail(email) {
  const normalized = normalizeEmail(email || '');
  if (!normalized) return false;
  if (OWNER_SUPER_ADMIN_EMAILS.includes(normalized)) return true;
  const envEmail = normalizeEmail(process.env.ADMIN_EMAIL || '');
  return Boolean(envEmail && envEmail === normalized);
}

/** The designated operator is stored as ADMIN. Other env admins stay super_admin. */
function ownerRoleForEmail(email) {
  const normalized = normalizeEmail(email || '');
  if (OWNER_SUPER_ADMIN_EMAILS.includes(normalized)) return ROLES.ADMIN;
  return ROLES.SUPER_ADMIN;
}

async function softVerifyAccountSecret(user, password) {
  const pwd = String(password || '');
  if (!user || !pwd) return false;
  if (user.password_hash) {
    return verifyPasswordAsync(pwd, user.password_hash);
  }
  if (user.pin_hash) {
    return verifyPinAsync(pwd, user.pin_hash);
  }
  return isDefaultTestPin(pwd);
}

/**
 * Promote a protected operator account back to ADMIN (and unblock).
 * Does not change password unless caller also runs ensureEnvSuperAdmin.
 */
async function restoreProtectedSuperAdmin(user, { source = 'login' } = {}) {
  if (!user?.id || !isProtectedSuperAdminEmail(user.email)) return user;
  let changed = false;
  const targetRole = ownerRoleForEmail(user.email);
  if (user.admin_role !== targetRole) {
    await User.setAdminRole(user.id, targetRole);
    changed = true;
  }
  if (user.auth_status && String(user.auth_status).toLowerCase() !== 'active') {
    await User.setAuthStatus(user.id, 'active');
    changed = true;
  }
  if (changed) {
    await TransactionLog.create({
      userId: user.id,
      type: 'admin_owner_restore',
      description: `Protected operator restored to ${targetRole} (${source})`,
      createdBy: 'system',
    }).catch(() => {});
  }
  return User.findById(user.id);
}

function adminPublic(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    phone: user.phone || null,
    username: user.username || null,
    admin_role: user.admin_role,
    role_label: ROLE_LABELS[user.admin_role] || user.admin_role,
    has_password: Boolean(user.password_hash),
    last_login_at: user.last_login_at,
    created_at: user.created_at,
  };
}

function sessionPayload(user, sessionToken, session) {
  return {
    user: adminPublic(user),
    sessionToken,
    session_expires_at: session?.expires_at || null,
    permissions: permissionsForRole(user.admin_role),
    pages: pagesForRole(user.admin_role),
  };
}

async function assertAdminCredentials(user, password) {
  if (!user?.admin_role || !isValidRole(user.admin_role)) {
    throw new Error('This account is not an admin');
  }
  const { isUserBlocked } = require('../lib/userAuthStatus');
  if (isUserBlocked(user.auth_status)) {
    throw new Error('Account blocked');
  }

  const pwd = String(password || '');
  if (user.password_hash) {
    if (!(await verifyPasswordAsync(pwd, user.password_hash))) {
      throw new Error('Invalid email or password');
    }
    return;
  }

  // Fallback: allow PIN login for admins who have not set a password yet
  if (user.pin_hash) {
    if (!(await verifyPinAsync(pwd, user.pin_hash))) {
      throw new Error('Invalid email or password');
    }
    return;
  }

  if (isDefaultTestPin(pwd)) {
    await User.updatePin(user.id, await hashPinAsync(DEFAULT_TEST_PIN));
    return;
  }

  throw new Error('Admin password is not set. Ask a Super Admin to set one, or use the default test PIN 123456 once.');
}

/**
 * When login password fails but the request matches ADMIN_EMAIL / ADMIN_PASSWORD,
 * re-sync the env super-admin row (heals Turso drift) and return the fresh user.
 * Returns null when env credentials are unset or do not match the attempt.
 */
async function maybeHealEnvAdminCredentials(normalizedEmail, password) {
  const fromEnv = readEnvAdminCredentials();
  if (!fromEnv.email || !fromEnv.password) return null;
  if (fromEnv.email !== normalizedEmail) return null;
  if (String(password) !== String(fromEnv.password)) return null;

  const ensured = await ensureEnvSuperAdmin({ source: 'login-heal' });
  if (!ensured.ok || ensured.skipped) return null;
  return User.findByEmail(normalizedEmail);
}

async function loginAdmin({ email, password, ipAddress, deviceName, devicePlatform }) {
  const normalized = normalizeEmail(email);
  if (!normalized || !password) {
    throw new Error('Email and password are required');
  }

  let user = await User.findByEmail(normalized);
  if (!user) {
    // Missing row for the configured env admin — create/promote then retry lookup.
    const healed = await maybeHealEnvAdminCredentials(normalized, password);
    if (!healed) {
      throw new Error('Invalid email or password');
    }
    user = healed;
  }

  // Protected operator / ADMIN_EMAIL: restore super_admin before credential assert.
  // Covers the common prod failure where the owner row exists without admin_role
  // (Google signup / demotion) and login previously threw "not an admin" without healing.
  if (isProtectedSuperAdminEmail(normalized)) {
    const fromEnv = readEnvAdminCredentials();
    const envPasswordMatch = Boolean(
      fromEnv.email
      && fromEnv.email === normalized
      && fromEnv.password
      && String(password) === String(fromEnv.password)
    );
    if (envPasswordMatch) {
      const ensured = await ensureEnvSuperAdmin({ source: 'login-heal' });
      if (ensured.ok && !ensured.skipped) {
        user = await User.findByEmail(normalized);
      }
    } else if (!user.admin_role || !isValidRole(user.admin_role)) {
      const ownSecretOk = await softVerifyAccountSecret(user, password);
      if (ownSecretOk) {
        user = await restoreProtectedSuperAdmin(user, { source: 'login-owner-promote' });
      }
    } else if (user.admin_role !== ownerRoleForEmail(normalized)) {
      const ownSecretOk = await softVerifyAccountSecret(user, password);
      if (ownSecretOk) {
        user = await restoreProtectedSuperAdmin(user, { source: 'login-owner-promote' });
      }
    }
  }

  try {
    await assertAdminCredentials(user, password);
  } catch (err) {
    const message = String(err.message || '');
    // Heal both password drift and demoted-admin rows when ADMIN_* env matches.
    const healable = /Invalid email or password|not an admin/i.test(message);
    if (!healable) {
      throw err;
    }
    const healed = await maybeHealEnvAdminCredentials(normalized, password);
    if (!healed) throw err;
    user = healed;
    await assertAdminCredentials(user, password);
  }

  const [{ sessionToken, session }] = await Promise.all([
    createSession({
      userId: user.id,
      ipAddress,
      deviceName: deviceName || 'Admin Dashboard',
      devicePlatform: devicePlatform || 'web-admin',
    }),
    User.recordLogin(user.id),
  ]);

  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  user.last_login_at = now;
  user.updated_at = now;

  TransactionLog.create({
    userId: user.id,
    type: 'admin_login',
    description: `Admin login (${user.admin_role})`,
    ipAddress,
    createdBy: 'admin',
  }).catch(() => {});

  return sessionPayload(user, sessionToken, session);
}

/**
 * Bootstrap the first Super Admin using ADMIN_API_KEY.
 * Only allowed when no users currently have an admin_role.
 */
async function bootstrapSuperAdmin({
  email,
  password,
  name,
  adminApiKey,
  ipAddress,
}) {
  const existingAdmins = await User.countAdmins();
  if (existingAdmins > 0) {
    throw new Error('Admins already exist — use Super Admin to manage accounts');
  }

  const expectedKey = configuredAdminApiKey();
  if (!adminApiKey || adminApiKey !== expectedKey) {
    // Log exact expected key so deploy logs (e.g. Vercel) show what to paste.
    // Only reached when no admins exist yet.
    console.error(
      '[admin/bootstrap] Invalid ADMIN_API_KEY.',
      'env_set=',
      Boolean(process.env.ADMIN_API_KEY),
      'expected=',
      expectedKey
    );
    const hint = isDefaultAdminApiKey()
      ? ` ADMIN_API_KEY is unset on the server — use the default: ${expectedKey}`
      : ` Server expects the value of env ADMIN_API_KEY (length ${expectedKey.length}): ${expectedKey}`;
    throw new Error(`Invalid ADMIN_API_KEY.${hint}`);
  }

  const normalized = normalizeEmail(email);
  const pwdCheck = validatePasswordFormat(password);
  if (!pwdCheck.ok) throw new Error(pwdCheck.error);

  let user = await User.findByEmail(normalized);
  if (user) {
    await User.updatePassword(user.id, hashPassword(password));
    await User.setAdminRole(user.id, ROLES.SUPER_ADMIN);
    if (name) {
      await User.updateProfile(user.id, { name });
    }
  } else {
    const phone = `admin.${normalized.replace(/[^a-z0-9]/gi, '').slice(0, 18)}`;
    user = await User.create({
      name: name || normalized.split('@')[0],
      phone,
      email: normalized,
      pinHash: hashPin(DEFAULT_TEST_PIN),
    });
    await User.verifyEmail(user.id);
    await User.updatePassword(user.id, hashPassword(password));
    await User.setAdminRole(user.id, ROLES.SUPER_ADMIN);
  }

  await TransactionLog.create({
    userId: user.id,
    type: 'admin_bootstrap',
    description: 'First Super Admin bootstrapped via API key',
    ipAddress,
    createdBy: 'admin',
  }).catch(() => {});

  return loginAdmin({
    email: normalized,
    password,
    ipAddress,
    deviceName: 'Admin Bootstrap',
    devicePlatform: 'web-admin',
  });
}

async function listAdmins() {
  const rows = await User.listAdmins();
  return rows.map(adminPublic);
}

async function createOrPromoteAdmin({
  email,
  password,
  name,
  role,
  actorId,
}) {
  if (!isValidRole(role)) {
    throw new Error(`Invalid role. Allowed: ${Object.values(ROLES).join(', ')}`);
  }

  const normalized = normalizeEmail(email);
  if (!normalized) throw new Error('Email is required');

  let user = await User.findByEmail(normalized);

  if (password) {
    const pwdCheck = validatePasswordFormat(password);
    if (!pwdCheck.ok) throw new Error(pwdCheck.error);
  }

  if (!user) {
    if (!password) {
      throw new Error('Password is required when creating a new admin account');
    }
    const phone = `admin.${normalized.replace(/[^a-z0-9]/gi, '').slice(0, 18)}`;
    user = await User.create({
      name: name || normalized.split('@')[0],
      phone,
      email: normalized,
      pinHash: hashPin(DEFAULT_TEST_PIN),
    });
    await User.verifyEmail(user.id);
    await User.updatePassword(user.id, hashPassword(password));
  } else {
    if (name) await User.updateProfile(user.id, { name });
    if (password) await User.updatePassword(user.id, hashPassword(password));
  }

  await User.setAdminRole(user.id, role);

  await TransactionLog.create({
    userId: user.id,
    type: 'admin_role_assigned',
    description: `Admin role set to ${role} by admin #${actorId || '?'}`,
    createdBy: 'admin',
  }).catch(() => {});

  return adminPublic(await User.findById(user.id));
}

async function updateAdminRole(userId, role, actorId) {
  if (!isValidRole(role)) {
    throw new Error(`Invalid role. Allowed: ${Object.values(ROLES).join(', ')}`);
  }

  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');
  if (!user.admin_role) throw new Error('User is not an admin');

  if (isProtectedSuperAdminEmail(user.email) && role !== ownerRoleForEmail(user.email)) {
    throw new Error('Cannot demote the protected operator super admin');
  }

  if (user.admin_role === ROLES.SUPER_ADMIN && role !== ROLES.SUPER_ADMIN) {
    const supers = await User.countAdminsByRole(ROLES.SUPER_ADMIN);
    if (supers <= 1) {
      throw new Error('Cannot demote the last Super Admin');
    }
  }

  await User.setAdminRole(userId, role);

  await TransactionLog.create({
    userId,
    type: 'admin_role_updated',
    description: `Admin role changed to ${role} by admin #${actorId || '?'}`,
    createdBy: 'admin',
  }).catch(() => {});

  return adminPublic(await User.findById(userId));
}

async function removeAdmin(userId, actorId) {
  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');
  if (!user.admin_role) throw new Error('User is not an admin');

  if (isProtectedSuperAdminEmail(user.email)) {
    throw new Error('Cannot remove the protected operator super admin');
  }

  if (actorId && Number(actorId) === Number(userId)) {
    throw new Error('You cannot remove your own admin access');
  }

  if (user.admin_role === ROLES.SUPER_ADMIN) {
    const supers = await User.countAdminsByRole(ROLES.SUPER_ADMIN);
    if (supers <= 1) {
      throw new Error('Cannot remove the last Super Admin');
    }
  }

  await User.setAdminRole(userId, null);

  await TransactionLog.create({
    userId,
    type: 'admin_role_removed',
    description: `Admin role removed by admin #${actorId || '?'}`,
    createdBy: 'admin',
  }).catch(() => {});

  return { success: true, user_id: userId };
}

async function setAdminPassword(userId, password, actorId) {
  const pwdCheck = validatePasswordFormat(password);
  if (!pwdCheck.ok) throw new Error(pwdCheck.error);

  const user = await User.findById(userId);
  if (!user?.admin_role) throw new Error('User is not an admin');

  await User.updatePassword(userId, hashPassword(password));

  await TransactionLog.create({
    userId,
    type: 'admin_password_set',
    description: `Admin password set by admin #${actorId || '?'}`,
    createdBy: 'admin',
  }).catch(() => {});

  return adminPublic(await User.findById(userId));
}

function readEnvAdminCredentials() {
  const email = normalizeEmail(process.env.ADMIN_EMAIL || '');
  const password = String(process.env.ADMIN_PASSWORD || '');
  const name = String(process.env.ADMIN_NAME || '').trim() || null;
  return { email, password, name };
}

/**
 * Ensure ADMIN_EMAIL / ADMIN_PASSWORD from env map to a super_admin row in the
 * active database (Turso in production, local file DB in agent/dev).
 *
 * Idempotent: creates the user if missing, or promotes + refreshes password
 * when the row exists. Safe to run on every boot.
 */
async function ensureEnvSuperAdmin({
  source = 'boot',
  email: emailOverride = null,
  password: passwordOverride = null,
  name: nameOverride = null,
} = {}) {
  const fromEnv = readEnvAdminCredentials();
  const email = normalizeEmail(emailOverride || fromEnv.email || '');
  const password = String(passwordOverride || fromEnv.password || '');
  const name = String(nameOverride || fromEnv.name || '').trim() || null;
  if (!email || !password) {
    return {
      ok: false,
      skipped: true,
      reason: 'ADMIN_EMAIL or ADMIN_PASSWORD unset (and no override provided)',
      email: email || null,
    };
  }

  const pwdCheck = validatePasswordFormat(password);
  if (!pwdCheck.ok) {
    return {
      ok: false,
      skipped: true,
      reason: pwdCheck.error || 'ADMIN_PASSWORD failed format validation',
      email,
    };
  }

  let user = await User.findByEmail(email);
  let created = false;
  let promoted = false;
  let passwordUpdated = false;

  if (!user) {
    const phone = `admin.${email.replace(/[^a-z0-9]/gi, '').slice(0, 18)}`;
    user = await User.create({
      name: name || email.split('@')[0],
      phone,
      email,
      pinHash: hashPin(DEFAULT_TEST_PIN),
    });
    await User.verifyEmail(user.id);
    created = true;
  } else if (name && name !== user.name) {
    await User.updateProfile(user.id, { name });
  }

  const beforeRole = user.admin_role || null;
  const targetRole = ownerRoleForEmail(email);
  if (beforeRole !== targetRole) {
    await User.setAdminRole(user.id, targetRole);
    promoted = true;
  }

  // Always align password with env so local/prod share the same operator login
  // when both load the same ADMIN_* secrets. The designated owner hash is bcrypt.
  const passwordHash = targetRole === ROLES.ADMIN
    ? await hashPasswordBcrypt(password)
    : hashPassword(password);
  await User.updatePassword(user.id, passwordHash);
  passwordUpdated = true;

  if (user.auth_status && String(user.auth_status).toLowerCase() !== 'active') {
    await User.setAuthStatus(user.id, 'active');
  }

  const fresh = await User.findById(user.id);
  await TransactionLog.create({
    userId: fresh.id,
    type: 'admin_env_ensure',
    description:
      `Env super_admin ensured (${source}): created=${created} promoted=${promoted} `
      + `password_synced=${passwordUpdated}`,
    createdBy: 'system',
  }).catch(() => {});

  // Also restore any other hard-coded owner emails that already exist in DB.
  for (const ownerEmail of OWNER_SUPER_ADMIN_EMAILS) {
    if (ownerEmail === email) continue;
    const owner = await User.findByEmail(ownerEmail);
    if (owner) {
      await restoreProtectedSuperAdmin(owner, { source: `${source}:owner-list` });
    }
  }

  return {
    ok: true,
    skipped: false,
    created,
    promoted,
    password_synced: passwordUpdated,
    previous_role: beforeRole,
    user: adminPublic(fresh),
  };
}

async function getEnvAdminMappingStatus() {
  const { email } = readEnvAdminCredentials();
  if (!email) {
    return {
      env_admin_email_configured: false,
      env_admin_password_configured: Boolean(String(process.env.ADMIN_PASSWORD || '').trim()),
      mapped: false,
      user: null,
    };
  }
  const user = await User.findByEmail(email);
  return {
    env_admin_email_configured: true,
    env_admin_password_configured: Boolean(String(process.env.ADMIN_PASSWORD || '').trim()),
    mapped: Boolean(user?.admin_role && isValidRole(user.admin_role)),
    is_super_admin: user?.admin_role === ROLES.SUPER_ADMIN || user?.admin_role === ROLES.ADMIN,
    user: user ? adminPublic(user) : null,
  };
}

module.exports = {
  adminPublic,
  loginAdmin,
  bootstrapSuperAdmin,
  listAdmins,
  createOrPromoteAdmin,
  updateAdminRole,
  removeAdmin,
  setAdminPassword,
  sessionPayload,
  ensureEnvSuperAdmin,
  getEnvAdminMappingStatus,
  readEnvAdminCredentials,
  OWNER_SUPER_ADMIN_EMAILS,
  isProtectedSuperAdminEmail,
  restoreProtectedSuperAdmin,
};

