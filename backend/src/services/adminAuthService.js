const User = require('../models/User');
const TransactionLog = require('../models/TransactionLog');
const {
  createSession,
} = require('./authService');
const {
  verifyPassword,
  verifyPin,
  hashPassword,
  validatePasswordFormat,
  normalizeEmail,
  isDefaultTestPin,
  hashPin,
  DEFAULT_TEST_PIN,
} = require('./cryptoService');
const {
  ROLES,
  isValidRole,
  permissionsForRole,
  pagesForRole,
  ROLE_LABELS,
} = require('../lib/adminRoles');

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
  if (user.auth_status && user.auth_status === 'suspended') {
    throw new Error('Account unavailable');
  }

  const pwd = String(password || '');
  if (user.password_hash) {
    if (!verifyPassword(pwd, user.password_hash)) {
      throw new Error('Invalid email or password');
    }
    return;
  }

  // Fallback: allow PIN login for admins who have not set a password yet
  if (user.pin_hash) {
    if (!verifyPin(pwd, user.pin_hash)) {
      throw new Error('Invalid email or password');
    }
    return;
  }

  if (isDefaultTestPin(pwd)) {
    await User.updatePin(user.id, hashPin(DEFAULT_TEST_PIN));
    return;
  }

  throw new Error('Admin password is not set. Ask a Super Admin to set one, or use the default test PIN 123456 once.');
}

async function loginAdmin({ email, password, ipAddress, deviceName, devicePlatform }) {
  const normalized = normalizeEmail(email);
  if (!normalized || !password) {
    throw new Error('Email and password are required');
  }

  const user = await User.findByEmail(normalized);
  if (!user) {
    throw new Error('Invalid email or password');
  }

  await assertAdminCredentials(user, password);
  await User.recordLogin(user.id);

  const { sessionToken, session } = await createSession({
    userId: user.id,
    ipAddress,
    deviceName: deviceName || 'Admin Dashboard',
    devicePlatform: devicePlatform || 'web-admin',
  });

  await TransactionLog.create({
    userId: user.id,
    type: 'admin_login',
    description: `Admin login (${user.admin_role})`,
    ipAddress,
    createdBy: 'admin',
  }).catch(() => {});

  const fresh = await User.findById(user.id);
  return sessionPayload(fresh, sessionToken, session);
}

/**
 * Bootstrap the first Super Admin.
 * TEMPORARY: ADMIN_API_KEY check is skipped when no admins exist so the first
 * Super Admin can be created without Vercel env vars. Re-enable the key check
 * after the first admin is set up (set ADMIN_BOOTSTRAP_OPEN=false or restore
 * the key requirement below).
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

  // Temporary open bootstrap: allow first Super Admin without ADMIN_API_KEY.
  // Set ADMIN_BOOTSTRAP_OPEN=false to require the API key again.
  const bootstrapOpen = process.env.ADMIN_BOOTSTRAP_OPEN !== 'false';
  if (!bootstrapOpen) {
    const expectedKey = process.env.ADMIN_API_KEY || 'eisy-admin-dev-key';
    if (!adminApiKey || adminApiKey !== expectedKey) {
      throw new Error('Valid admin API key required for bootstrap');
    }
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
    description: bootstrapOpen
      ? 'First Super Admin bootstrapped (temporary open bootstrap)'
      : 'First Super Admin bootstrapped via API key',
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
};
