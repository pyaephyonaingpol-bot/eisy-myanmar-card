/** Admin RBAC roles and permission map */

const ROLES = {
  SUPER_ADMIN: 'super_admin',
  FINANCE_ADMIN: 'finance_admin',
  SUPPORT_ADMIN: 'support_admin',
};

const ALL_ADMIN_ROLES = Object.values(ROLES);

const ROLE_LABELS = {
  [ROLES.SUPER_ADMIN]: 'Super Admin',
  [ROLES.FINANCE_ADMIN]: 'Finance Admin',
  [ROLES.SUPPORT_ADMIN]: 'Support Admin',
};

/**
 * Permission → roles that may perform the action.
 * super_admin is included on every permission that other roles have.
 */
const PERMISSIONS = {
  manage_admins: [ROLES.SUPER_ADMIN],
  settings_write: [ROLES.SUPER_ADMIN],
  payment_methods: [ROLES.SUPER_ADMIN],
  master_wallet: [ROLES.SUPER_ADMIN],
  /** Super + Finance can view/update withdrawal exchange rate & service fees */
  withdrawal_rates_read: [ROLES.SUPER_ADMIN, ROLES.FINANCE_ADMIN],
  withdrawal_rates_write: [ROLES.SUPER_ADMIN, ROLES.FINANCE_ADMIN],
  settings_read: [ROLES.SUPER_ADMIN, ROLES.FINANCE_ADMIN],
  balance_adjust: [ROLES.SUPER_ADMIN, ROLES.FINANCE_ADMIN],
  deposits: [ROLES.SUPER_ADMIN, ROLES.FINANCE_ADMIN],
  withdrawals: [ROLES.SUPER_ADMIN, ROLES.FINANCE_ADMIN],
  ledger: [ROLES.SUPER_ADMIN, ROLES.FINANCE_ADMIN],
  revenue: [ROLES.SUPER_ADMIN, ROLES.FINANCE_ADMIN],
  rates: [ROLES.SUPER_ADMIN, ROLES.FINANCE_ADMIN],
  cards: [ROLES.SUPER_ADMIN, ROLES.FINANCE_ADMIN, ROLES.SUPPORT_ADMIN],
  users: [ROLES.SUPER_ADMIN, ROLES.FINANCE_ADMIN, ROLES.SUPPORT_ADMIN],
  transactions: [ROLES.SUPER_ADMIN, ROLES.FINANCE_ADMIN, ROLES.SUPPORT_ADMIN],
  kyc: [ROLES.SUPER_ADMIN, ROLES.SUPPORT_ADMIN],
  support: [ROLES.SUPER_ADMIN, ROLES.SUPPORT_ADMIN],
  p2p: [ROLES.SUPER_ADMIN, ROLES.FINANCE_ADMIN, ROLES.SUPPORT_ADMIN],
  dashboard: ALL_ADMIN_ROLES,
};

/** UI nav page → required permission */
const PAGE_PERMISSIONS = {
  deposits: 'deposits',
  cards: 'cards',
  users: 'users',
  transactions: 'transactions',
  revenue: 'revenue',
  support: 'support',
  'kyc-requests': 'kyc',
  settings: 'settings_read',
  'withdrawal-rates': 'withdrawal_rates_read',
  admins: 'manage_admins',
};

function isValidRole(role) {
  return ALL_ADMIN_ROLES.includes(role);
}

function roleHasPermission(role, permission) {
  if (!role || !permission) return false;
  const allowed = PERMISSIONS[permission];
  if (!allowed) return false;
  return allowed.includes(role);
}

function permissionsForRole(role) {
  if (!role) return [];
  return Object.keys(PERMISSIONS).filter((p) => roleHasPermission(role, p));
}

function pagesForRole(role) {
  return Object.entries(PAGE_PERMISSIONS)
    .filter(([, perm]) => roleHasPermission(role, perm))
    .map(([page]) => page);
}

module.exports = {
  ROLES,
  ALL_ADMIN_ROLES,
  ROLE_LABELS,
  PERMISSIONS,
  PAGE_PERMISSIONS,
  isValidRole,
  roleHasPermission,
  permissionsForRole,
  pagesForRole,
};
