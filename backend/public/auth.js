/* Eisy Myanmar — Auth client & session store */
const Auth = {
  STORAGE_KEY: 'eisy_auth',
  BIO_KEY: 'eisy_bio_token',

  load() {
    try {
      return JSON.parse(localStorage.getItem(this.STORAGE_KEY) || 'null');
    } catch {
      return null;
    }
  },

  save(data) {
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(data));
  },

  clear() {
    localStorage.removeItem(this.STORAGE_KEY);
  },

  get sessionToken() { return this.load()?.sessionToken || null; },
  get pinToken() { return this.load()?.pinToken || null; },
  get user() { return this.load()?.user || null; },
  get biometricToken() { return localStorage.getItem(this.BIO_KEY); },

  setSession({ sessionToken, user, pinToken }) {
    const prev = this.load() || {};
    const next = { sessionToken, user };
    if (pinToken !== undefined) {
      if (pinToken) next.pinToken = pinToken;
    } else if (sessionToken === prev.sessionToken && prev.pinToken) {
      next.pinToken = prev.pinToken;
    }
    this.save(next);
  },

  setPinToken(pinToken) {
    const prev = this.load() || {};
    this.save({ ...prev, pinToken });
  },

  setBiometricToken(token) {
    localStorage.setItem(this.BIO_KEY, token);
  },

  headers({ sensitive = false } = {}) {
    const h = { 'Content-Type': 'application/json' };
    if (this.sessionToken) h['Authorization'] = `Bearer ${this.sessionToken}`;
    if (sensitive && this.pinToken) h['X-Pin-Token'] = this.pinToken;
    if (sensitive && this.biometricToken) h['X-Biometric-Token'] = this.biometricToken;
    return h;
  },

  async api(method, path, body, opts = {}) {
    console.log(`[Auth.api] ${method} ${path}`, body || '');
    try {
      const res = await fetch(path, {
        method,
        headers: this.headers(opts),
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      let data = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch (parseErr) {
        console.error('[Auth.api] JSON parse error', parseErr, text);
        throw new Error(`Invalid server response (${res.status})`);
      }

      console.log(`[Auth.api] ${method} ${path} → ${res.status}`, data);

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
      if (!err.message?.includes('HTTP')) {
        console.error('[Auth.api] Network or unexpected error:', err);
      }
      throw err;
    }
  },

  async apiForm(path, formData, opts = {}) {
    const h = {};
    if (this.sessionToken) h['Authorization'] = `Bearer ${this.sessionToken}`;
    if (opts.sensitive && this.pinToken) h['X-Pin-Token'] = this.pinToken;
    if (opts.sensitive && this.biometricToken) h['X-Biometric-Token'] = this.biometricToken;

    const res = await fetch(path, { method: 'POST', headers: h, body: formData });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `HTTP ${res.status}`);
      err.code = data.code;
      throw err;
    }
    return data;
  },

  async sendRegisterOtp(email) {
    // Primary endpoint (+ alias supported on server)
    return this.api('POST', '/api/auth/register/send-otp', { email });
  },

  async completeRegister({ email, otp, name, phone, pin }) {
    const data = await this.api('POST', '/api/auth/register/complete', {
      email, otp, name, phone, pin, confirm_pin: pin,
    });
    const user = {
      ...data.user,
      has_pin: Boolean(data.pin_token || pin),
    };
    this.setSession({ sessionToken: data.sessionToken, user, pinToken: data.pin_token });
    return { ...data, user };
  },

  async sendLoginOtp(email) {
    return this.api('POST', '/api/auth/login/send-otp', { email });
  },

  async verifyLoginOtp(email, otp) {
    const data = await this.api('POST', '/api/auth/login/verify', { email, otp });
    const user = {
      ...data.user,
      has_pin: data.has_pin ?? Boolean(data.user?.has_pin),
    };
    this.setSession({ sessionToken: data.sessionToken, user, pinToken: null });
    return { ...data, user };
  },

  async verifyPin(pin) {
    const data = await this.api('POST', '/api/auth/pin/verify', { pin });
    this.setPinToken(data.pin_token);
    if (data.has_pin && this.user) {
      this.setSession({
        sessionToken: this.sessionToken,
        user: { ...this.user, has_pin: true },
        pinToken: data.pin_token,
      });
    }
    return data;
  },

  async resetPinToDefault() {
    const data = await this.api('POST', '/api/auth/pin/reset-default', {});
    this.setPinToken(data.pin_token);
    if (this.user) {
      this.setSession({
        sessionToken: this.sessionToken,
        user: { ...this.user, has_pin: true },
        pinToken: data.pin_token,
      });
    }
    return data;
  },

  async setPin(pin) {
    const data = await this.api('POST', '/api/auth/pin/set', { pin, confirm_pin: pin });
    this.setPinToken(data.pin_token);
    if (this.user) {
      this.setSession({
        sessionToken: this.sessionToken,
        user: { ...this.user, has_pin: true },
        pinToken: data.pin_token,
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
    const data = await this.api('POST', '/api/auth/biometrics/login', { email, device_token: token });
    this.setSession({ sessionToken: data.sessionToken, user: data.user, pinToken: data.pin_token });
    return data;
  },

  async logout() {
    try { await this.api('POST', '/api/auth/logout', {}); } catch (_) {}
    this.clear();
  },

  isLoggedIn() { return Boolean(this.sessionToken); },

  needsPinUnlock() { return this.isLoggedIn() && !this.pinToken; },

  /** Revalidate stored session on page load; clears stale tokens on 401. */
  async restoreSession() {
    if (!this.sessionToken) return false;
    try {
      const data = await this.api('GET', '/api/auth/me');
      if (data?.user) {
        this.setSession({
          sessionToken: this.sessionToken,
          user: data.user,
          pinToken: this.pinToken,
        });
        return true;
      }
    } catch (err) {
      if (err.status === 401 || err.status === 403) {
        console.warn('[Auth] Session expired — clearing stored credentials');
        this.clear();
      }
    }
    return false;
  },
};

window.Auth = Auth;
