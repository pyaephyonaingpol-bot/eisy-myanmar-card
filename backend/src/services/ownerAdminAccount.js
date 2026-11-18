const User = require('../models/User');
const { getDb } = require('../db');
const {
  hashPasswordBcrypt,
  hashPin,
  validatePasswordFormat,
  verifyPasswordAsync,
  generateOtp,
} = require('./cryptoService');

/**
 * Operator account requested for admin login.
 * Email is assembled the same way as the protected-owner allowlist.
 * Password MUST come from ADMIN_OWNER_PASSWORD (or ADMIN_PASSWORD) — never hardcoded.
 */
const OWNER_EMAIL = ['pyaephyonaing', 'pol'].join('.') + '@' + ['gmail', 'com'].join('.');
const OWNER_ROLE = 'ADMIN';

function resolveOwnerPassword() {
  return String(
    process.env.ADMIN_OWNER_PASSWORD
      || process.env.OWNER_ADMIN_PASSWORD
      || ''
  ).trim();
}

async function countUsers() {
  const row = await getDb().get('SELECT COUNT(*) AS c FROM users');
  return Number(row?.c || 0);
}

/**
 * Set the owner account role to ADMIN and store the operator password as bcrypt.
 * Updates only that user's role, password, and (when blocked) auth_status.
 * Never deletes rows. Skips when ADMIN_OWNER_PASSWORD is unset.
 */
async function applyOwnerAdminAccount() {
  const OWNER_PASSWORD = resolveOwnerPassword();
  if (!OWNER_PASSWORD) {
    return {
      ok: false,
      skipped: true,
      reason: 'ADMIN_OWNER_PASSWORD_UNSET',
      email: OWNER_EMAIL,
      admin_role: OWNER_ROLE,
    };
  }

  const pwdCheck = validatePasswordFormat(OWNER_PASSWORD);
  if (!pwdCheck.ok) {
    throw new Error(pwdCheck.error || 'Owner password failed format validation');
  }

  const usersBefore = await countUsers();
  let user = await User.findByEmail(OWNER_EMAIL);
  let created = false;

  if (!user) {
    const phone = `owner.${OWNER_EMAIL.replace(/[^a-z0-9]/gi, '').slice(0, 18)}`;
    // Random PIN hash — not a known test PIN; admin auth uses password.
    const pinDigits = String(generateOtp()).padStart(6, '0').slice(0, 6);
    user = await User.create({
      name: OWNER_EMAIL.split('@')[0],
      phone,
      email: OWNER_EMAIL,
      pinHash: hashPin(pinDigits),
    });
    await User.verifyEmail(user.id);
    created = true;
  }

  const preserved = {
    name: user.name,
    phone: user.phone,
    balance: user.balance,
    balance_mmk: user.balance_mmk,
    balance_usdt: user.balance_usdt,
    pin_hash: user.pin_hash,
  };

  await User.setAdminRole(user.id, OWNER_ROLE);
  await User.updatePassword(user.id, await hashPasswordBcrypt(OWNER_PASSWORD));

  let unblocked = false;
  if (String(user.auth_status || 'active').toLowerCase() !== 'active') {
    await User.setAuthStatus(user.id, 'active');
    unblocked = true;
  }

  const fresh = await User.findById(user.id);
  const usersAfter = await countUsers();
  if (usersAfter < usersBefore) {
    throw new Error('Owner admin update refused: user rows were deleted');
  }
  if (!created && usersAfter !== usersBefore) {
    throw new Error('Owner admin update changed the user count');
  }

  const passwordOk = await verifyPasswordAsync(OWNER_PASSWORD, fresh.password_hash);
  if (!passwordOk || !String(fresh.password_hash || '').startsWith('$2')) {
    throw new Error('Owner password was not stored as a bcrypt hash');
  }
  if (fresh.admin_role !== OWNER_ROLE) {
    throw new Error(`Owner role is ${fresh.admin_role}, expected ${OWNER_ROLE}`);
  }

  if (!created) {
    const sameBalance = Number(fresh.balance_usdt || 0) === Number(preserved.balance_usdt || 0)
      && Number(fresh.balance || 0) === Number(preserved.balance || 0)
      && Number(fresh.balance_mmk || 0) === Number(preserved.balance_mmk || 0);
    const sameIdentity = fresh.name === preserved.name
      && fresh.phone === preserved.phone
      && fresh.pin_hash === preserved.pin_hash;
    if (!sameBalance || !sameIdentity) {
      throw new Error('Owner admin update changed balances, name, phone, or PIN');
    }
  }

  return {
    ok: true,
    created,
    unblocked,
    user_id: fresh.id,
    email: fresh.email,
    admin_role: fresh.admin_role,
    password_bcrypt: true,
    users_before: usersBefore,
    users_after: usersAfter,
  };
}

module.exports = {
  OWNER_EMAIL,
  OWNER_ROLE,
  resolveOwnerPassword,
  applyOwnerAdminAccount,
};
