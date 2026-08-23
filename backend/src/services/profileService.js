const User = require('../models/User');
const {
  isSyntheticPhone,
  syntheticPhone,
  formatDisplayPhone,
  normalizePhoneInput,
} = require('../lib/phoneUtils');

async function resolveProfilePhone(userId, phoneInput, email) {
  const user = await User.findById(userId);
  if (!user) {
    const err = new Error('User not found');
    err.code = 'USER_NOT_FOUND';
    throw err;
  }

  const normalized = normalizePhoneInput(phoneInput);
  if (!normalized) {
    if (isSyntheticPhone(user.phone)) return user.phone;
    return syntheticPhone(email || user.email);
  }

  const existing = await User.findByPhone(normalized);
  if (existing && Number(existing.id) !== Number(userId)) {
    const err = new Error('Phone number already registered to another account');
    err.code = 'PHONE_ALREADY_REGISTERED';
    throw err;
  }

  return normalized;
}

function mapPublicUser(user) {
  if (!user) return null;
  const base = User.stripPrivate(user);
  return {
    ...base,
    phone: formatDisplayPhone(user.phone),
    phone_display: formatDisplayPhone(user.phone),
    has_phone: Boolean(formatDisplayPhone(user.phone)),
  };
}

async function updateUserProfile(userId, { name, phone } = {}) {
  const user = await User.findById(userId);
  if (!user) {
    const err = new Error('User not found');
    err.code = 'USER_NOT_FOUND';
    throw err;
  }

  const nextName = name != null ? String(name).trim() : user.name;
  if (!nextName) {
    const err = new Error('Name is required');
    err.code = 'INVALID_NAME';
    throw err;
  }

  const nextPhone = phone !== undefined
    ? await resolveProfilePhone(userId, phone, user.email)
    : user.phone;

  const updated = await User.updateProfile(userId, {
    name: nextName,
    phone: nextPhone,
  });

  return mapPublicUser(updated);
}

module.exports = {
  mapPublicUser,
  updateUserProfile,
  resolveProfilePhone,
  formatDisplayPhone,
};
