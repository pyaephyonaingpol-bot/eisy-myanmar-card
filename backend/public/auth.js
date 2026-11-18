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
  /** Skip redundant GET /api/auth/me immediately after login/register. */
  _sessionFreshUntil: 0,

  markSessionFresh(ttlMs = 120000) {
    this._sessionFreshUntil = Date.now() + Math.max(5000, ttlMs);
  },

  isSessionFresh() {
    return Boolean(this._sessionFreshUntil && Date.now() < this._sessionFreshUntil);
  },

  /** Live session dies with the tab. A leftover localStorage copy is moved once. */
  readStoredSession() {
    try {
      const current = sessionStorage.getItem(this.STORAGE_KEY);
      if (current) return current;
    } catch (_) { /* private mode */ }
    try {
      const legacy = localStorage.getItem(this.STORAGE_KEY);
      if (!legacy) return null;
      try { sessionStorage.setItem(this.STORAGE_KEY, legacy); } catch (_) { /* ignore */ }
      try { localStorage.removeItem(this.STORAGE_KEY); } catch (_) { /* ignore */ }
      return legacy;
    } catch (_) {
      return null;
    }
  },

  load() {
    if (this._mem !== undefined) return this._mem;
    try {
      this._mem = JSON.parse(this.readStoredSession() || 'null');
    } catch {
      this._mem = null;
    }
    return this._mem;
  },

  save(data) {
    this._mem = data;
    const raw = JSON.stringify(data);
    try {
      sessionStorage.setItem(this.STORAGE_KEY, raw);
    } catch (err) {
      console.error('[Auth] Failed to persist session:', err);
    }
    try { localStorage.removeItem(this.STORAGE_KEY); } catch (_) { /* tab session only */ }
  },

  clear() {
    this._mem = null;
    try { sessionStorage.removeItem(this.STORAGE_KEY); } catch (_) { /* ignore */ }
    try { localStorage.removeItem(this.STORAGE_KEY); } catch (_) { /* ignore */ }
  },

  IDLE_LIMIT_MS: 20 * 60 * 1000,

  startIdleWatch() {
    if (this._idleWatching) return;
    this._idleWatching = true;
    this._lastActivityAt = Date.now();
    const bump = () => {
      const now = Date.now();
      if (now - (this._lastActivityAt || 0) < 1000) return;
      this._lastActivityAt = now;
    };
    ['mousemove', 'mousedown', 'click', 'keydown', 'touchstart', 'scroll', 'wheel'].forEach((name) => {
      window.addEventListener(name, bump, { passive: true });
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.checkIdle();
    });
    this._idleTimer = setInterval(() => this.checkIdle(), 15000);
  },

  checkIdle() {
    if (!this.isLoggedIn() || this._idleLoggingOut) return;
    const idleFor = Date.now() - (this._lastActivityAt || Date.now());
    if (idleFor >= this.IDLE_LIMIT_MS) this.logoutForInactivity();
  },

  async logoutForInactivity() {
    if (this._idleLoggingOut || !this.isLoggedIn()) return;
    this._idleLoggingOut = true;
    const token = this.sessionToken;
    try { sessionStorage.setItem('eisy_logout_notice', 'inactive'); } catch (_) { /* ignore */ }
    this.clear();
    window.dispatchEvent(new CustomEvent('eisy:session-end', { detail: { reason: 'inactive' } }));
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: '{}',
      });
    } catch (_) { /* the tab session is already gone */ }
    this._idleLoggingOut = false;
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

  _apiInflight: {},

  /**
   * Default client fetch timeout. Kept under Vercel maxDuration (60s) so the
   * SPA can wait for slow card/wallet routes without premature 408s.
   * Override per-call with opts.timeoutMs, or globally via window.__EISY_API_TIMEOUT_MS.
   */
  DEFAULT_API_TIMEOUT_MS: 45000,

  _resolveTimeoutMs(opts = {}) {
    if (Number.isFinite(opts.timeoutMs)) return Math.max(1000, opts.timeoutMs);
    const globalMs = Number(typeof window !== 'undefined' ? window.__EISY_API_TIMEOUT_MS : NaN);
    if (Number.isFinite(globalMs) && globalMs >= 1000) return globalMs;
    return this.DEFAULT_API_TIMEOUT_MS || 45000;
  },

  _normalizeFetchError(err, { method, path, timeoutMs, timedOut, abortedByCaller }) {
    if (timedOut) {
      const timeoutErr = new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s`);
      timeoutErr.code = 'REQUEST_TIMEOUT';
      timeoutErr.status = 408;
      timeoutErr.path = path;
      timeoutErr.method = method;
      console.warn('[Auth.api] Timeout:', method, path, `(${timeoutMs}ms)`);
      return timeoutErr;
    }
    if (abortedByCaller || err?.name === 'AbortError') {
      const abortErr = new Error('Request cancelled');
      abortErr.code = 'REQUEST_ABORTED';
      abortErr.status = 499;
      abortErr.path = path;
      abortErr.method = method;
      return abortErr;
    }
    const rawMsg = String(err?.message || '');
    if (
      !err?.code
      && (err?.name === 'TypeError' || /fetch failed|failed to fetch|networkerror|load failed/i.test(rawMsg))
    ) {
      const netErr = new Error('Could not reach the server. Check your connection and try again.');
      netErr.code = 'NETWORK_ERROR';
      netErr.status = 0;
      netErr.cause = err;
      netErr.path = path;
      netErr.method = method;
      console.warn('[Auth.api] Network error:', method, path, rawMsg);
      return netErr;
    }
    return err;
  },

  async api(method, path, body, opts = {}) {
    if (window.__EISY_DEBUG_API) console.log(`[Auth.api] ${method} ${path}`, body || '');
    const m = String(method || 'GET').toUpperCase();
    const dedupeKey = m === 'GET' && !opts.force && !opts.skipDedupe
      ? `${path}|${opts.sensitive ? 's' : 'n'}`
      : null;
    if (dedupeKey && this._apiInflight[dedupeKey]) {
      return this._apiInflight[dedupeKey];
    }

    const timeoutMs = this._resolveTimeoutMs(opts);
    const externalSignal = opts.signal || null;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let timer = null;
    let timedOut = false;
    let abortedByCaller = false;

    const onExternalAbort = () => {
      abortedByCaller = true;
      try { controller?.abort(); } catch (_) { /* ignore */ }
    };
    if (externalSignal) {
      if (externalSignal.aborted) onExternalAbort();
      else externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }

    if (controller) {
      timer = setTimeout(() => {
        timedOut = true;
        try {
          controller.abort();
        } catch (_) { /* ignore */ }
      }, timeoutMs);
    }

    const run = (async () => {
      try {
        const res = await fetch(path, {
          method: m,
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

        if (window.__EISY_DEBUG_API) console.log(`[Auth.api] ${m} ${path} → ${res.status}`, data);

        if (!res.ok) {
          const err = new Error(data.error || `HTTP ${res.status}`);
          err.code = data.code;
          err.status = res.status;
          err.response = data;
          if (
            res.status === 401
            && (data.code === 'SESSION_SUPERSEDED' || data.code === 'SESSION_INVALID')
            && this.sessionToken
          ) {
            try {
              if (data.code === 'SESSION_SUPERSEDED') {
                sessionStorage.setItem('eisy_logout_notice', 'superseded');
              }
            } catch (_) { /* ignore */ }
            this.clear();
            window.dispatchEvent(new CustomEvent('eisy:session-end', {
              detail: { reason: data.code === 'SESSION_SUPERSEDED' ? 'superseded' : 'invalid' },
            }));
          }
          console.error('[Auth.api] Request failed:', err.message, data);
          throw err;
        }
        return data;
      } catch (err) {
        if (
          timedOut
          || abortedByCaller
          || err?.name === 'AbortError'
          || controller?.signal?.aborted
        ) {
          throw this._normalizeFetchError(err, {
            method: m,
            path,
            timeoutMs,
            timedOut: timedOut && !abortedByCaller,
            abortedByCaller,
          });
        }
        const normalized = this._normalizeFetchError(err, {
          method: m,
          path,
          timeoutMs,
          timedOut: false,
          abortedByCaller: false,
        });
        if (normalized !== err && !String(err?.message || '').includes('HTTP')) {
          /* already logged inside helper for network */
        } else if (!err.message?.includes('HTTP')) {
          console.error('[Auth.api] Network or unexpected error:', err);
        }
        throw normalized;
      } finally {
        if (timer) clearTimeout(timer);
        if (externalSignal) {
          try { externalSignal.removeEventListener('abort', onExternalAbort); } catch (_) { /* ignore */ }
        }
      }
    })();

    if (dedupeKey) {
      this._apiInflight[dedupeKey] = run;
      run.finally(() => {
        if (this._apiInflight[dedupeKey] === run) delete this._apiInflight[dedupeKey];
      });
    }
    // Soft-handle so fire-and-forget callers do not trigger unhandledrejection;
    // awaiters still receive the rejection.
    run.catch(() => {});
    return run;
  },

  async apiForm(path, formData, opts = {}) {
    const h = {};
    if (this.sessionToken) h['Authorization'] = `Bearer ${this.sessionToken}`;
    if (opts.sensitive && this.pinToken && !this.isPinTokenExpired()) {
      h['X-Pin-Token'] = this.pinToken;
    }
    if (opts.sensitive && this.biometricToken) h['X-Biometric-Token'] = this.biometricToken;

    const timeoutMs = this._resolveTimeoutMs(opts);
    const externalSignal = opts.signal || null;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let timer = null;
    let timedOut = false;
    let abortedByCaller = false;
    const onExternalAbort = () => {
      abortedByCaller = true;
      try { controller?.abort(); } catch (_) { /* ignore */ }
    };
    if (externalSignal) {
      if (externalSignal.aborted) onExternalAbort();
      else externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
    if (controller) {
      timer = setTimeout(() => {
        timedOut = true;
        try { controller.abort(); } catch (_) { /* ignore */ }
      }, timeoutMs);
    }

    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: h,
        body: formData,
        signal: controller?.signal,
      });
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
    } catch (err) {
      if (
        timedOut
        || abortedByCaller
        || err?.name === 'AbortError'
        || controller?.signal?.aborted
      ) {
        throw this._normalizeFetchError(err, {
          method: 'POST',
          path,
          timeoutMs,
          timedOut: timedOut && !abortedByCaller,
          abortedByCaller,
        });
      }
      throw this._normalizeFetchError(err, {
        method: 'POST',
        path,
        timeoutMs,
        timedOut: false,
        abortedByCaller: false,
      });
    } finally {
      if (timer) clearTimeout(timer);
      if (externalSignal) {
        try { externalSignal.removeEventListener('abort', onExternalAbort); } catch (_) { /* ignore */ }
      }
    }
  },

  authPayload(data) {
    return {
      sessionExpiresAt: data.session_expires_at,
      pinTokenExpiresInSeconds: data.expires_in_seconds,
    };
  },

  assertGmailOnlyEmail(email) {
    const normalized = String(email || '').trim().toLowerCase();
    if (!normalized.endsWith('@gmail.com')) {
      throw Object.assign(
        new Error('Gmail accounts only. Other email providers are not allowed for OTP.'),
        { code: 'GMAIL_ONLY_REQUIRED' }
      );
    }
    return normalized;
  },

  async sendRegisterOtp(email) {
    this.assertGmailOnlyEmail(email);
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
    this.markSessionFresh();
    this.rememberAuthSuccess(data, email);
    return { ...data, user, has_pin: hasPin, needs_pin_setup: data.needs_pin_setup ?? !hasPin };
  },

  async sendLoginOtp(email) {
    this.assertGmailOnlyEmail(email);
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
    this.markSessionFresh();
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
    this.markSessionFresh();
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
    this.assertGmailOnlyEmail(target);
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

  _supabaseAuthClientOptions(cfg) {
    return {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        flowType: 'pkce',
        // Shared across bridge + Auth so the PKCE verifier survives redirect.
        storageKey: 'eisy-supabase-auth',
      },
    };
  },

  async waitForSupabaseBridge(timeoutMs = 2500) {
    if (window.SupabaseBridge?.getOAuthAccessToken) return window.SupabaseBridge;
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      await new Promise((r) => setTimeout(r, 40));
      if (window.SupabaseBridge?.getOAuthAccessToken) return window.SupabaseBridge;
    }
    return window.SupabaseBridge || null;
  },

  /** Start Google OAuth via Supabase (redirects to Google, then /auth/callback). */
  async loginWithGoogle() {
    const cfg = await this.getSupabasePublicConfig();
    if (!cfg?.enabled || !cfg.url || !cfg.anonKey) {
      throw new Error(this.supabaseConfigError(cfg));
    }

    const redirectTo = `${window.location.origin}/auth/callback`;

    // Prefer the shared bridge when ready; otherwise create a dedicated auth client.
    const bridge = await this.waitForSupabaseBridge(800);
    if (bridge?.signInWithGoogle) {
      try {
        // Bridge navigates itself after PKCE verifier is persisted.
        return await bridge.signInWithGoogle({ redirectTo });
      } catch (err) {
        // Fall through to a direct client if the bridge path fails spuriously.
        console.warn('[Auth] bridge Google sign-in failed, retrying direct client:', err?.message || err);
      }
    }

    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.4/+esm');
    const client = createClient(cfg.url, cfg.anonKey, this._supabaseAuthClientOptions(cfg));
    const { data, error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        skipBrowserRedirect: true,
        queryParams: { access_type: 'offline', prompt: 'select_account' },
      },
    });
    if (error) throw error;
    if (data?.url) {
      window.location.assign(data.url);
    }
    return data;
  },

  /**
   * Recover a Supabase access token from the OAuth callback URL (PKCE) or
   * from an already-persisted session (first-try recovery after a race).
   */
  async recoverGoogleAccessToken() {
    const cfg = await this.getSupabasePublicConfig();
    if (!cfg?.enabled || !cfg.url || !cfg.anonKey) {
      throw new Error(this.supabaseConfigError(cfg));
    }

    const bridge = await this.waitForSupabaseBridge(2500);
    if (bridge?.getOAuthAccessToken) {
      try {
        const result = await bridge.getOAuthAccessToken();
        if (result?.accessToken) return result.accessToken;
      } catch (err) {
        console.warn('[Auth] bridge OAuth session exchange failed, trying direct client:', err?.message || err);
      }
    }

    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.4/+esm');
    const client = createClient(cfg.url, cfg.anonKey, this._supabaseAuthClientOptions(cfg));
    const callbackUrl = new URL(window.location.href);
    const callbackError = callbackUrl.searchParams.get('error_description')
      || callbackUrl.searchParams.get('error');
    if (callbackError) throw new Error(callbackError);

    // Prefer an existing session (code already exchanged by bridge / prior attempt).
    // Same storageKey as the bridge — session should be visible here.
    const existing = await client.auth.getSession();
    if (existing.data?.session?.access_token) {
      return existing.data.session.access_token;
    }

    const code = callbackUrl.searchParams.get('code');
    const flowId = callbackUrl.searchParams.get('sb_flow_id');
    if (!code) {
      throw new Error('Google Sign-In did not return a session — please try again');
    }

    const exchanged = await client.auth.exchangeCodeForSession(
      code,
      flowId ? { flowId } : undefined
    );
    const token = exchanged.data?.session?.access_token
      || (await client.auth.getSession()).data?.session?.access_token
      || null;
    if (token) return token;
    if (exchanged.error) {
      const msg = String(exchanged.error.message || exchanged.error);
      if (/unable to exchange external code/i.test(msg)) {
        throw new Error(
          'Google Sign-In failed (OAuth code exchange). Google Cloud redirect URI must be '
          + 'https://YOUR_PROJECT.supabase.co/auth/v1/callback (not /supabase/…).'
        );
      }
      throw exchanged.error;
    }

    throw new Error('Google Sign-In did not return a session — please try again');
  },

  /** Finish Google OAuth on /auth/callback and create an app session. */
  async completeGoogleOAuth() {
    const accessToken = await this.recoverGoogleAccessToken();
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
    this.markSessionFresh();
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
    const pinResetSection = document.getElementById('authPinResetSection');
    const showOtpBtn = document.getElementById('showOtpLoginBtn');
    const showPinResetBtn = document.getElementById('showPinResetBtn');
    const bioBtn = document.getElementById('bioLoginBtn');

    const setLinkOpen = (btn, open, closedLabel) => {
      if (!btn) return;
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (closedLabel && !open) btn.textContent = closedLabel;
    };

    if (emailInput && profile?.email && !emailInput.value.trim()) {
      emailInput.value = profile.email;
    }

    if (otpSection) otpSection.classList.add('hidden');
    if (pinResetSection) pinResetSection.classList.add('hidden');
    setLinkOpen(showOtpBtn, false, 'Use email OTP instead');
    setLinkOpen(showPinResetBtn, false, 'Forgot PIN');

    if (showOtpBtn && otpSection) {
      showOtpBtn.onclick = () => {
        const open = otpSection.classList.contains('hidden');
        otpSection.classList.toggle('hidden', !open);
        showOtpBtn.textContent = open ? 'Hide email OTP' : 'Use email OTP instead';
        showOtpBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (open && pinResetSection) {
          pinResetSection.classList.add('hidden');
          setLinkOpen(showPinResetBtn, false, 'Forgot PIN');
        }
      };
    }

    if (showPinResetBtn && pinResetSection && !showPinResetBtn.dataset.quietBound) {
      showPinResetBtn.dataset.quietBound = '1';
      const previous = showPinResetBtn.onclick;
      showPinResetBtn.onclick = (event) => {
        if (typeof previous === 'function') previous.call(showPinResetBtn, event);
        const open = !pinResetSection.classList.contains('hidden');
        showPinResetBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (open && otpSection) {
          otpSection.classList.add('hidden');
          setLinkOpen(showOtpBtn, false, 'Use email OTP instead');
        }
      };
    }

    const authTabs = document.getElementById('authTabs');
    if (authTabs && !authTabs.dataset.ariaBound) {
      authTabs.dataset.ariaBound = '1';
      authTabs.addEventListener('click', (event) => {
        const tab = event.target.closest('.tab');
        if (!tab || !authTabs.contains(tab)) return;
        authTabs.querySelectorAll('.tab').forEach((el) => {
          el.setAttribute('aria-selected', el === tab ? 'true' : 'false');
        });
      });
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
      if (
        err.status === 401
        || err.code === 'SESSION_INVALID'
        || err.code === 'SESSION_SUPERSEDED'
      ) {
        console.warn('[Auth] Session expired — clearing stored credentials', err.code || '');
        try {
          if (err.code === 'SESSION_SUPERSEDED') {
            sessionStorage.setItem('eisy_logout_notice', 'superseded');
          }
        } catch (_) { /* ignore */ }
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
