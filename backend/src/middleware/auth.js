const UserSession = require('../models/UserSession');
const User = require('../models/User');
const { verifyPinToken, hashToken } = require('../services/cryptoService');

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

    const user = await User.findById(session.user_id);
    if (!user || (user.auth_status && user.auth_status === 'suspended')) {
      return res.status(403).json({ error: 'Account unavailable', code: 'ACCOUNT_SUSPENDED' });
    }

    await UserSession.touch(token);

    req.sessionToken = token;
    req.session = session;
    req.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      email_verified: user.email_verified,
      has_pin: Boolean(user.pin_hash),
      biometrics_enabled: Boolean(user.biometrics_enabled),
      auth_status: user.auth_status,
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

function requireAdminOnly(req, res, next) {
  const adminKey = process.env.ADMIN_API_KEY || 'eisy-admin-dev-key';
  const provided = req.headers['x-admin-key'];

  if (provided && provided === adminKey) {
    req.isAdmin = true;
    return next();
  }

  // Dev bypass: when ADMIN_API_KEY is not customized, allow local admin dashboard without a key
  if (process.env.ADMIN_DEV_BYPASS !== 'false' && !process.env.ADMIN_API_KEY) {
    req.isAdmin = true;
    return next();
  }

  return res.status(403).json({ error: 'Valid admin key required', code: 'ADMIN_REQUIRED' });
}

module.exports = {
  requireAuth,
  requireSensitive,
  requireAdmin,
  requireAdminOnly,
  requireOwnerOrAdmin,
};
