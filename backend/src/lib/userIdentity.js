/**
 * One application user key: LibSQL users.id.
 * Supabase Auth UUIDs and drifted mirror keys are attached beside that id.
 * Nothing here deletes or rewrites existing user rows.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeEmail(email) {
  const value = String(email || '').trim().toLowerCase();
  return value || null;
}

function isAuthUserId(value) {
  return UUID_RE.test(String(value || '').trim());
}

function isLocalUserId(value) {
  const text = String(value ?? '').trim();
  if (!/^\d+$/.test(text)) return false;
  const n = Number(text);
  return Number.isSafeInteger(n) && n > 0;
}

function identityFromRow(row) {
  if (!row) {
    return { user_id: null, name: '', email: null, auth_user_id: null };
  }
  const userId = row.user_id != null && row.user_id !== '' ? row.user_id : row.id;
  const name = String(row.user_name || row.name || '').trim();
  const email = normalizeEmail(row.user_email || row.email);
  const authUserId = String(row.auth_user_id || '').trim() || null;
  return {
    user_id: userId == null || userId === '' ? null : userId,
    name,
    email,
    auth_user_id: authUserId,
  };
}

function identityLabel(row) {
  const idn = identityFromRow(row);
  const parts = [];
  if (idn.name) parts.push(idn.name);
  if (idn.email) parts.push(idn.email);
  if (idn.user_id != null && idn.user_id !== '') parts.push('#' + idn.user_id);
  if (idn.auth_user_id && String(idn.auth_user_id) !== String(idn.user_id)) {
    parts.push(idn.auth_user_id);
  }
  return parts.join(' · ') || 'User';
}

/**
 * Fold a Supabase wallet onto the registry user that shares its email.
 * Returns true when the wallet should not become its own directory row.
 */
function attachMirrorWallet(localRow, walletRow) {
  if (!localRow || !walletRow) return false;
  const mirrorId = walletRow.user_id == null ? '' : String(walletRow.user_id);
  if (!mirrorId || mirrorId === String(localRow.id)) return mirrorId === String(localRow.id);

  if (isAuthUserId(mirrorId) && !localRow.auth_user_id) {
    localRow.auth_user_id = mirrorId;
    localRow.auth_user_id_linked = true;
  } else if (!isAuthUserId(mirrorId) && !localRow.mirror_user_id) {
    localRow.mirror_user_id = mirrorId;
  }

  const mirrorBalance = Number(walletRow.balance_usdt ?? 0);
  if (Number(localRow.balance_usdt || 0) === 0 && mirrorBalance > 0) {
    localRow.balance_usdt = mirrorBalance;
    localRow.balance_source = 'supabase';
  }
  if (!localRow.email && walletRow.email) localRow.email = walletRow.email;
  if (!localRow.name && walletRow.name) localRow.name = walletRow.name;
  return true;
}

module.exports = {
  normalizeEmail,
  isAuthUserId,
  isLocalUserId,
  identityFromRow,
  identityLabel,
  attachMirrorWallet,
};
