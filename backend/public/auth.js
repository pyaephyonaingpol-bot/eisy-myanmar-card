/* Eisy Myanmar — Auth client & session store */
const Auth = {
  get STORAGE_KEY() {
    return (window.Eisy && window.Eisy.storageKeys && window.Eisy.storageKeys.AUTH) || 'eisy_auth';
  },
  get BIO_KEY() {
    return (window.Eisy && window.Eisy.storageKeys && window.Eisy.storageKeys.BIO_TOKEN) || 'eisy_bio_token';
  },
  get DEVICE_KEY() {
    return (window.Eisy && window.Eisy.storageKeys && window.Eisy.storageKeys.DEVICE) || 'eisy_device';
  },

  /** In-memory session mirror — avoids repeated JSON.parse on every getter. */
  _mem: undefined,

  load() {
    if (this._mem !== undefined) return this._mem;
    try {
      this._mem = JSON.parse(localStorage.getItem(this.STORAGE_KEY) || 'null');
    } catch {
      this._mem = null;
    }
    return this._mem;
  },

  save(data) {
    this._mem = data;
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(data));
    } catch (err) {
      console.error('[Auth] Failed to persist session to localStorage:', err);
    }
  },

  clear() {
    this._mem = null;
    localStorage.removeItem(this.STORAGE_KEY);
  },

  getDeviceProfile() {
    try {
      return JSON.parse(localStorage.getItem(this.DEVICE_KEY) || 'null');
    } catch {
      return null;
    }
  },

  saveDeviceProfile({ email, biometricsEnabled }) {
    if (!email) return;
    const prev = this.getDeviceProfile() || {};
    localStorage.setItem(this.DEVICE_KEY, JSON.stringify({
      ...prev,
      email: String(email).trim().toLowerCase(),
      biometricsEnabled: biometricsEnabled ?? prev.biometricsEnabled ?? Boolean(this.biometricToken),
      savedAt: Date.now(),
    }));
  },

  rememberAuthSuccess(data, email) {
    const resolvedEmail = email || data?.user?.email;
    if (resolvedEmail) {
      this.saveDeviceProfile({
        email: resolvedEmail,
        biometricsEnabled: Boolean(data?.user?.biometrics_enabled) || Boolean(this.biometricToken),
      });
    }
  },

  get sessionToken() { return this.load()?.sessionToken || null; },
  get pinToken() { return this.load()?.pinToken || null; },
  get user() { return this.load()?.user || null; },
  get biometricToken() { return localStorage.getItem(this.BIO_KEY); },

  pinTokenExpiresAt() {
    const saved = this.load();
    if (!saved?.pinTokenExpiresAt) return null;
    return Number(saved.pinTokenExpiresAt) || null;
  },

  isPinTokenExpired() {
    const exp = this.pinTokenExpiresAt();
    if (!exp) return false;
    return Date.now() >= exp;
  },

  applyPinToken(pinToken, expiresInSeconds) {
    const prev = this.load() || {};
    const ttlMs = Math.max(60, Number(expiresInSeconds) || 168 * 60 * 60) * 1000;
    const next = {
      ...prev,
      pinToken,
      pinTokenExpiresAt: Date.now() + ttlMs,
    };
    this.save(next);
    return next;
  },

  setSession({ sessionToken, user, pinToken, pinTokenExpiresInSeconds, sessionExpiresAt }) {
    const prev = this.load() || {};
    const next = {
      sessionToken,
      user,
      savedAt: Date.now(),
    };

    if (sessionExpiresAt) {
      next.sessionExpiresAt = sessionExpiresAt;
    } else if (sessionToken === prev.sessionToken && prev.sessionExpiresAt) {
      next.sessionExpiresAt = prev.sessionExpiresAt;
    }

    if (pinToken !== undefined) {
      if (pinToken) {
        next.pinToken = pinToken;
        const ttlSec = pinTokenExpiresInSeconds || 168 * 60 * 60;
        next.pinTokenExpiresAt = Date.now() + ttlSec * 1000;
      }
    } else if (sessionToken === prev.sessionToken && prev.pinToken && !this.isPinTokenExpired()) {
      next.pinToken = prev.pinToken;
      next.pinTokenExpiresAt = prev.pinTokenExpiresAt;
    }

    this.save(next);
  },

  setPinToken(pinToken, expiresInSeconds) {
    this.applyPinToken(pinToken, expiresInSeconds);
  },

  setBiometricToken(token) {
    localStorage.setItem(this.BIO_KEY, token);
  },

  headers({ sensitive = false } = {}) {
    const h = { 'Content-Type': 'application/json' };
    if (this.sessionToken) h['Authorization'] = `Bearer ${this.sessionToken}`;
    if (sensitive && this.pinToken && !this.isPinTokenExpired()) {
      h['X-Pin-Token'] = this.pinToken;
    }
    if (sensitive && this.biometricToken) h['X-Biometric-Token'] = this.biometricToken;
    return h;
  },

  async api(method, path, body, opts = {}) {
    if (window.__EISY_DEBUG_API) console.log(`[Auth.api] ${method} ${path}`, body || '');
    const timeoutMs = Number.isFinite(opts.timeoutMs)
      ? Math.max(1000, opts.timeoutMs)
      : 25000;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let timer = null;
    if (controller) {
      timer = setTimeout(() => {
        try {
          controller.abort();
        } catch (_) { /* ignore */ }
      }, timeoutMs);
    }
    try {
      const res = await fetch(path, {
        method,
        headers: this.headers(opts),
        body: body ? JSON.stringify(body) : undefined,
        cache: opts.sensitive ? 'no-store' : 'default',
        signal: controller?.signal,
      });
      const text = await res.text();
      let data = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch (parseErr) {
        console.error('[Auth.api] JSON parse error', parseErr, text);
        throw new Error(`Invalid server response (${res.status})`);
      }

      if (window.__EISY_DEBUG_API) console.log(`[Auth.api] ${method} ${path} → ${res.status}`, data);

      if (!res.ok) {
        const err = new Error(data.error || `HTTP ${res.status}`);
        err.code = data.code;
        err.status = res.status;
        err.response = data;
        console.error('[Auth.api] Request failed:', err.message, data);
        throw err;
      }
      return data;
    } catch (err) {
      if (err?.name === 'AbortError' || controller?.signal?.aborted) {
        const timeoutErr = new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s`);
        timeoutErr.code = 'REQUEST_TIMEOUT';
        timeoutErr.status = 408;
        console.error('[Auth.api] Timeout:', method, path);
        throw timeoutErr;
      }
      if (!err.message?.includes('HTTP')) {
        console.error('[Auth.api] Network or unexpected error:', err);
      }
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
  },

  async apiForm(path, formData, opts = {}) {
    const h = {};
    if (this.sessionToken) h['Authorization'] = `Bearer ${this.sessionToken}`;
    if (opts.sensitive && this.pinToken && !this.isPinTokenExpired()) {
      h['X-Pin-Token'] = this.pinToken;
    }
    if (opts.sensitive && this.biometricToken) h['X-Biometric-Token'] = this.biometricToken;

    const res = await fetch(path, { method: 'POST', headers: h, body: formData });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      let message = data.error || `HTTP ${res.status}`;
      if (res.status === 413) {
        message = data.error
          || 'Upload too large — please use smaller photos (each under 1MB after compression).';
      }
      const err = new Error(message);
      err.code = data.code || (res.status === 413 ? 'PAYLOAD_TOO_LARGE' : undefined);
      err.status = res.status;
      throw err;
    }
    return data;
  },

  authPayload(data) {
    return {
      sessionExpiresAt: data.session_expires_at,
      pinTokenExpiresInSeconds: data.expires_in_seconds,
    };
  },

  async sendRegisterOtp(email) {
    return this.api('POST', '/api/auth/register/send-otp', { email });
  },

  async completeRegister({ email, otp, name, phone, pin }) {
    const payload = {
      email, otp, name, phone,
    };
    if (pin) {
      payload.pin = pin;
      payload.confirm_pin = pin;
    }
    const data = await this.api('POST', '/api/auth/register/complete', payload);
    const hasPin = data.has_pin ?? Boolean(data.pin_token || pin);
    const user = {
      ...data.user,
      has_pin: hasPin,
    };
    this.setSession({
      sessionToken: data.sessionToken,
      user,
      pinToken: data.pin_token || null,
      ...this.authPayload(data),
    });
    this.rememberAuthSuccess(data, email);
    return { ...data, user, has_pin: hasPin, needs_pin_setup: data.needs_pin_setup ?? !hasPin };
  },

  async sendLoginOtp(email) {
    return this.api('POST', '/api/auth/login/send-otp', { email });
  },

  async loginWithPin(email, pin) {
    if (!email || !String(email).trim()) {
      throw Object.assign(new Error('Email is required'), { code: 'EMAIL_REQUIRED' });
    }
    if (!pin || !String(pin).trim()) {
      throw Object.assign(new Error('PIN is required'), { code: 'PIN_REQUIRED' });
    }
    let data;
    try {
      data = await this.api('POST', '/api/auth/login/pin', {
        email: String(email).trim().toLowerCase(),
        pin: String(pin).trim(),
      });
    } catch (err) {
      if (/User is not defined/i.test(String(err?.message || ''))) {
        throw Object.assign(
          new Error('Sign-in is temporarily unavailable. Please try again or use email OTP.'),
          { code: err.code || 'AUTH_SERVICE_ERROR', status: err.status }
        );
      }
      throw err;
    }
    if (!data?.user || !data?.sessionToken) {
      throw Object.assign(
        new Error(data?.error || 'PIN login succeeded but no user session was returned'),
        { code: 'SESSION_INCOMPLETE' }
      );
    }
    const user = {
      ...data.user,
      has_pin: data.has_pin ?? Boolean(data.user?.has_pin),
    };
    this.setSession({
      sessionToken: data.sessionToken,
      user,
      pinToken: data.pin_token || null,
      ...this.authPayload(data),
    });
    this.rememberAuthSuccess(data, email);
    return { ...data, user };
  },

  async verifyLoginOtp(email, otp) {
    const data = await this.api('POST', '/api/auth/login/verify', { email, otp });
    const user = {
      ...data.user,
      has_pin: data.has_pin ?? Boolean(data.user?.has_pin),
    };
    this.setSession({
      sessionToken: data.sessionToken,
      user,
      pinToken: data.pin_token || null,
      ...this.authPayload(data),
    });
    this.rememberAuthSuccess(data, email);
    return { ...data, user };
  },

  async verifyPin(pin) {
    const data = await this.api('POST', '/api/auth/pin/verify', { pin });
    this.setPinToken(data.pin_token, data.expires_in_seconds);
    if (data.has_pin && this.user) {
      this.setSession({
        sessionToken: this.sessionToken,
        user: { ...this.user, has_pin: true },
        pinToken: data.pin_token,
        pinTokenExpiresInSeconds: data.expires_in_seconds,
      });
    }
    return data;
  },

  async resetPinToDefault() {
    const data = await this.api('POST', '/api/auth/pin/reset-default', {});
    this.setPinToken(data.pin_token, data.expires_in_seconds);
    if (this.user) {
      this.setSession({
        sessionToken: this.sessionToken,
        user: { ...this.user, has_pin: true },
        pinToken: data.pin_token,
        pinTokenExpiresInSeconds: data.expires_in_seconds,
      });
    }
    return data;
  },

  async sendPinResetOtp(email) {
    const target = (email || this.user?.email || '').trim();
    if (!target) throw new Error('Email is required to reset your PIN');
    return this.api('POST', '/api/auth/pin/reset/send-otp', { email: target });
  },

  async completePinReset({ email, otp, pin, confirmPin }) {
    const data = await this.api('POST', '/api/auth/pin/reset/confirm', {
      email: (email || this.user?.email || '').trim(),
      otp,
      pin,
      confirm_pin: confirmPin || pin,
    });
    const user = {
      ...data.user,
      has_pin: true,
    };
    this.setSession({
      sessionToken: data.sessionToken,
      user,
      pinToken: data.pin_token,
      ...this.authPayload(data),
    });
    this.rememberAuthSuccess(data, user.email);
    return { ...data, user };
  },

  async setPin(pin) {
    const data = await this.api('POST', '/api/auth/pin/set', { pin, confirm_pin: pin });
    this.setPinToken(data.pin_token, data.expires_in_seconds);
    if (this.user) {
      this.setSession({
        sessionToken: this.sessionToken,
        user: { ...this.user, has_pin: true },
        pinToken: data.pin_token,
        pinTokenExpiresInSeconds: data.expires_in_seconds,
      });
    }
    return data;
  },

  async changePassword({ currentPassword, newPassword, confirmPassword }) {
    const data = await this.api('POST', '/api/auth/password/change', {
      current_password: currentPassword || '',
      new_password: newPassword,
      confirm_password: confirmPassword,
    });
    if (this.user) {
      this.setSession({
        sessionToken: this.sessionToken,
        user: { ...this.user, has_password: true },
        pinToken: this.pinToken,
        pinTokenExpiresInSeconds: Math.max(0, Math.floor(((this.pinTokenExpiresAt() || 0) - Date.now()) / 1000)),
      });
    }
    return data;
  },

  async registerBiometrics() {
    let token = this.biometricToken;
    if (!token) {
      token = Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map((b) => b.toString(16).padStart(2, '0')).join('');
      this.setBiometricToken(token);
    }
    return this.api('POST', '/api/auth/biometrics/register', {
      device_token: token,
      device_name: 'Web Browser',
    });
  },

  async biometricLogin(email) {
    const token = this.biometricToken;
    if (!token) throw new Error('Biometrics not set up on this device');
    const resolvedEmail = (email || this.getDeviceProfile()?.email || this.user?.email || '').trim();
    if (!resolvedEmail) throw new Error('Enter your email or log in once to enable biometric login');
    const data = await this.api('POST', '/api/auth/biometrics/login', { email: resolvedEmail, device_token: token });
    this.setSession({
      sessionToken: data.sessionToken,
      user: data.user,
      pinToken: data.pin_token,
      ...this.authPayload(data),
    });
    this.rememberAuthSuccess(data, resolvedEmail);
    return data;
  },

  /** Start Google OAuth via Supabase (redirects to Google, then /auth/callback). */
  async loginWithGoogle() {
    const cfg = await this.getSupabasePublicConfig();
    if (!cfg?.enabled || !cfg.url || !cfg.anonKey) {
      throw new Error(this.supabaseConfigError(cfg));
    }

    // Prefer the shared bridge when ready; otherwise create a dedicated auth client.
    const bridge = window.SupabaseBridge;
    if (bridge?.signInWithGoogle) {
      try {
        const data = await bridge.signInWithGoogle({
          redirectTo: `${window.location.origin}/auth/callback`,
        });
        if (data?.url) {
          window.location.assign(data.url);
        }
        return data;
      } catch (err) {
        // Fall through to a direct client if the bridge path fails spuriously.
        console.warn('[Auth] bridge Google sign-in failed, retrying direct client:', err?.message || err);
      }
    }

    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    const client = createClient(cfg.url, cfg.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
        storageKey: 'eisy-supabase-auth',
      },
    });
    const { data, error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        queryParams: { access_type: 'offline', prompt: 'select_account' },
      },
    });
    if (error) throw error;
    if (data?.url) {
      window.location.assign(data.url);
    }
    return data;
  },

  /** Finish Google OAuth on /auth/callback and create an app session. */
  async completeGoogleOAuth() {
    const cfg = await this.getSupabasePublicConfig();
    if (!cfg?.enabled || !cfg.url || !cfg.anonKey) {
      throw new Error(this.supabaseConfigError(cfg));
    }

    let accessToken = null;
    const bridge = window.SupabaseBridge;
    if (bridge?.getOAuthAccessToken) {
      try {
        const result = await bridge.getOAuthAccessToken();
        accessToken = result?.accessToken || null;
      } catch (err) {
        console.warn('[Auth] bridge OAuth session exchange failed, retrying direct client:', err?.message || err);
      }
    }

    if (!accessToken) {
      const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
      const client = createClient(cfg.url, cfg.anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          flowType: 'pkce',
          storageKey: 'eisy-supabase-auth',
        },
      });
      const url = new URL(window.location.href);
      if (url.searchParams.get('code')) {
        const { data, error } = await client.auth.exchangeCodeForSession(window.location.href);
        if (error) throw error;
        accessToken = data?.session?.access_token || null;
      } else {
        const { data, error } = await client.auth.getSession();
        if (error) throw error;
        accessToken = data?.session?.access_token || null;
      }
    }

    if (!accessToken) {
      throw new Error('Google Sign-In did not return a session — please try again');
    }

    const data = await this.api('POST', '/api/auth/oauth/google', {
      access_token: accessToken,
    });
    if (!data?.user || !data?.sessionToken) {
      throw Object.assign(
        new Error(data?.error || 'Google Sign-In succeeded but no session was returned'),
        { code: 'SESSION_INCOMPLETE' }
      );
    }
    const user = {
      ...data.user,
      has_pin: data.has_pin ?? Boolean(data.user?.has_pin),
    };
    this.setSession({
      sessionToken: data.sessionToken,
      user,
      pinToken: data.pin_token || null,
      ...this.authPayload(data),
    });
    this.rememberAuthSuccess(data, user.email);
    return { ...data, user };
  },

  async getSupabasePublicConfig() {
    if (window.__EISY_SUPABASE_PUBLIC__?.enabled
      && window.__EISY_SUPABASE_PUBLIC__.url
      && window.__EISY_SUPABASE_PUBLIC__.anonKey) {
      return window.__EISY_SUPABASE_PUBLIC__;
    }

    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const res = await fetch('/api/config/supabase', {
          credentials: 'same-origin',
          cache: 'no-store',
        });
        if (!res.ok) {
          lastErr = new Error(`Config request failed (${res.status})`);
        } else {
          const cfg = await res.json();
          if (cfg?.enabled && cfg.url && (cfg.anonKey || cfg.anon_key)) {
            const normalized = {
              enabled: true,
              url: String(cfg.url).trim(),
              anonKey: String(cfg.anonKey || cfg.anon_key).trim(),
              reason: cfg.reason || 'ok',
            };
            window.__EISY_SUPABASE_PUBLIC__ = normalized;
            return normalized;
          }
          return {
            enabled: false,
            url: null,
            anonKey: null,
            reason: cfg?.reason || 'missing_credentials',
          };
        }
      } catch (err) {
        lastErr = err;
      }
      await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
    }
    throw lastErr || new Error('Could not load Supabase config');
  },

  supabaseConfigError(cfg) {
    const reason = cfg?.reason || 'missing_credentials';
    if (reason === 'missing_anon_key') {
      return 'Google Sign-In needs NEXT_PUBLIC_SUPABASE_ANON_KEY on the server';
    }
    if (reason === 'missing_url') {
      return 'Google Sign-In needs NEXT_PUBLIC_SUPABASE_URL on the server';
    }
    if (reason === 'missing_url_and_anon_key') {
      return 'Google Sign-In needs NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY on the server';
    }
    return 'Google Sign-In is temporarily unavailable — please try again';
  },

  async logout() {
    try { await this.api('POST', '/api/auth/logout', {}); } catch (_) {}
    this.clear();
  },

  hasSavedDevice() {
    return Boolean(this.getDeviceProfile()?.email);
  },

  canUseBiometricLogin() {
    return Boolean(this.biometricToken && this.getDeviceProfile()?.email);
  },

  initLoginPanel() {
    const profile = this.getDeviceProfile();
    const emailInput = document.getElementById('loginEmail');
    const pinInput = document.getElementById('loginPin');
    const otpSection = document.getElementById('loginOtpSection');
    const showOtpBtn = document.getElementById('showOtpLoginBtn');
    const bioBtn = document.getElementById('bioLoginBtn');

    if (emailInput && profile?.email && !emailInput.value.trim()) {
      emailInput.value = profile.email;
    }

    if (otpSection && profile?.email) {
      otpSection.classList.add('hidden');
    }

    if (showOtpBtn && otpSection) {
      showOtpBtn.onclick = () => {
        otpSection.classList.toggle('hidden');
        showOtpBtn.textContent = otpSection.classList.contains('hidden')
          ? 'Use email OTP instead'
          : 'Back to PIN login';
      };
    }

    if (bioBtn) {
      bioBtn.classList.toggle('hidden', !this.canUseBiometricLogin());
    }

    pinInput?.focus();
  },

  isLoggedIn() { return Boolean(this.sessionToken); },

  needsPinUnlock() {
    return this.isLoggedIn() && (!this.pinToken || this.isPinTokenExpired());
  },

  /** Revalidate stored session on page load; clears stale tokens on 401. */
  async restoreSession() {
    if (!this.sessionToken) return false;
    if (this.isPinTokenExpired()) {
      const prev = this.load() || {};
      delete prev.pinToken;
      delete prev.pinTokenExpiresAt;
      this.save(prev);
    }
    try {
      const data = await this.api('GET', '/api/auth/me');
      if (data?.user) {
        this.setSession({
          sessionToken: this.sessionToken,
          user: data.user,
          pinToken: this.pinToken,
          pinTokenExpiresInSeconds: Math.max(0, Math.floor(((this.pinTokenExpiresAt() || 0) - Date.now()) / 1000)),
        });
        this.rememberAuthSuccess({ user: data.user });
        return true;
      }
    } catch (err) {
      if (err.status === 401 || err.code === 'SESSION_INVALID') {
        console.warn('[Auth] Session expired — clearing stored credentials');
        this.clear();
      } else {
        console.warn('[Auth] Session restore skipped (transient error):', err.message);
        const cached = this.load();
        if (cached?.sessionToken && cached?.user) {
          return true;
        }
      }
    }
    return Boolean(this.sessionToken && this.user);
  },
};

window.Auth = Auth;
