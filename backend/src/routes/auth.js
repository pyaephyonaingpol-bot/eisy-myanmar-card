const express = require('express');
const authService = require('../services/authService');
const { requireAuth } = require('../middleware/auth');
const UserSession = require('../models/UserSession');

const router = express.Router();

function clientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
}

function deviceInfo(req) {
  return {
    deviceName: req.headers['x-device-name'] || 'Web Browser',
    devicePlatform: req.headers['x-device-platform'] || 'web',
  };
}

// ─── Registration ───────────────────────────────────────────────

async function handleRegisterSendOtp(req, res) {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });
    const result = await authService.sendRegistrationOtp(email, clientIp(req));
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

router.post('/register/send-otp', handleRegisterSendOtp);
router.post('/register-otp', handleRegisterSendOtp); // alias for frontend compatibility

router.post('/register/complete', async (req, res) => {
  try {
    const { email, otp, name, phone, pin } = req.body;
    if (!email || !otp || !pin) {
      return res.status(400).json({ error: 'email, otp, and pin are required' });
    }
    const result = await authService.completeRegistration({
      email, otp, name, phone, pin,
      ipAddress: clientIp(req),
      ...deviceInfo(req),
    });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── Login ──────────────────────────────────────────────────────

async function handleLoginSendOtp(req, res) {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });
    const result = await authService.sendLoginOtp(email, clientIp(req));
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

router.post('/login/send-otp', handleLoginSendOtp);
router.post('/login-otp', handleLoginSendOtp); // alias

router.post('/login/verify', async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) return res.status(400).json({ error: 'email and otp are required' });
    const result = await authService.verifyLoginOtp({
      email, otp,
      ipAddress: clientIp(req),
      ...deviceInfo(req),
    });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/login/pin', async (req, res) => {
  try {
    const { email, pin } = req.body;
    if (!email || !pin) return res.status(400).json({ error: 'email and pin are required' });
    const result = await authService.loginWithPin({
      email,
      pin,
      ipAddress: clientIp(req),
      ...deviceInfo(req),
    });
    res.json({ success: true, ...result });
  } catch (err) {
    const code = err.code || 'PIN_LOGIN_FAILED';
    const rawMessage = String(err.message || 'PIN login failed');
    // Never leak ReferenceError / misconfig internals to the UI
    const message = /User is not defined/i.test(rawMessage)
      ? 'Sign-in is temporarily unavailable. Please try again or use email OTP.'
      : rawMessage;
    const status =
      code === 'EMAIL_REQUIRED' ||
      code === 'INVALID_PIN_FORMAT' ||
      code === 'USER_NOT_FOUND' ||
      code === 'PIN_NOT_SET'
        ? 400
        : code === 'USER_LOOKUP_FAILED' || /User is not defined/i.test(rawMessage)
          ? 500
          : 401;
    console.warn('[auth] PIN login failed:', code, rawMessage);
    res.status(status).json({ error: message, code });
  }
});

// ─── PIN ────────────────────────────────────────────────────────

router.post('/pin/set', requireAuth, async (req, res) => {
  try {
    const { pin, confirm_pin } = req.body;
    if (!pin) return res.status(400).json({ error: 'pin is required' });
    const result = await authService.setPin(req.user.id, pin, confirm_pin || pin);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/pin/verify', requireAuth, async (req, res) => {
  try {
    const { pin } = req.body;
    if (!pin) return res.status(400).json({ error: 'pin is required' });
    const result = await authService.verifyPinCode(req.user.id, pin);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(401).json({ error: err.message, code: 'PIN_INVALID' });
  }
});

router.post('/pin/reset-default', requireAuth, async (req, res) => {
  try {
    const result = await authService.resetPinToDefault(req.user.id);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/password/change', requireAuth, async (req, res) => {
  try {
    const { current_password, new_password, confirm_password } = req.body;
    const result = await authService.changePassword(req.user.id, {
      currentPassword: current_password,
      newPassword: new_password,
      confirmPassword: confirm_password,
    });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── Biometrics ─────────────────────────────────────────────────

router.post('/biometrics/register', requireAuth, async (req, res) => {
  try {
    const { device_token, device_name } = req.body;
    if (!device_token) return res.status(400).json({ error: 'device_token is required' });
    const result = await authService.registerBiometrics(req.user.id, device_token, device_name);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/biometrics/login', async (req, res) => {
  try {
    const { email, device_token } = req.body;
    if (!email || !device_token) {
      return res.status(400).json({ error: 'email and device_token are required' });
    }
    const { deviceName, devicePlatform } = deviceInfo(req);
    const result = await authService.verifyBiometrics(
      email, device_token, clientIp(req), deviceName, devicePlatform
    );
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

// ─── Session ────────────────────────────────────────────────────

router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await authService.getMe(req.user.id);
    res.json({ success: true, user });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

router.post('/logout', requireAuth, async (req, res) => {
  try {
    await UserSession.revoke(req.sessionToken);
    res.json({ success: true, message: 'Logged out' });
  } catch (err) {
    res.status(500).json({ error: 'Logout failed' });
  }
});

module.exports = router;
