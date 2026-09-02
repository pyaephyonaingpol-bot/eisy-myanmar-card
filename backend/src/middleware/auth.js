const UserSession = require('../models/UserSession');
const User = require('../models/User');
const { verifyPinToken, hashToken } = require('../services/cryptoService');
const { addDays } = require('../lib/sqliteDatetime');
const {
  isValidRole,
  roleHasPermission,
  ROLES,
} = require('../lib/adminRoles');

const SESSION_EXPIRY_DAYS = parseInt(process.env.SESSION_EXPIRY_DAYS || '30', 10);
/** Avoid writing last_seen_at on every API call — throttle to once per N ms. */
const SESSION_TOUCH_TTL_MS = parseInt(process.env.SESSION_TOUCH_TTL_MS || '300000', 10); // 5 min
const _sessionTouchAt = new Map();

function shouldTouchSession(token) {
  const now = Date.now();
  const last = _sessionTouchAt.get(token) || 0;
  if (now - last < SESSION_TOUCH_TTL_MS) return false;
  _sessionTouchAt.set(token, now);
  // Bound map growth for long-lived processes
  if (_sessionTouchAt.size > 5000) {
    const cutoff = now - SESSION_TOUCH_TTL_MS;
    for (const [k, ts] of _sessionTouchAt) {
      if (ts < cutoff) _sessionTouchAt.delete(k);
    }
  }
  return true;
}

/** Fallback when ADMIN_API_KEY env is unset (local/dev ONLY — never production). */
const DEFAULT_ADMIN_API_KEY = 'eisy-admin-dev-key';

const { isProductionRuntime } = require('../services/securityFlags');

function configuredAdminApiKey() {
  const fromEnv = String(process.env.ADMIN_API_KEY || '').trim();
  if (fromEnv) return fromEnv;
  // Hard default must never authenticate production / Vercel.
  if (isProductionRuntime()) return '';
  return DEFAULT_ADMIN_API_KEY;
}

function isDefaultAdminApiKey() {
  const fromEnv = String(process.env.ADMIN_API_KEY || '').trim();
  return !fromEnv;
}

/**
 * Dev-only admin bypass when ADMIN_API_KEY is unset.
 * NEVER enabled in production / Vercel — was a critical incident vector
 * (anyone could hit /api/admin/* as super_admin).
 */
function adminDevBypassEnabled() {
  if (isProductionRuntime()) return false;
  if (String(process.env.ADMIN_DEV_BYPASS || '').toLowerCase() === 'true') {
    return !String(process.env.ADMIN_API_KEY || '').trim();
  }
  // Legacy local default: bypass only when explicitly not disabled AND no key.
  // Prefer ADMIN_DEV_BYPASS=true going forward.
  return process.env.ADMIN_DEV_BYPASS !== 'false'
    && !String(process.env.ADMIN_API_KEY || '').trim()
    && String(process.env.NODE_ENV || '').toLowerCase() !== 'production';
}

function attachApiKeyAdmin(req) {
  req.isAdmin = true;
  req.adminAuthMethod = 'api_key';
  req.adminRole = ROLES.SUPER_ADMIN;
  req.user = {
    id: null,
    email: 'api-key@system',
    name: 'API Key Super Admin',
    phone: null,
    email_verified: 1,
    has_pin: false,
    biometrics_enabled: false,
    auth_status: 'active',
    admin_role: ROLES.SUPER_ADMIN,
  };
}

async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;

    if (!token) {
      return res.status(401).json({ error: 'Authentication required', code: 'AUTH_REQUIRED' });
    }

    const session = await UserSession.findByToken(token);
    if (!session) {
      return res.status(401).json({ error: 'Invalid or expired session', code: 'SESSION_INVALID' });
    }

    // findByToken already JOINs users — avoid a second User.findById on every request.
    if (session.auth_status && session.auth_status === 'suspended') {
      return res.status(403).json({ error: 'Account unavailable', code: 'ACCOUNT_SUSPENDED' });
    }

    if (shouldTouchSession(token)) {
      // Fire-and-forget — do not block the request on session bookkeeping.
      UserSession.touch(token, addDays(SESSION_EXPIRY_DAYS)).catch((err) => {
        console.warn('[auth] session touch skipped:', err.message);
      });
    }

    req.sessionToken = token;
    req.session = session;
    req.user = {
      id: session.uid || session.user_id,
      email: session.email,
      name: session.name,
      phone: session.phone,
      email_verified: session.email_verified,
      has_pin: Boolean(session.pin_hash),
      biometrics_enabled: Boolean(session.biometrics_enabled),
      auth_status: session.auth_status,
      admin_role: session.admin_role || null,
    };

    next();
  } catch (err) {
    console.error('[auth middleware]', err);
    res.status(500).json({ error: 'Authentication error' });
  }
}

async function requireSensitive(req, res, next) {
  try {
    const pinToken = req.headers['x-pin-token'];
    const bioToken = req.headers['x-biometric-token'];

    if (pinToken && verifyPinToken(pinToken, req.user.id)) {
      req.sensitiveAuth = 'pin';
      return next();
    }

    if (bioToken) {
      const user = await User.findById(req.user.id);
      if (user?.biometrics_enabled && user.biometrics_token_hash === hashToken(bioToken)) {
        req.sensitiveAuth = 'biometric';
        return next();
      }
    }

    return res.status(403).json({
      error: 'PIN or biometric verification required for this action',
      code: 'SENSITIVE_AUTH_REQUIRED',
    });
  } catch (err) {
    console.error('[sensitive middleware]', err);
    res.status(500).json({ error: 'Authorization error' });
  }
}

function requireAdmin(req, res, next) {
  const adminKey = process.env.ADMIN_API_KEY;
  const provided = req.headers['x-admin-key'];

  if (adminKey && provided === adminKey) {
    req.isAdmin = true;
    return next();
  }

  if (req.user) {
    req.isAdmin = false;
    return next();
  }

  return res.status(401).json({ error: 'Admin key or user authentication required', code: 'ADMIN_REQUIRED' });
}

function requireOwnerOrAdmin(paramName = 'user_id') {
  return (req, res, next) => {
    const targetId = parseInt(req.params[paramName] || req.body?.user_id, 10);
    if (req.isAdmin) return next();
    if (req.user && req.user.id === targetId) return next();
    return res.status(403).json({ error: 'Access denied', code: 'FORBIDDEN' });
  };
}

/**
 * Legacy admin gate (API key / dev bypass). Prefer requireAdminAuth for RBAC.
 */
function requireAdminOnly(req, res, next) {
  const adminKey = configuredAdminApiKey();
  const provided = req.headers['x-admin-key'];

  if (provided && provided === adminKey) {
    attachApiKeyAdmin(req);
    return next();
  }

  if (adminDevBypassEnabled()) {
    attachApiKeyAdmin(req);
    return next();
  }

  return res.status(403).json({ error: 'Valid admin key required', code: 'ADMIN_REQUIRED' });
}

/**
 * Admin auth: Bearer session for a user with admin_role, or X-Admin-Key (super_admin),
 * or local ADMIN_DEV_BYPASS when ADMIN_API_KEY is unset.
 */
async function requireAdminAuth(req, res, next) {
  try {
    const adminKey = configuredAdminApiKey();
    const providedKey = req.headers['x-admin-key'];

    if (providedKey && providedKey === adminKey) {
      attachApiKeyAdmin(req);
      return next();
    }

    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;

    if (token) {
      const session = await UserSession.findByToken(token);
      if (!session) {
        return res.status(401).json({ error: 'Invalid or expired admin session', code: 'SESSION_INVALID' });
      }

      const user = await User.findById(session.user_id);
      if (!user || (user.auth_status && user.auth_status === 'suspended')) {
        return res.status(403).json({ error: 'Account unavailable', code: 'ACCOUNT_SUSPENDED' });
      }

      if (!user.admin_role || !isValidRole(user.admin_role)) {
        return res.status(403).json({
          error: 'Admin role required',
          code: 'ADMIN_ROLE_REQUIRED',
        });
      }

      await UserSession.touch(token, addDays(SESSION_EXPIRY_DAYS));

      req.sessionToken = token;
      req.session = session;
      req.isAdmin = true;
      req.adminAuthMethod = 'session';
      req.adminRole = user.admin_role;
      req.user = {
        id: user.id,
        email: user.email,
        name: user.name,
        phone: user.phone,
        email_verified: user.email_verified,
        has_pin: Boolean(user.pin_hash),
        biometrics_enabled: Boolean(user.biometrics_enabled),
        auth_status: user.auth_status,
        admin_role: user.admin_role,
      };
      return next();
    }

    if (adminDevBypassEnabled()) {
      attachApiKeyAdmin(req);
      return next();
    }

    return res.status(401).json({
      error: 'Admin authentication required',
      code: 'ADMIN_AUTH_REQUIRED',
    });
  } catch (err) {
    console.error('[admin auth middleware]', err);
    return res.status(500).json({ error: 'Admin authentication error' });
  }
}

function requirePermission(permission) {
  return (req, res, next) => {
    const role = req.adminRole || req.user?.admin_role;
    if (roleHasPermission(role, permission)) {
      return next();
    }
    return res.status(403).json({
      error: 'Insufficient admin permissions',
      code: 'ADMIN_FORBIDDEN',
      required_permission: permission,
      role: role || null,
    });
  };
}

function requireRoles(...roles) {
  const allowed = roles.flat();
  return (req, res, next) => {
    const role = req.adminRole || req.user?.admin_role;
    if (role && allowed.includes(role)) {
      return next();
    }
    return res.status(403).json({
      error: 'Insufficient admin role',
      code: 'ADMIN_FORBIDDEN',
      required_roles: allowed,
      role: role || null,
    });
  };
}

module.exports = {
  requireAuth,
  requireSensitive,
  requireAdmin,
  requireAdminOnly,
  requireAdminAuth,
  requirePermission,
  requireRoles,
  requireOwnerOrAdmin,
  ROLES,
  DEFAULT_ADMIN_API_KEY,
  configuredAdminApiKey,
  isDefaultAdminApiKey,
  adminDevBypassEnabled,
};
