/* Eisy Myanmar — Dashboard logic (requires auth.js) */
const CARD_CACHE_KEY = 'eisy_user_cards';

const Dashboard = {
  pollTimer: null,
  cardsPollTimer: null,
  currentCard: null,
  allCards: [],
  activeCardIndex: 0,
  cardPricing: null,
  walletMmk: null,
  walletUsdt: null,
  usdtAddresses: null,
  withdrawalFees: null,

  init() {
    console.log('[Dashboard] init');
    try {
      this.bindI18n();
      this.clearStaleDepositDrafts();
      this.bindAuthForms();
      this.bindChangePasswordForm();
      this.bindDashboardForms();
      this.initSupabase().catch((err) => console.warn('[Dashboard] Supabase init:', err.message));
      this.bindCardCopyButtons();
      this.bindCardSelector();
      this.bindCardsAutoRefresh();
      this.bindProofLightbox();
      this.bindReloadCard();
      this.bindWithdrawUsdt();
      this.bindWithdrawMmk();
      this.bindUsdtWalletPage();
      Auth.restoreSession()
        .catch((err) => console.warn('[Dashboard] session restore:', err.message))
        .finally(() => {
          Auth.initLoginPanel();
          this.refreshAuthUI();
        });
    } catch (err) {
      console.error('[Dashboard] init failed:', err);
    }
  },

  initNavigationIfNeeded() {
    if (this._navInitialized || typeof AppNav === 'undefined') return;
    const shell = $('userAppShell');
    if (!shell) return;

    AppNav.init({
      root: shell,
      navSelector: '.sidebar-nav [data-page]',
      pageSelector: '.app-page[data-page]',
      defaultPage: 'home',
      onChange: (page, opts = {}) => this.onPageChange(page, opts),
    });

    document.querySelectorAll('[data-goto]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.goto;
        if (!target || typeof AppNav === 'undefined') return;
        const opts = { pushHash: true };
        if (btn.dataset.depositTab) opts.depositTab = btn.dataset.depositTab;
        if (btn.dataset.p2pTab) opts.p2pTab = btn.dataset.p2pTab;
        AppNav.navigate(target, opts);
      });
    });

    this._navInitialized = true;
  },

  bindI18n() {
    const refresh = () => this.onLanguageChange();
    document.addEventListener('eisy:langchange', refresh);
    if (typeof I18n !== 'undefined') I18n.onChange(refresh);
  },

  onLanguageChange() {
    if (typeof I18n !== 'undefined') I18n.apply(document);
    if (typeof AppNav !== 'undefined' && AppNav.currentPage) {
      const titleEl = document.querySelector(`[data-page-title="${AppNav.currentPage}"]`);
      const heading = document.querySelector('.page-heading');
      if (titleEl && heading) {
        const key = titleEl.getAttribute('data-i18n');
        if (key) heading.textContent = t(key);
      }
    }
    this.updateCardWalletHint();
    this.updateReloadWalletHint();
    this.updateCardPricingBreakdown();
    this.updateHomeRateSummary();
    if (Auth.user) {
      this.loadAllCards({ preserveSelection: true, silent: true });
      this.loadDepositHistory();
      this.loadReloadHistory();
    }
  },

  async initSupabase() {
    if (typeof window.SupabaseBridge === 'undefined') {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    if (!window.SupabaseBridge) return;
    await window.SupabaseBridge.init();
    if (Auth.isLoggedIn() && Auth.user?.id) {
      this.bindSupabaseUserRealtime();
    }
  },

  bindSupabaseUserRealtime() {
    if (!window.SupabaseBridge?.isReady() || !Auth.user?.id) return;
    window.SupabaseBridge.unsubscribeAll();
    window.SupabaseBridge.subscribeUser(Auth.user.id, {
      onWallet: (row) => {
        const data = window.SupabaseBridge.walletToApiShape(row);
        if (data) this.renderWalletBalances(data);
      },
      onDeposits: () => {
        this.loadDepositHistory();
      },
      onReloads: () => {
        this.loadReloadHistory();
        this.loadAllCards({ preserveSelection: true, silent: true, forceRefresh: true });
      },
      onCards: () => {
        this.loadAllCards({ preserveSelection: true, silent: true, forceRefresh: true });
      },
    });
  },

  onPageChange(page, opts = {}) {
    if (page === 'deposits') {
      this.loadDepositHistory();
      this.populateReloadCardSelect();
      if (opts.depositTab) this.switchDepositTab(opts.depositTab);
    }
    if (page === 'usdt-wallet') this.loadUsdtWalletPage();
    if (page === 'rates') this.renderRatesPage();
    if (page === 'p2p') {
      if (opts.p2pTab) this.switchP2pTab(opts.p2pTab);
      this.loadP2pPage();
    }
    if (page === 'settings') {
      this.loadSupportThreads();
      this.loadKycStatusUI();
      this.updateChangePasswordUI();
    }
    if (page === 'cards') {
      this.loadAllCards({ preserveSelection: true, silent: true, forceRefresh: true });
      this.loadReloadHistory();
    }
    if (page === 'home') {
      this.updateHomeRateSummary();
      this.loadDepositHistory();
    }
  },

  bindProofLightbox() {
    $('proofLightboxClose')?.addEventListener('click', () => this.closeProofLightbox());
    $('proofLightbox')?.querySelector('.proof-lightbox-backdrop')
      ?.addEventListener('click', () => this.closeProofLightbox());
  },

  bindCardsAutoRefresh() {
    document.addEventListener('visibilitychange', () => {
      if (
        document.visibilityState === 'visible'
        && Auth.isLoggedIn()
        && !Auth.needsPinUnlock()
      ) {
        this.loadAllCards({ preserveSelection: true, silent: true });
      }
    });

    const schedulePoll = () => {
      const cards = this.allCards || [];
      const hasPending = cards.some((c) => this.isCardPending(c));
      // Empty or pending lists need faster refresh so new/approved cards appear promptly
      const intervalMs = (!cards.length || hasPending) ? 10000 : 45000;
      if (this.cardsPollTimer && this._cardsPollIntervalMs === intervalMs) return;
      if (this.cardsPollTimer) clearInterval(this.cardsPollTimer);
      this._cardsPollIntervalMs = intervalMs;
      this.cardsPollTimer = setInterval(() => {
        if (
          document.visibilityState === 'visible'
          && Auth.isLoggedIn()
          && !Auth.needsPinUnlock()
        ) {
          this.loadAllCards({ preserveSelection: true, silent: true });
        }
      }, intervalMs);
    };

    this._scheduleCardsPoll = schedulePoll;
    schedulePoll();
  },

  cardsSignature(cards) {
    return (cards || []).map((c) => [
      c.id,
      this.resolveCardStatus(c),
      c.last4 || '',
      c.card_number || '',
      c.card_holder_name || '',
      c.exp_date || '',
      c.cvv || '',
      c.balance_usd ?? '',
      c.label || '',
      c.status_reason || '',
    ].join(':')).join('|');
  },

  saveCardsCache(cards) {
    if (!Auth.user?.id || !Array.isArray(cards)) return;
    try {
      localStorage.setItem(CARD_CACHE_KEY, JSON.stringify({
        userId: Auth.user.id,
        updatedAt: Date.now(),
        cards,
      }));
    } catch (_) {}
  },

  loadCardsCache() {
    try {
      const raw = JSON.parse(localStorage.getItem(CARD_CACHE_KEY) || 'null');
      if (!raw || raw.userId !== Auth.user?.id || !Array.isArray(raw.cards)) return null;
      return raw.cards;
    } catch {
      return null;
    }
  },

  clearCardsCache() {
    try { localStorage.removeItem(CARD_CACHE_KEY); } catch (_) {}
  },

  resolveCardStatus(card) {
    if (!card) return 'unknown';
    const status = String(card.status || '').toLowerCase();
    const num = String(card.card_number || '').trim();
    if (status === 'pending' || num.startsWith('PENDING-')) return 'pending';
    if (status === 'cancelled' || status === 'expired') return 'terminated';
    if (['active', 'suspended', 'frozen', 'terminated'].includes(status)) return status;
    return status || 'unknown';
  },

  normalizeCard(card) {
    if (!card) return card;
    const status = this.resolveCardStatus(card);
    return { ...card, status };
  },

  isCardPending(card) {
    return this.resolveCardStatus(card) === 'pending';
  },

  isCardActive(card) {
    return this.resolveCardStatus(card) === 'active';
  },

  isCardSuspended(card) {
    return this.resolveCardStatus(card) === 'suspended';
  },

  isCardFrozen(card) {
    return this.resolveCardStatus(card) === 'frozen';
  },

  isCardTerminated(card) {
    return this.resolveCardStatus(card) === 'terminated';
  },

  isCardRestricted(card) {
    const s = this.resolveCardStatus(card);
    return s === 'suspended' || s === 'frozen';
  },

  cardStatusPillClass(card) {
    const s = this.resolveCardStatus(card);
    const map = {
      pending: 'pending',
      active: 'active',
      suspended: 'suspended',
      frozen: 'frozen',
      terminated: 'terminated',
    };
    return map[s] || '';
  },

  cardStatusAlertMessage(card) {
    if (this.isCardSuspended(card)) {
      return 'This card is currently suspended. Please contact support or check back later.';
    }
    if (this.isCardFrozen(card)) {
      return 'This card is frozen due to a security or compliance review. Please contact support or check back later.';
    }
    if (this.isCardTerminated(card)) {
      return 'This card has been permanently terminated and can no longer be used.';
    }
    return '';
  },

  applyCachedCardsIfAvailable() {
    const cached = this.loadCardsCache();
    if (!cached?.length) return false;
    this.allCards = cached.map((c) => this.normalizeCard(c));
    if (this.activeCardIndex >= this.allCards.length) this.activeCardIndex = 0;
    this.renderCardSelector();
    if (this.allCards.length) this.selectCard(this.activeCardIndex);
    return true;
  },

  toast(message, type = 'ok', otpCode = null) {
    const el = $('authToast');
    if (!el) return;
    if (otpCode) {
      el.className = 'auth-toast otp';
      el.innerHTML = `${message}<span class="toast-otp-code">${otpCode}</span><small>Auto-filled in OTP field</small>`;
    } else {
      el.className = `auth-toast ${type === 'error' ? 'err' : 'ok'}`;
      el.textContent = message;
    }
    el.classList.remove('hidden');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.add('hidden'), otpCode ? 20000 : 6000);
  },

  copyToast(message = 'Copied to clipboard!') {
    const el = $('copyToast');
    if (!el) return;
    el.textContent = message;
    el.classList.remove('hidden');
    clearTimeout(this._copyToastTimer);
    this._copyToastTimer = setTimeout(() => el.classList.add('hidden'), 2200);
  },

  formatMmk(amount) {
    const n = Number(amount) || 0;
    return `Ks ${Math.round(n).toLocaleString()} MMK`;
  },

  formatUsdt(amount) {
    const n = Number(amount) || 0;
    return `$ ${n.toFixed(2)} USDT`;
  },

  renderWalletBalances(data) {
    const mmk = data?.balance_mmk ?? data?.balance ?? 0;
    const usdt = data?.balance_usdt ?? 0;
    const usdtLocked = data?.balance_usdt_locked ?? 0;
    this.walletMmk = mmk;
    this.walletUsdt = usdt;
    this.walletUsdtLocked = usdtLocked;

    const mmkText = data?.mmk_formatted || this.formatMmk(mmk);
    let usdtText = data?.usdt_formatted || this.formatUsdt(usdt);
    if (usdtLocked > 0.001) {
      usdtText += ` (${data?.usdt_locked_formatted || this.formatUsdt(usdtLocked)} locked)`;
    }

    const headerBar = $('headerWalletsBar');
    if ($('headerWalletMmk')) $('headerWalletMmk').textContent = mmkText;
    if ($('headerWalletUsdt')) $('headerWalletUsdt').textContent = usdtText;
    if (headerBar) headerBar.classList.remove('hidden');

    if ($('sumBalanceMmk')) $('sumBalanceMmk').textContent = mmkText;
    if ($('sumBalanceUsdt')) $('sumBalanceUsdt').textContent = usdtText;

    if (data?.legacy_migration?.migrated) {
      this.toast(
        `Legacy USD balance converted to your MMK wallet (${data.legacy_migration.mmk_formatted})`,
        'ok'
      );
      this.log(`Legacy USD migrated → ${data.legacy_migration.mmk_formatted}`, 'ok');
    }

    this.updateCardWalletHint();
    this.updateReloadWalletHint();
  },

  setWalletHint(elId, errId, { ok, okMsg, errMsg } = {}) {
    const okEl = $(elId);
    const errEl = $(errId);
    if (okEl) {
      okEl.textContent = okMsg || '';
      okEl.classList.toggle('hidden', !ok || !okMsg);
    }
    if (errEl) {
      errEl.textContent = errMsg || '';
      errEl.classList.toggle('hidden', !errMsg);
    }
  },

  updateCardWalletHint() {
    const method = $('cardPaymentMethod')?.value;
    if (method === 'wallet_mmk') {
      const p = this.cardPricing;
      const required = p?.total_mmk;
      if (!required) return;
      const available = Number(this.walletMmk ?? 0);
      if (available >= required) {
        this.setWalletHint('cardWalletHint', 'cardWalletError', {
          ok: true,
          okMsg: t('card_wallet_ok_mmk', {
            available: this.formatMmk(available),
            required: this.formatMmk(required),
          }),
        });
      } else {
        this.setWalletHint('cardWalletHint', 'cardWalletError', {
          errMsg: t('card_wallet_err_mmk', {
            available: this.formatMmk(available),
            required: this.formatMmk(required),
          }),
        });
      }
      return;
    }
    if (method === 'wallet_usdt') {
      const p = this.cardPricing;
      const required = p?.total_usdt ?? p?.total_usd_required;
      if (!required) return;
      const available = Number(this.walletUsdt ?? 0);
      if (available >= required) {
        this.setWalletHint('cardWalletHint', 'cardWalletError', {
          ok: true,
          okMsg: t('card_wallet_ok_usdt', {
            available: this.formatUsdt(available),
            required: this.formatUsdt(required),
          }),
        });
      } else {
        this.setWalletHint('cardWalletHint', 'cardWalletError', {
          errMsg: t('card_wallet_err_usdt', {
            available: this.formatUsdt(available),
            required: this.formatUsdt(required),
          }),
        });
      }
      return;
    }
    this.setWalletHint('cardWalletHint', 'cardWalletError', {});
  },

  updateReloadWalletHint() {
    const method = $('reloadPaymentMethod')?.value;
    if (method === 'wallet_mmk') {
      const preview = this.calculateReloadPreviewClient(parseFloat($('reloadAmountMmk')?.value));
      if (!preview || preview.below_min) return;
      const required = preview.deposit_mmk;
      const available = Number(this.walletMmk ?? 0);
      if (available >= required) {
        this.setWalletHint('reloadWalletHint', 'reloadWalletError', {
          ok: true,
          okMsg: `MMK wallet sufficient — ${this.formatMmk(required)} total (top-up + $3.50 fee) will be held pending admin approval.`,
        });
      } else {
        this.setWalletHint('reloadWalletHint', 'reloadWalletError', {
          errMsg: `Insufficient MMK wallet. Need ${this.formatMmk(required)}, you have ${this.formatMmk(available)}.`,
        });
      }
      return;
    }
    if (method === 'wallet_usdt') {
      const preview = this.calculateReloadPreviewUsdtClient(parseFloat($('reloadAmountUsdt')?.value));
      if (!preview || preview.below_min) return;
      const required = preview.deposit_usdt;
      const available = Number(this.walletUsdt ?? 0);
      if (available >= required) {
        this.setWalletHint('reloadWalletHint', 'reloadWalletError', {
          ok: true,
          okMsg: `USDT wallet sufficient — ${this.formatUsdt(required)} total (top-up + $3.50 fee) will be deducted pending admin approval.`,
        });
      } else {
        this.setWalletHint('reloadWalletHint', 'reloadWalletError', {
          errMsg: `Insufficient USDT wallet. Need ${this.formatUsdt(required)}, you have ${this.formatUsdt(available)}.`,
        });
      }
      return;
    }
    this.setWalletHint('reloadWalletHint', 'reloadWalletError', {});
  },

  isWalletPaymentMethod(method) {
    return method === 'wallet_mmk' || method === 'wallet_usdt';
  },

  getWalletTypeFromMethod(method) {
    if (method === 'wallet_usdt') return 'usdt';
    if (method === 'wallet_mmk') return 'mmk';
    return null;
  },

  hideDebugOutput(id) {
    const el = $(id);
    if (!el) return;
    el.textContent = '';
    el.classList.add('hidden');
  },

  formatDepositDate(iso) {
    if (!iso) return '—';
    try {
      const normalized = iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`;
      const d = new Date(normalized);
      if (Number.isNaN(d.getTime())) return iso;
      return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    } catch {
      return iso;
    }
  },

  depositPurposeMeta(purpose) {
    if (purpose === 'card_issuance') return { text: 'New Card', cls: '' };
    if (purpose === 'card_reload') return { text: 'Card Reload', cls: 'reload' };
    if (purpose === 'usdt_topup') return { text: 'USDT Wallet Top-Up', cls: 'usdt' };
    if (purpose === 'usdt_p2p') return { text: 'P2P USDT Deposit', cls: 'usdt' };
    return { text: 'MMK Wallet Top-Up (cards only)', cls: 'wallet' };
  },

  isPendingDepositStatus(status) {
    const s = String(status || '').toUpperCase();
    return ['PENDING', 'SUBMITTED', 'UNDER_REVIEW'].includes(s);
  },

  resetUsdtDepositForm() {
    $('usdtDepositForm')?.reset();
    $('usdtDepositSubmitForm')?.reset();
    $('usdtAddressBox')?.classList.add('hidden');
    $('usdtDepositSubmitForm')?.classList.add('hidden');
    if ($('usdtActiveDepositId')) $('usdtActiveDepositId').value = '';
    if ($('usdtQrCode')) {
      $('usdtQrCode').classList.add('hidden');
      $('usdtQrCode').removeAttribute('src');
    }
    this._usdtDepositAddress = '';
  },

  switchDepositTab(tab) {
    const t = tab === 'usdt' ? 'usdt' : 'mmk';
    document.querySelectorAll('.deposit-tab').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.depositTab === t);
    });
    $('depositMmkPanel')?.classList.toggle('hidden', t !== 'mmk');
    $('depositUsdtPanel')?.classList.toggle('hidden', t !== 'usdt');
  },

  bindDepositTabs() {
    document.querySelectorAll('.deposit-tab').forEach((btn) => {
      btn.addEventListener('click', () => this.switchDepositTab(btn.dataset.depositTab));
    });
    document.querySelectorAll('[data-deposit-tab]').forEach((btn) => {
      if (btn.classList.contains('deposit-tab')) return;
      btn.addEventListener('click', () => {
        const tab = btn.dataset.depositTab;
        if (typeof AppNav !== 'undefined') AppNav.navigate('deposits', { pushHash: true, depositTab: tab });
        else this.switchDepositTab(tab);
      });
    });
  },

  async loadUsdtAddresses() {
    if (!Auth.isLoggedIn()) return;
    try {
      const data = await Auth.api('GET', '/api/deposit/usdt-addresses');
      this.usdtAddresses = data;
    } catch (err) {
      console.warn('[usdt addresses]', err.message);
    }
  },

  bindUsdtWalletPage() {
    $('btnRefreshUsdtWallet')?.addEventListener('click', () => this.loadUsdtWalletPage(true));
    $('btnLoadUsdtWalletTx')?.addEventListener('click', () => this.loadUsdtWalletTransactions());
    $('usdtTransferForm')?.addEventListener('submit', (e) => this.submitUsdtTransfer(e));
    $('btnOpenWithdrawUsdtPage')?.addEventListener('click', () => {
      if (!Auth.isLoggedIn()) {
        this.toast('Sign in to withdraw USDT', 'error');
        return;
      }
      this.openWithdrawModal();
    });

    $('usdtLinkWalletForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const network = $('usdtLinkNetwork')?.value;
      const address = $('usdtLinkAddress')?.value?.trim();
      const label = $('usdtLinkLabel')?.value?.trim();
      if (!address) return;

      try {
        await Auth.api('POST', '/api/user/usdt-wallet/link', { network, address, label });
        $('usdtLinkWalletForm')?.reset();
        this.toast('Wallet linked successfully', 'ok');
        await this.loadUsdtWalletPage(true);
      } catch (err) {
        this.toast(err.message || 'Failed to link wallet', 'error');
      }
    });

    $('usdtWalletDepositAddresses')?.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-copy-usdt-address]');
      if (!btn) return;
      const addr = btn.dataset.copyUsdtAddress || '';
      if (!addr) return;
      await this.copyToClipboard(addr);
      this.toast('Address copied', 'ok');
    });

    $('usdtWalletDepositAddresses')?.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-copy-deposit-ref]');
      if (!btn) return;
      const ref = btn.dataset.copyDepositRef || '';
      if (!ref) return;
      await this.copyToClipboard(ref);
      this.toast('Deposit reference copied', 'ok');
    });

    $('usdtLinkedWalletsList')?.addEventListener('click', async (e) => {
      const copyBtn = e.target.closest('[data-copy-linked-address]');
      if (copyBtn) {
        const addr = copyBtn.dataset.copyLinkedAddress || '';
        if (addr) {
          await this.copyToClipboard(addr);
          this.toast('Address copied', 'ok');
        }
        return;
      }

      const unlinkBtn = e.target.closest('[data-unlink-wallet]');
      if (unlinkBtn) {
        const id = unlinkBtn.dataset.unlinkWallet;
        if (!id) return;
        if (!window.confirm('Remove this linked wallet from your account?')) return;
        try {
          await Auth.api('DELETE', `/api/user/usdt-wallet/link/${id}`);
          this.toast('Wallet unlinked', 'ok');
          await this.loadUsdtWalletPage(true);
        } catch (err) {
          this.toast(err.message || 'Failed to unlink wallet', 'error');
        }
        return;
      }

      const balanceBtn = e.target.closest('[data-check-onchain-balance]');
      if (balanceBtn) {
        const id = balanceBtn.dataset.checkOnchainBalance;
        const slot = $('usdtLinkedBalance-' + id);
        if (!id || !slot) return;
        slot.textContent = 'Checking…';
        try {
          const data = await Auth.api('GET', `/api/user/usdt-wallet/linked/${id}/balance`);
          if (data.ok) {
            slot.textContent = `$${Number(data.balance_usdt || 0).toFixed(2)} USDT on-chain`;
          } else {
            slot.textContent = data.error || 'Balance unavailable';
          }
        } catch (err) {
          slot.textContent = err.message || 'Balance check failed';
        }
      }
    });
  },

  async loadUsdtWalletPage(forceRefresh = false) {
    if (!Auth.isLoggedIn()) return;
    const balanceEl = $('usdtWalletPageBalance');
    const depositEl = $('usdtWalletDepositAddresses');
    const linkedEl = $('usdtLinkedWalletsList');
    if (!depositEl) return;

    if (!forceRefresh && this._usdtWalletCache) {
      this.renderUsdtWalletPage(this._usdtWalletCache);
      return;
    }

    try {
      const data = await Auth.api('GET', '/api/user/usdt-wallet', null, { sensitive: true });
      this._usdtWalletCache = data;
      this.walletUsdt = data.balance_usdt;
      this.renderUsdtWalletPage(data);
      await this.loadUsdtWalletTransactions();
    } catch (err) {
      if (err.code === 'SENSITIVE_AUTH_REQUIRED') {
        if (balanceEl) balanceEl.textContent = '🔒 Locked';
        depositEl.innerHTML = '<p class="hint">Unlock with PIN to view your USDT wallet.</p>';
        if (linkedEl) linkedEl.innerHTML = '<p class="hint">PIN required.</p>';
        $('pinUnlockModal')?.classList.remove('hidden');
        return;
      }
      depositEl.innerHTML = `<p class="hint">${err.message || 'Failed to load USDT wallet'}</p>`;
    }
  },

  async submitUsdtTransfer(e) {
    e.preventDefault();
    const email = $('usdtTransferEmail')?.value?.trim();
    const amount = parseFloat($('usdtTransferAmount')?.value);
    const note = $('usdtTransferNote')?.value?.trim();
    const statusEl = $('usdtTransferStatus');
    const btn = $('btnSubmitUsdtTransfer');

    if (!email || !Number.isFinite(amount) || amount <= 0) {
      this.toast('Enter a valid recipient email and amount', 'error');
      return;
    }

    const prevLabel = btn?.textContent;
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Sending…';
    }
    if (statusEl) statusEl.textContent = '';

    try {
      const idempotencyKey = `xfer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const data = await Auth.api('POST', '/api/user/usdt-wallet/transfer', {
        to_email: email,
        amount_usdt: amount,
        note: note || undefined,
        idempotency_key: idempotencyKey,
      }, { sensitive: true });

      const msg = data.duplicate
        ? 'Transfer already processed'
        : `Sent ${this.formatUsdt(amount)} to ${email}`;
      this.toast(msg, 'ok');
      if (statusEl) statusEl.textContent = msg;
      $('usdtTransferForm')?.reset();
      this._usdtWalletCache = null;
      await this.loadUsdtWalletPage(true);
      this.loadWallet();
    } catch (err) {
      if (err.code === 'SENSITIVE_AUTH_REQUIRED') $('pinUnlockModal')?.classList.remove('hidden');
      this.toast(err.message || 'Transfer failed', 'error');
      if (statusEl) statusEl.textContent = err.message || 'Transfer failed';
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = prevLabel || 'Send USDT';
      }
    }
  },

  renderUsdtEscrowHolds(holds) {
    const el = $('usdtEscrowHoldsList');
    const panel = $('usdtEscrowPanel');
    if (!el) return;

    const rows = holds || [];
    if (panel) panel.classList.toggle('hidden', !rows.length);

    if (!rows.length) {
      el.innerHTML = '<p class="hint">No active escrow — your full USDT balance is available.</p>';
      return;
    }

    el.innerHTML = rows.map((h) => `
      <div class="usdt-escrow-card">
        <div>
          <strong>${h.label || h.hold_type}</strong>
          <p class="hint" style="margin:0.25rem 0 0">${h.reference_type} #${h.reference_id}</p>
        </div>
        <div style="text-align:right">
          <div><strong>${Number(h.remaining_usdt).toFixed(2)} USDT</strong> locked</div>
          <small class="hint">of ${Number(h.amount_usdt).toFixed(2)} USDT</small>
        </div>
      </div>
    `).join('');
  },

  renderUsdtWalletPage(data) {
    if ($('usdtWalletAvailableBalance')) {
      $('usdtWalletAvailableBalance').textContent = data.balance_formatted || this.formatUsdt(data.balance_usdt);
    }
    if ($('usdtWalletLockedBalance')) {
      $('usdtWalletLockedBalance').textContent = data.locked_formatted || this.formatUsdt(data.balance_usdt_locked || 0);
    }
    if ($('usdtWalletTotalBalance')) {
      $('usdtWalletTotalBalance').textContent = data.total_formatted || this.formatUsdt(data.balance_usdt_total || data.balance_usdt);
    }
    if ($('sumBalanceUsdt')) {
      const locked = Number(data.balance_usdt_locked || 0);
      const available = data.balance_formatted || this.formatUsdt(data.balance_usdt);
      $('sumBalanceUsdt').textContent = locked > 0
        ? `${available} (${data.locked_formatted || this.formatUsdt(locked)} locked)`
        : available;
    }

    this.renderUsdtEscrowHolds(data.escrow_holds);
    if ($('usdtWalletMinDepositHint') && data.minimum_usdt_deposit) {
      $('usdtWalletMinDepositHint').textContent = `Minimum deposit: $${Number(data.minimum_usdt_deposit).toFixed(2)} USDT · TRC20 / BEP20 / ERC20`;
    }

    const depositEl = $('usdtWalletDepositAddresses');
    const addresses = data.deposit_addresses || [];
    if (depositEl) {
      if (!addresses.length) {
        depositEl.innerHTML = '<p class="hint">Deposit addresses are not configured yet. Contact support.</p>';
      } else {
        depositEl.innerHTML = addresses.map((row) => `
          <div class="usdt-wallet-address-card">
            <div class="usdt-wallet-address-head">
              <strong>${row.network_label || row.network}</strong>
              <span class="badge-secure">Platform deposit</span>
            </div>
            <code class="usdt-address-code">${row.address}</code>
            ${row.deposit_reference ? `
              <div class="usdt-deposit-ref">
                <span class="usdt-address-label">Your deposit reference</span>
                <code>${row.deposit_reference}</code>
                <button type="button" class="btn btn-secondary btn-sm" data-copy-deposit-ref="${this.escapeAttr(row.deposit_reference)}">Copy Ref</button>
              </div>` : ''}
            <button type="button" class="btn btn-primary btn-sm usdt-copy-btn" data-copy-usdt-address="${this.escapeAttr(row.address)}">Copy Address</button>
          </div>
        `).join('');
      }
    }

    const linkedEl = $('usdtLinkedWalletsList');
    const linked = data.linked_addresses || [];
    if (linkedEl) {
      linkedEl.innerHTML = linked.length ? linked.map((row) => `
        <div class="usdt-linked-card">
          <div class="usdt-wallet-address-head">
            <strong>${row.label || row.network_label || row.network}</strong>
            <span class="hint">${row.network}</span>
          </div>
          <code class="usdt-address-code">${row.address}</code>
          <div class="usdt-linked-actions">
            <button type="button" class="btn btn-secondary btn-sm" data-copy-linked-address="${this.escapeAttr(row.address)}">Copy</button>
            <button type="button" class="btn btn-secondary btn-sm" data-check-onchain-balance="${row.id}">Check On-Chain</button>
            <button type="button" class="btn btn-secondary btn-sm" data-unlink-wallet="${row.id}">Remove</button>
          </div>
          <p class="hint" id="usdtLinkedBalance-${row.id}" style="margin:0.5rem 0 0"></p>
        </div>
      `).join('') : '<p class="hint">No linked wallets yet.</p>';
    }
  },

  escapeAttr(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;');
  },

  async loadUsdtWalletTransactions() {
    if (!Auth.isLoggedIn()) return;
    const el = $('usdtWalletTxHistory');
    if (!el) return;

    try {
      const { transactions } = await Auth.api('GET', '/api/user/usdt-wallet/transactions', null, { sensitive: true });
      el.innerHTML = transactions?.length ? `
        <table class="data-table">
          <thead><tr><th>Time</th><th>Type</th><th>Network</th><th>Amount</th><th>Balance</th><th>Details</th></tr></thead>
          <tbody>${transactions.map((t) => `
            <tr>
              <td><small>${t.created_at || ''}</small></td>
              <td><code>${t.tx_type || ''}</code></td>
              <td>${t.network || '—'}</td>
              <td>${t.direction === 'credit' ? '+' : t.direction === 'debit' ? '−' : ''}${Number(t.amount_usdt || 0).toFixed(2)} USDT</td>
              <td>${t.balance_after != null ? Number(t.balance_after).toFixed(2) : '—'}</td>
              <td><small>${t.description || ''}${t.tx_hash ? `<br><code>${t.tx_hash}</code>` : ''}</small></td>
            </tr>
          `).join('')}</tbody>
        </table>` : '<p class="hint">No USDT transactions yet.</p>';
    } catch (err) {
      if (err.code !== 'SENSITIVE_AUTH_REQUIRED') {
        el.innerHTML = `<p class="hint">${err.message || 'Failed to load transactions'}</p>`;
      }
    }
  },

  showUsdtDepositAddress(network, address) {
    if ($('usdtNetworkLabel')) $('usdtNetworkLabel').textContent = network;
    $('usdtMerchantName')?.classList.add('hidden');
    if ($('usdtDepositAddress')) {
      $('usdtDepositAddress').textContent = address || '—';
      $('usdtDepositAddress').title = address || '';
    }
    this._usdtDepositAddress = address || '';
    const qr = $('usdtQrCode');
    if (qr && address) {
      // Local API QR — works on Vercel without third-party image hosts
      qr.src = `/api/qr?size=180&data=${encodeURIComponent(address)}`;
      qr.alt = `${network} deposit QR for ${address}`;
      qr.classList.remove('hidden');
      qr.onerror = () => {
        qr.src = `/assets/qr/placeholder-deposit.png`;
      };
    }
    $('usdtAddressBox')?.classList.remove('hidden');
  },

  async loadDepositPaymentMethods() {
    const select = $('paymentMethod');
    if (!select) return;
    try {
      const data = await Auth.api('GET', '/api/deposit/payment-methods');
      this._depositPaymentMethods = Array.isArray(data.payment_methods) ? data.payment_methods : [];
      this._usdtMasterDeposit = data.usdt || null;

      if (!this._depositPaymentMethods.length) {
        select.innerHTML = '<option value="">No bank accounts configured — contact support</option>';
        this.renderMmkPaymentDetails(null);
      } else {
        select.innerHTML = this._depositPaymentMethods.map((m) =>
          `<option value="${m.id}">${this.esc(m.bank_name)} — ${this.esc(m.account_name)}</option>`
        ).join('');
        this.renderMmkPaymentDetails(this._depositPaymentMethods[0]);
      }

      // Prefill TRC20 master wallet address for USDT deposits
      if (this._usdtMasterDeposit?.address && ($('usdtNetwork')?.value || 'TRC20') === 'TRC20') {
        this.showUsdtDepositAddress('TRC20', this._usdtMasterDeposit.address);
        if ($('usdtMerchantName')) {
          $('usdtMerchantName').textContent = this._usdtMasterDeposit.label || 'Master wallet (TRC20)';
          $('usdtMerchantName').classList.remove('hidden');
        }
      }
    } catch (err) {
      if (err.code === 'SENSITIVE_AUTH_REQUIRED' || err.status === 401) {
        select.innerHTML = '<option value="">Sign in to load payment methods</option>';
        return;
      }
      select.innerHTML = '<option value="">Failed to load payment methods</option>';
      console.warn('[deposit] payment-methods', err.message);
    }
  },

  renderMmkPaymentDetails(method) {
    const box = $('mmkPaymentMethodDetails');
    if (!box) return;
    if (!method) {
      box.classList.add('hidden');
      return;
    }
    box.classList.remove('hidden');
    if ($('mmkPayBankName')) $('mmkPayBankName').textContent = method.bank_name || '—';
    if ($('mmkPayAccountName')) $('mmkPayAccountName').textContent = method.account_name || '—';
    if ($('mmkPayAccountNumber')) $('mmkPayAccountNumber').textContent = method.account_number || '—';
    const qr = $('mmkPayQrImg');
    if (qr) {
      const qrUrl = method.qr_code_image_url
        || method.qr_code_url
        || (method.account_number
          ? `/api/qr?size=180&data=${encodeURIComponent(method.account_number)}`
          : '');
      if (qrUrl) {
        qr.src = qrUrl;
        qr.classList.remove('hidden');
        qr.onerror = () => {
          if (method.account_number) {
            qr.src = `/api/qr?size=180&data=${encodeURIComponent(method.account_number)}`;
          } else {
            qr.classList.add('hidden');
          }
        };
      } else {
        qr.classList.add('hidden');
        qr.removeAttribute('src');
      }
    }
  },

  esc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },

  bindP2pMarket() {
    this._p2pTab = 'buy';

    document.querySelectorAll('.p2p-tab[data-p2p-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.switchP2pTab(btn.dataset.p2pTab);
        this.loadP2pMarket();
      });
    });

    // Wallet dashboard "Sell USDT / Convert to MMK" shortcuts → P2P Sell tab
    const openSell = (e) => {
      e.preventDefault();
      this.openSellConvertUsdt();
    };
    $('btnSellConvertUsdt')?.addEventListener('click', openSell);
    $('btnSellConvertUsdtPage')?.addEventListener('click', openSell);
    $('btnSellConvertUsdtQuick')?.addEventListener('click', openSell);

    $('p2pNetworkFilter')?.addEventListener('change', () => this.loadP2pMarket());
    $('btnRefreshP2pMarket')?.addEventListener('click', () => this.loadP2pPage());
    $('btnRefreshMyP2pAds')?.addEventListener('click', () => this.loadMyP2pAds());
    $('btnPostP2pAd')?.addEventListener('click', () => this.openPostP2pAdModal());
    $('p2pMyAdsList')?.addEventListener('click', (e) => {
      const cancelBtn = e.target.closest('[data-cancel-p2p-ad]');
      if (cancelBtn) this.cancelP2pAd(parseInt(cancelBtn.dataset.id, 10));
    });
    $('btnRefreshP2pActiveOrders')?.addEventListener('click', () => this.loadP2pActiveOrders());
    $('p2pActiveOrdersList')?.addEventListener('click', (e) => {
      const viewReceipt = e.target.closest('[data-p2p-view-receipt]');
      const sellerDispute = e.target.closest('[data-p2p-seller-dispute]');
      const sellerRelease = e.target.closest('[data-p2p-seller-release]');
      const reopen = e.target.closest('[data-p2p-reopen-order]');

      if (viewReceipt) {
        e.preventDefault();
        const orderId = parseInt(viewReceipt.dataset.orderId, 10);
        const order = (this._p2pActiveOrders || []).find((o) => o.id === orderId && o.order_type === 'buy');
        if (order) this.viewP2pOrderPaymentProof(order);
        else this.toast('Payment proof not available', 'error');
        return;
      }

      if (sellerDispute) {
        e.preventDefault();
        const orderType = sellerDispute.dataset.orderType || 'buy';
        const orderId = parseInt(sellerDispute.dataset.orderId, 10);
        const order = (this._p2pActiveOrders || []).find((o) => o.id === orderId && o.order_type === orderType);
        if (order) this.openP2pSellerDisputeModal(order);
        return;
      }

      if (sellerRelease) {
        e.preventDefault();
        const orderId = parseInt(sellerRelease.dataset.orderId, 10);
        const order = (this._p2pActiveOrders || []).find((o) => o.id === orderId && o.order_type === 'buy');
        if (order) {
          this._p2pBuyOrder = order;
          this.promptP2pBuyReleaseConfirm(order.id);
        }
        return;
      }

      if (!reopen) return;
      const orderType = reopen.dataset.orderType;
      const orderId = parseInt(reopen.dataset.orderId, 10);
      this.resumeP2pOrder(orderType, orderId);
    });
    $('p2pMarketList')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-p2p-trade]');
      if (!btn) return;
      const id = parseInt(btn.dataset.id, 10);
      const side = btn.dataset.p2pTrade;
      const listing = (this._p2pListings || []).find((l) => l.id === id);
      if (listing) this.startP2pTrade(listing, side);
    });
  },

  switchP2pTab(tab) {
    this._p2pTab = tab === 'sell' ? 'sell' : 'buy';
    document.querySelectorAll('.p2p-tab[data-p2p-tab]').forEach((b) => {
      const active = b.dataset.p2pTab === this._p2pTab;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-selected', active ? 'true' : 'false');
    });
  },

  openSellConvertUsdt() {
    if (!Auth.isLoggedIn()) {
      this.toast('Sign in to sell USDT / convert to MMK', 'error');
      return;
    }
    if (typeof AppNav !== 'undefined') {
      AppNav.navigate('p2p', { pushHash: true, p2pTab: 'sell' });
    } else {
      this.switchP2pTab('sell');
      this.loadP2pPage();
    }
  },

  startP2pTrade(listing, side) {
    if (!Auth.isLoggedIn()) {
      this.toast('Please log in to trade', 'error');
      return;
    }
    if (!this.isKycVerified()) {
      this.showKycGateModal();
      return;
    }
    if (side === 'buy') {
      this.openP2pBuyModal(listing);
      return;
    }
    this.openP2pSellModal(listing);
  },

  isKycVerified() {
    return this._kycStatus?.is_verified === true
      || (Auth.user?.kyc_status || '').toUpperCase() === 'VERIFIED'
      || Auth.user?.is_kyc_verified === true;
  },

  async loadKycStatus() {
    if (!Auth.isLoggedIn()) {
      this._kycStatus = null;
      return null;
    }
    try {
      const data = await Auth.api('GET', '/api/kyc/status');
      this._kycStatus = data;
      if (Auth.user) {
        Auth.user.kyc_status = data.kyc_status;
        Auth.user.is_kyc_verified = data.is_verified;
      }
      this.updateKycSettingsUI();
      return data;
    } catch (_) {
      return null;
    }
  },

  updateKycSettingsUI() {
    const el = $('settingsKycStatus');
    const btn = $('btnOpenKycModal');
    if (!el) return;
    const status = (this._kycStatus?.kyc_status || Auth.user?.kyc_status || 'UNVERIFIED').toUpperCase();
    const labels = {
      UNVERIFIED: 'Not verified',
      PENDING_REVIEW: 'Pending admin review',
      VERIFIED: 'Verified ✓',
      REJECTED: 'Rejected — please resubmit',
    };
    el.textContent = `Identity status: ${labels[status] || status}`;
    if (btn) {
      btn.textContent = status === 'VERIFIED' ? 'View KYC Status' : (status === 'PENDING_REVIEW' ? 'KYC Under Review' : 'Complete KYC');
      btn.disabled = status === 'PENDING_REVIEW';
      btn.classList.toggle('btn-primary', status !== 'VERIFIED');
      btn.classList.toggle('btn-secondary', status === 'VERIFIED');
    }
    const intro = $('kycModalIntro');
    if (intro) {
      if (status === 'VERIFIED') intro.textContent = 'Your identity is verified. You can trade on the P2P marketplace.';
      else if (status === 'PENDING_REVIEW') intro.textContent = 'Your submission is under review. You will be notified once approved.';
      else if (status === 'REJECTED') {
        const reason = this._kycStatus?.latest_submission?.rejection_reason;
        intro.textContent = reason ? `Previous submission rejected: ${reason}. Please resubmit.` : 'Please resubmit your documents.';
      } else intro.textContent = 'Submit your identity documents to unlock P2P trading.';
    }
  },

  async loadKycStatusUI() {
    await this.loadKycStatus();
  },

  showKycGateModal(message) {
    if ($('kycGateMessage')) {
      $('kycGateMessage').textContent = message || 'KYC Verification Required to Trade P2P';
    }
    $('kycGateModal')?.classList.remove('hidden');
    document.body.classList.add('sidebar-scroll-lock');
  },

  closeKycGateModal() {
    $('kycGateModal')?.classList.add('hidden');
    document.body.classList.remove('sidebar-scroll-lock');
  },

  openKycModal() {
    this.closeKycGateModal();
    if ($('kycFormError')) $('kycFormError').textContent = '';
    this._kycCompressedFiles = {};
    this.setKycPhotoStatus('front', '', null);
    this.setKycPhotoStatus('back', '', null);
    this.setKycPhotoStatus('selfie', '', null);
    this.setKycCompressBanner('', false);
    this.setKycSubmitBusy(false);
    const status = (this._kycStatus?.kyc_status || '').toUpperCase();
    const form = $('kycForm');
    if (form) form.classList.toggle('hidden', status === 'PENDING_REVIEW' || status === 'VERIFIED');
    $('kycModal')?.classList.remove('hidden');
    document.body.classList.add('sidebar-scroll-lock');
  },

  closeKycModal() {
    $('kycModal')?.classList.add('hidden');
    document.body.classList.remove('sidebar-scroll-lock');
  },

  _kycCompressedFiles: {},

  formatFileSize(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(2) + ' MB';
  },

  setKycPhotoStatus(kind, message, state) {
    const map = {
      front: 'kycFrontPhotoStatus',
      back: 'kycBackPhotoStatus',
      selfie: 'kycSelfiePhotoStatus',
    };
    const el = $(map[kind]);
    if (!el) return;
    el.textContent = message || '';
    el.classList.remove('is-compressing', 'is-ok', 'is-error');
    if (state) el.classList.add(state);
  },

  setKycCompressBanner(message, visible) {
    const el = $('kycCompressStatus');
    if (!el) return;
    el.textContent = message || '';
    el.classList.toggle('hidden', !visible);
  },

  setKycSubmitBusy(busy) {
    const btn = $('kycSubmitBtn');
    if (!btn) return;
    btn.disabled = Boolean(busy);
    btn.textContent = busy ? 'Compressing photos…' : 'Submit for Review';
  },

  async compressKycImage(file, { onProgress } = {}) {
    if (!file || !/^image\//.test(file.type)) {
      throw new Error('Please select an image file');
    }
    // Already small enough — skip work
    if (file.size <= 900 * 1024 && file.size > 0) {
      return file;
    }
    const compressFn = typeof imageCompression === 'function'
      ? imageCompression
      : (typeof window !== 'undefined' && typeof window.imageCompression === 'function'
        ? window.imageCompression
        : null);
    if (!compressFn) {
      console.warn('[kyc] browser-image-compression not loaded — uploading original');
      return file;
    }

    const options = {
      maxSizeMB: 1,
      maxWidthOrHeight: 1920,
      useWebWorker: true,
      // Prefer local vendor copy so workers don't hit CDN
      libURL: '/vendor/browser-image-compression.js?v=20260812a',
      initialQuality: 0.8,
      fileType: 'image/jpeg',
      onProgress: typeof onProgress === 'function'
        ? (p) => onProgress(Math.round(Number(p) || 0))
        : undefined,
    };

    let compressed = await compressFn(file, options);
    // Ensure File has a stable name for multer / UX
    if (!(compressed instanceof File)) {
      compressed = new File([compressed], file.name.replace(/\.\w+$/, '') + '.jpg', {
        type: compressed.type || 'image/jpeg',
        lastModified: Date.now(),
      });
    } else if (!/\.jpe?g$/i.test(compressed.name)) {
      compressed = new File([compressed], file.name.replace(/\.\w+$/, '') + '.jpg', {
        type: 'image/jpeg',
        lastModified: compressed.lastModified || Date.now(),
      });
    }
    return compressed;
  },

  async prepareKycPhoto(kind, file) {
    if (!file) {
      delete this._kycCompressedFiles[kind];
      this.setKycPhotoStatus(kind, '', null);
      return null;
    }
    this.setKycPhotoStatus(
      kind,
      'Compressing… 0% · original ' + this.formatFileSize(file.size),
      'is-compressing'
    );
    try {
      const compressed = await this.compressKycImage(file, {
        onProgress: (pct) => {
          this.setKycPhotoStatus(
            kind,
            'Compressing… ' + pct + '% · original ' + this.formatFileSize(file.size),
            'is-compressing'
          );
        },
      });
      this._kycCompressedFiles[kind] = compressed;
      const same = compressed === file || compressed.size >= file.size * 0.98;
      this.setKycPhotoStatus(
        kind,
        same
          ? 'Ready · ' + this.formatFileSize(compressed.size)
          : 'Compressed ' + this.formatFileSize(file.size) + ' → ' + this.formatFileSize(compressed.size),
        'is-ok'
      );
      return compressed;
    } catch (err) {
      delete this._kycCompressedFiles[kind];
      this.setKycPhotoStatus(kind, err.message || 'Compression failed', 'is-error');
      throw err;
    }
  },

  bindKycModal() {
    $('kycModalClose')?.addEventListener('click', () => this.closeKycModal());
    $('kycModal')?.addEventListener('click', (e) => {
      if (e.target.id === 'kycModal') this.closeKycModal();
    });
    $('btnOpenKycModal')?.addEventListener('click', () => this.openKycModal());
    $('kycGateCompleteBtn')?.addEventListener('click', () => this.openKycModal());
    $('kycGateCloseBtn')?.addEventListener('click', () => this.closeKycGateModal());
    $('kycGateModal')?.addEventListener('click', (e) => {
      if (e.target.id === 'kycGateModal') this.closeKycGateModal();
    });
    $('kycForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.submitKycForm();
    });

    const photoInputs = [
      ['kycFrontPhoto', 'front'],
      ['kycBackPhoto', 'back'],
      ['kycSelfiePhoto', 'selfie'],
    ];
    photoInputs.forEach(([id, kind]) => {
      $(id)?.addEventListener('change', async (e) => {
        const file = e.target.files?.[0] || null;
        if ($('kycFormError')) $('kycFormError').textContent = '';
        try {
          await this.prepareKycPhoto(kind, file);
        } catch (_) {
          // Status already set; keep original selection for retry on submit
        }
      });
    });
  },

  async submitKycForm() {
    if ($('kycFormError')) $('kycFormError').textContent = '';
    const frontInput = $('kycFrontPhoto');
    const backInput = $('kycBackPhoto');
    const selfieInput = $('kycSelfiePhoto');
    const frontRaw = frontInput?.files?.[0];
    const backRaw = backInput?.files?.[0];
    const selfieRaw = selfieInput?.files?.[0];

    if (!frontRaw || !backRaw || !selfieRaw) {
      if ($('kycFormError')) $('kycFormError').textContent = 'Please attach front, back, and selfie photos.';
      return;
    }

    this.setKycSubmitBusy(true);
    this.setKycCompressBanner('Compressing photos before upload…', true);

    try {
      const front = this._kycCompressedFiles.front
        || await this.prepareKycPhoto('front', frontRaw);
      const back = this._kycCompressedFiles.back
        || await this.prepareKycPhoto('back', backRaw);
      const selfie = this._kycCompressedFiles.selfie
        || await this.prepareKycPhoto('selfie', selfieRaw);

      this.setKycCompressBanner('Uploading compressed photos…', true);

      const formData = new FormData();
      formData.append('full_name', $('kycFullName')?.value?.trim() || '');
      formData.append('id_type', $('kycIdType')?.value || 'NRC');
      formData.append('id_number', $('kycIdNumber')?.value?.trim() || '');
      formData.append('front_photo', front, front.name || 'front.jpg');
      formData.append('back_photo', back, back.name || 'back.jpg');
      formData.append('selfie_photo', selfie, selfie.name || 'selfie.jpg');

      const data = await Auth.apiForm('/api/kyc/submit', formData, { sensitive: true });
      this.toast(data.message || 'KYC submitted', 'ok');
      this._kycCompressedFiles = {};
      this.closeKycModal();
      await this.loadKycStatus();
    } catch (err) {
      if ($('kycFormError')) $('kycFormError').textContent = err.message || 'Failed to submit KYC';
      if (err.code === 'KYC_REQUIRED') this.showKycGateModal(err.message);
    } finally {
      this.setKycCompressBanner('', false);
      this.setKycSubmitBusy(false);
    }
  },

  handleP2pKycError(err) {
    if (err.code === 'KYC_REQUIRED' || err.status === 403) {
      this.showKycGateModal(err.message || 'KYC Verification Required to Trade P2P');
      return true;
    }
    return false;
  },

  bindP2pSellModal() {
    this._p2pSellListing = null;
    this._p2pSellOrder = null;

    $('p2pSellModalClose')?.addEventListener('click', () => this.closeP2pSellModal());
    $('p2pSellDoneCloseBtn')?.addEventListener('click', () => this.closeP2pSellModal());
    $('p2pSellModal')?.addEventListener('click', (e) => {
      if (e.target.id === 'p2pSellModal') this.closeP2pSellModal();
    });

    $('p2pSellAmountUsdt')?.addEventListener('input', () => this.updateP2pSellPreviews());
    $('p2pSellPaymentMethod')?.addEventListener('change', () => this.updateP2pSellBankField());
    $('p2pSellContinueBtn')?.addEventListener('click', () => this.submitP2pSellOrder());
    $('p2pSellConfirmMmkBtn')?.addEventListener('click', () => this.confirmP2pSellMmkAndRelease());
    $('p2pSellCancelBtn')?.addEventListener('click', () => this.cancelP2pSellOrder());
    $('p2pSellCopyRefBtn')?.addEventListener('click', () => {
      const ref = $('p2pSellRefCode')?.textContent || '';
      if (ref) {
        navigator.clipboard.writeText(ref);
        this.toast('Reference copied', 'ok');
      }
    });

    $('p2pSellOpenDisputeBtn')?.addEventListener('click', () => {
      $('p2pSellDisputeForm')?.classList.toggle('hidden');
    });
    $('p2pSellChatAttachBtn')?.addEventListener('click', () => $('p2pSellChatAttachment')?.click());
    $('p2pSellChatAttachment')?.addEventListener('change', () => this.updateP2pChatAttachHint('sell'));
    $('p2pSellChatForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.sendP2pChatMessage('sell');
    });
    $('p2pSellDisputeForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.submitP2pDispute('sell');
    });
  },

  openP2pSellModal(listing) {
    this._p2pSellListing = listing;
    this._p2pSellOrder = null;
    const modal = $('p2pSellModal');
    if (!modal) return;

    $('p2pSellStepAmount')?.classList.remove('hidden');
    $('p2pSellStepWaiting')?.classList.add('hidden');
    $('p2pSellStepDone')?.classList.add('hidden');
    $('p2pSellConfirmMmkBtn')?.classList.remove('hidden');
    $('p2pSellCancelBtn')?.classList.remove('hidden');

    const rate = Number(listing.price_mmk_per_usdt) || 0;
    $('p2pSellModalTitle').textContent = `Sell USDT — ${listing.name}`;
    $('p2pSellMerchantSummary').textContent =
      `${listing.name} · ${listing.network} · ${listing.price_mmk_formatted || (rate + ' MMK')} per USDT`;
    $('p2pSellRateBanner').textContent = `Rate: ${Math.round(rate).toLocaleString()} MMK / USDT`;
    $('p2pSellUsdtLimits').textContent = `Limits: ${listing.limits_formatted || `$${listing.min_deposit} – $${listing.max_deposit} USDT`}`;

    const methodSelect = $('p2pSellPaymentMethod');
    if (methodSelect) {
      const methods = listing.payment_methods || ['KPay', 'WavePay', 'KBZ Bank'];
      methodSelect.innerHTML = methods.map((m) => `<option value="${m}">${m}</option>`).join('');
    }

    if ($('p2pSellAmountUsdt')) $('p2pSellAmountUsdt').value = String(listing.min_deposit || 10);
    if ($('p2pSellAccountName')) $('p2pSellAccountName').value = '';
    if ($('p2pSellAccountNumber')) $('p2pSellAccountNumber').value = '';
    if ($('p2pSellBankName')) $('p2pSellBankName').value = '';
    this.updateP2pSellBankField();
    this.updateP2pSellPreviews();

    modal.classList.remove('hidden');
    document.body.classList.add('sidebar-scroll-lock');
  },

  closeP2pSellModal() {
    this.stopP2pTradePolling();
    $('p2pSellModal')?.classList.add('hidden');
    document.body.classList.remove('sidebar-scroll-lock');
    this.loadP2pActiveOrders();
  },

  updateP2pSellBankField() {
    const method = $('p2pSellPaymentMethod')?.value || '';
    const bankField = $('p2pSellBankNameField');
    const isBank = /bank/i.test(method);
    if (bankField) bankField.classList.toggle('hidden', !isBank);
  },

  updateP2pSellPreviews() {
    if (!this._p2pSellListing) return;
    const rate = Number(this._p2pSellListing.price_mmk_per_usdt) || 0;
    const usdt = parseFloat($('p2pSellAmountUsdt')?.value);
    const mmkEl = $('p2pSellMmkPreview');
    const escrowEl = $('p2pSellEscrowPreview');
    if (!Number.isFinite(usdt) || usdt <= 0 || !rate) {
      if (mmkEl) mmkEl.textContent = '—';
      if (escrowEl) escrowEl.textContent = '—';
      return;
    }
    if (mmkEl) mmkEl.textContent = `${Math.round(usdt * rate).toLocaleString()} MMK`;
    if (escrowEl) escrowEl.textContent = `${usdt.toFixed(2)} USDT`;
  },

  renderP2pSellWaitingStep(data) {
    const order = data.order;
    const fee = data.fee || {};
    this._p2pSellOrder = order;
    const esc = (t) => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const acct = order.user_payment_account || {};
    $('p2pSellOrderSummary').innerHTML = `
      <div class="p2p-buy-summary-row"><span>Buyer</span><strong>${esc(order.seller_name || this._p2pSellListing?.name)}</strong></div>
      <div class="p2p-buy-summary-row"><span>USDT escrowed</span><strong>${Number(order.amount_usdt).toFixed(2)} USDT</strong></div>
      <div class="p2p-buy-summary-row"><span>You receive (MMK)</span><strong>${Math.round(order.amount_mmk).toLocaleString()} MMK</strong></div>
      <div class="p2p-buy-summary-row"><span>Receive via</span><strong>${esc(order.payment_method)}</strong></div>
      <div class="p2p-buy-summary-row"><span>Your account</span><strong>${esc(acct.account_name)} / ${esc(acct.account_number)}</strong></div>
      <div class="p2p-buy-summary-row"><span>Order ref</span><strong>${esc(order.ref_code)}</strong></div>
      <div class="p2p-buy-summary-row p2p-fee-note-row"><span>Platform fee (${fee.fee_percent || 1}%) deducted from escrow on release — you receive full MMK externally.</span></div>
    `;
    $('p2pSellStepAmount')?.classList.add('hidden');
    $('p2pSellStepWaiting')?.classList.remove('hidden');
    $('p2pSellStepDone')?.classList.add('hidden');
    $('p2pSellConfirmMmkBtn')?.classList.remove('hidden');
    $('p2pSellCancelBtn')?.classList.remove('hidden');
    if (data.user) {
      this.renderWalletBalances(data.user);
    } else {
      this.loadWallet();
    }
    this.setupP2pTradePanel('sell', order);
  },

  async submitP2pSellOrder() {
    if (!this._p2pSellListing) return;
    const amountUsdt = parseFloat($('p2pSellAmountUsdt')?.value);
    const paymentMethod = $('p2pSellPaymentMethod')?.value;
    const accountName = $('p2pSellAccountName')?.value?.trim();
    const accountNumber = $('p2pSellAccountNumber')?.value?.trim();
    const bankName = $('p2pSellBankName')?.value?.trim();

    if (!Number.isFinite(amountUsdt) || amountUsdt <= 0) {
      this.toast('Enter a valid USDT amount', 'error');
      return;
    }
    if (!accountName || !accountNumber) {
      this.toast('Enter your MMK receiving account details', 'error');
      return;
    }

    const btn = $('p2pSellContinueBtn');
    if (btn) btn.disabled = true;
    try {
      const data = await Auth.api('POST', '/api/p2p/sell-orders', {
        ad_id: this._p2pSellListing.id,
        amount_usdt: amountUsdt,
        payment_method: paymentMethod,
        account_name: accountName,
        account_number: accountNumber,
        bank_name: bankName || undefined,
      });
      this.renderP2pSellWaitingStep(data);
      this.toast(data.message || 'USDT escrowed — waiting for buyer MMK', 'ok');
      this.loadWallet();
      this.loadP2pActiveOrders();
    } catch (err) {
      if (this.handleP2pKycError(err)) return;
      this.toast(err.message || 'Failed to create sell order', 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  },

  async confirmP2pSellMmkAndRelease() {
    if (!this._p2pSellOrder?.id) return;
    if (!confirm('Confirm you have received the MMK payment? This will release your escrowed USDT to the buyer.')) return;
    const btn = $('p2pSellConfirmMmkBtn');
    if (btn) btn.disabled = true;
    try {
      const data = await Auth.api('POST', `/api/p2p/sell-orders/${this._p2pSellOrder.id}/confirm-mmk-and-release`);
      this.stopP2pTradePolling();
      $('p2pSellStepWaiting')?.classList.add('hidden');
      $('p2pSellStepDone')?.classList.remove('hidden');
      $('p2pSellConfirmMmkBtn')?.classList.add('hidden');
      $('p2pSellCancelBtn')?.classList.add('hidden');
      $('p2pSellRefCode').textContent = data.order?.ref_code || this._p2pSellOrder.ref_code;
      $('p2pSellDoneMessage').textContent = data.message || 'USDT escrow released to buyer.';
      this.toast('Order complete — USDT released', 'ok');
      this.log(`P2P sell order ${data.order?.ref_code} completed`, 'ok');
      this.loadP2pActiveOrders();
    } catch (err) {
      this.toast(err.message || 'Failed to release escrow', 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  },

  async cancelP2pSellOrder() {
    if (!this._p2pSellOrder?.id) return;
    if (!confirm('Cancel this order and refund escrowed USDT to your wallet?')) return;
    const btn = $('p2pSellCancelBtn');
    if (btn) btn.disabled = true;
    try {
      const data = await Auth.api('POST', `/api/p2p/sell-orders/${this._p2pSellOrder.id}/cancel`);
      this.toast(data.message || 'Order cancelled', 'ok');
      this.closeP2pSellModal();
      this.loadWallet();
      this.loadP2pActiveOrders();
    } catch (err) {
      this.toast(err.message || 'Failed to cancel order', 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  },

  bindP2pBuyModal() {
    this._p2pBuyListing = null;
    this._p2pBuyOrder = null;

    $('p2pBuyModalClose')?.addEventListener('click', () => this.closeP2pBuyModal());
    $('p2pBuyDoneCloseBtn')?.addEventListener('click', () => this.closeP2pBuyModal());
    $('p2pBuyModal')?.addEventListener('click', (e) => {
      if (e.target.id === 'p2pBuyModal') this.closeP2pBuyModal();
    });

    $('p2pBuyAmountUsdt')?.addEventListener('input', () => this.updateP2pExternalMmkDisplay());
    $('p2pBuyPaymentMethod')?.addEventListener('change', () => this.updateP2pConfirmButtonLabel());
    $('p2pBuyContinueBtn')?.addEventListener('click', () => this.submitP2pBuyOrder());
    $('p2pBuyConfirmTransferBtn')?.addEventListener('click', () => this.confirmP2pBuyTransfer());
    $('p2pBuyPaymentProofFile')?.addEventListener('change', () => this.previewP2pBuyPaymentProofFile());
    $('p2pBuyReleaseBtn')?.addEventListener('click', () => this.promptP2pBuyReleaseConfirm());
    $('p2pBuyViewReceiptBtn')?.addEventListener('click', () => this.viewP2pOrderPaymentProof(this._p2pBuyOrder));
    $('p2pBuySellerDisputeBtn')?.addEventListener('click', () => this.openP2pSellerDisputeModal(this._p2pBuyOrder));
    $('p2pReleaseConfirmYes')?.addEventListener('click', () => this.executeP2pBuyRelease());
    $('p2pReleaseConfirmCancel')?.addEventListener('click', () => this.closeP2pReleaseConfirmModal());
    $('p2pReleaseConfirmModal')?.addEventListener('click', (e) => {
      if (e.target.id === 'p2pReleaseConfirmModal') this.closeP2pReleaseConfirmModal();
    });
    $('p2pSellerDisputeClose')?.addEventListener('click', () => this.closeP2pSellerDisputeModal());
    $('p2pSellerDisputeModal')?.addEventListener('click', (e) => {
      if (e.target.id === 'p2pSellerDisputeModal') this.closeP2pSellerDisputeModal();
    });
    $('p2pSellerDisputeForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.submitP2pSellerDispute();
    });
    $('p2pBuyCopyRefBtn')?.addEventListener('click', () => {
      const ref = $('p2pBuyRefCode')?.textContent || '';
      if (ref) {
        navigator.clipboard.writeText(ref);
        this.toast('Reference copied', 'ok');
      }
    });

    $('p2pBuyPaymentDetails')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-copy-p2p]');
      if (!btn) return;
      const text = btn.dataset.copyP2p || '';
      if (text) {
        navigator.clipboard.writeText(text);
        this.toast('Copied to clipboard', 'ok');
      }
    });

    $('p2pBuyOpenDisputeBtn')?.addEventListener('click', () => {
      $('p2pBuyDisputeForm')?.classList.toggle('hidden');
    });
    $('p2pBuyChatAttachBtn')?.addEventListener('click', () => $('p2pBuyChatAttachment')?.click());
    $('p2pBuyChatAttachment')?.addEventListener('change', () => this.updateP2pChatAttachHint('buy'));
    $('p2pBuyChatForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.sendP2pChatMessage('buy');
    });
    $('p2pBuyDisputeForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.submitP2pDispute('buy');
    });
  },

  openP2pBuyModal(listing) {
    this._p2pBuyListing = listing;
    this._p2pBuyOrder = null;
    const modal = $('p2pBuyModal');
    if (!modal) return;

    $('p2pBuyStepAmount')?.classList.remove('hidden');
    $('p2pBuyStepPayment')?.classList.add('hidden');
    $('p2pBuyStepDone')?.classList.add('hidden');
    $('p2pBuyConfirmTransferBtn')?.classList.remove('hidden');
    this.resetP2pBuyPaymentProofState();
    $('p2pBuyPaymentProofInline')?.classList.remove('hidden');
    $('p2pBuyPaymentProofView')?.classList.add('hidden');

    const rate = Number(listing.price_mmk_per_usdt) || 0;
    $('p2pBuyModalTitle').textContent = `Buy USDT — ${listing.name}`;
    $('p2pBuyMerchantSummary').textContent =
      `${listing.name} · ${listing.network} · ${listing.price_mmk_formatted || (rate + ' MMK')} per USDT`;
    $('p2pBuyRateBanner').textContent = `Rate: ${Math.round(rate).toLocaleString()} MMK / USDT`;
    $('p2pBuyUsdtLimits').textContent = `Limits: ${listing.limits_formatted || `$${listing.min_deposit} – $${listing.max_deposit} USDT`}`;

    const methodSelect = $('p2pBuyPaymentMethod');
    if (methodSelect) {
      const methods = listing.payment_methods || ['KPay', 'WavePay', 'Bank Transfer'];
      methodSelect.innerHTML = methods.map((m) => `<option value="${m}">${m}</option>`).join('');
    }

    if ($('p2pBuyAmountUsdt')) $('p2pBuyAmountUsdt').value = String(listing.min_order_usdt || listing.min_deposit || 5);
    this.updateP2pExternalMmkDisplay();
    this.updateP2pConfirmButtonLabel();

    modal.classList.remove('hidden');
    document.body.classList.add('sidebar-scroll-lock');
  },

  closeP2pBuyModal() {
    this.stopP2pTradePolling();
    $('p2pBuyModal')?.classList.add('hidden');
    document.body.classList.remove('sidebar-scroll-lock');
    this.loadP2pActiveOrders();
  },

  calcP2pFeeBreakdown(amountUsdt) {
    const buyerReceives = Math.round((parseFloat(amountUsdt) || 0) * 100) / 100;
    const feePercent = Number(this._p2pFeeInfo?.p2p_seller_fee_percent ?? 1);
    const platformFee = Math.round(buyerReceives * feePercent) / 100;
    const sellerTotalUsdt = Math.round((buyerReceives + platformFee) * 100) / 100;
    return {
      amount_usdt: buyerReceives,
      buyer_receives_usdt: buyerReceives,
      fee_percent: feePercent,
      platform_fee_usdt: platformFee,
      seller_total_usdt: sellerTotalUsdt,
      net_usdt_to_buyer: buyerReceives,
      seller_fee_label: `Platform Fee: ${platformFee.toFixed(2)} USDT (Deducted from seller upon release)`,
      buyer_fee_label: this._p2pFeeInfo?.buyer_fee_label || '0% Fee for Buyers',
      buyer_fee_note: this._p2pFeeInfo?.buyer_fee_note || '0% Fee for Buyers. Seller pays platform fee upon release.',
    };
  },

  updateP2pFeePreview() {
    const usdt = parseFloat($('p2pBuyAmountUsdt')?.value);
    const netEl = $('p2pBuyNetUsdtPreview');
    const hintEl = $('p2pBuySellerFeeHint');
    if (!netEl) return;
    const feeNote = this._p2pFeeInfo?.buyer_fee_note || '0% Fee for Buyers. Seller pays platform fee upon release.';
    if (!Number.isFinite(usdt) || usdt <= 0) {
      netEl.textContent = '—';
      if (hintEl) hintEl.textContent = feeNote;
      return;
    }
    const fee = this.calcP2pFeeBreakdown(usdt);
    netEl.textContent = `${fee.buyer_receives_usdt.toFixed(2)} USDT`;
    if (hintEl) hintEl.textContent = feeNote;
  },

  updateP2pExternalMmkDisplay() {
    if (!this._p2pBuyListing) return;
    const rate = Number(this._p2pBuyListing.price_mmk_per_usdt) || 0;
    const usdt = parseFloat($('p2pBuyAmountUsdt')?.value);
    const el = $('p2pBuyExternalMmkAmount');
    if (!el) return;
    if (!Number.isFinite(usdt) || usdt <= 0 || !rate) {
      el.textContent = '—';
      this.updateP2pFeePreview();
      return;
    }
    el.textContent = `${Math.round(usdt * rate).toLocaleString()} MMK (external)`;
    this.updateP2pFeePreview();
  },

  updateP2pConfirmButtonLabel(paymentMethod) {
    const btn = $('p2pBuyConfirmTransferBtn');
    if (!btn) return;
    const method = paymentMethod || $('p2pBuyPaymentMethod')?.value || 'KPay/Bank';
    btn.textContent = `I Have Transferred via ${method}`;
  },

  renderP2pBuyPaymentStep(data) {
    const order = data.order;
    const account = data.payment_account;
    const fee = data.fee || this.calcP2pFeeBreakdown(order.amount_usdt);
    this._p2pBuyOrder = order;

    const esc = (t) => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const buyerReceives = fee.buyer_receives_usdt ?? fee.net_usdt_to_buyer ?? Number(order.amount_usdt);
    const feeNote = fee.buyer_fee_note || '0% Fee for Buyers. Seller pays platform fee upon release.';
    $('p2pBuyOrderSummary').innerHTML = `
      <div class="p2p-buy-summary-row"><span>Seller</span><strong>${esc(order.seller_name || this._p2pBuyListing?.name)}</strong></div>
      <div class="p2p-buy-summary-row"><span>You receive</span><strong>${buyerReceives.toFixed(2)} USDT</strong></div>
      <div class="p2p-buy-summary-row p2p-fee-note-row"><span colspan="2">${esc(feeNote)}</span></div>
      <div class="p2p-buy-summary-row"><span>External payment</span><strong>${Math.round(order.amount_mmk).toLocaleString()} MMK</strong></div>
      <div class="p2p-buy-summary-row"><span>Pay via</span><strong>${esc(order.payment_method)}</strong></div>
      <div class="p2p-buy-summary-row"><span>Order ref</span><strong>${esc(order.ref_code)}</strong></div>
    `;

    if (!account?.account_number) {
      $('p2pBuyPaymentDetails').innerHTML = '<p class="hint">Seller payment details unavailable — contact support with your order ref.</p>';
    } else {
      const bankLine = account.bank_name
        ? `<div class="p2p-pay-account-row"><span>Bank</span><strong>${esc(account.bank_name)}</strong></div>`
        : '';

      $('p2pBuyPaymentDetails').innerHTML = `
        <div class="p2p-pay-account-card">
          <h5>${esc(account.method)} Account</h5>
          ${bankLine}
          <div class="p2p-pay-account-row">
            <span>Account Name</span>
            <strong>${esc(account.account_name)}</strong>
          </div>
          <div class="p2p-pay-account-row">
            <span>Account Number</span>
            <strong>${esc(account.account_number)}</strong>
          </div>
          <div style="display:flex;gap:0.5rem;margin-top:0.65rem;flex-wrap:wrap">
            <button type="button" class="btn btn-secondary btn-sm" data-copy-p2p="${esc(account.account_name)}">Copy Name</button>
            <button type="button" class="btn btn-secondary btn-sm" data-copy-p2p="${esc(account.account_number)}">Copy Number</button>
          </div>
        </div>
      `;
    }

    $('p2pBuyStepAmount')?.classList.add('hidden');
    $('p2pBuyStepPayment')?.classList.remove('hidden');
    $('p2pBuyStepDone')?.classList.add('hidden');
    $('p2pBuyConfirmTransferBtn')?.classList.remove('hidden');
    this.resetP2pBuyPaymentProofState();
    $('p2pBuyPaymentProofInline')?.classList.remove('hidden');
    $('p2pBuyPaymentProofView')?.classList.add('hidden');
    this.updateP2pConfirmButtonLabel(order.payment_method);
    if ($('p2pBuyPaymentHeading')) {
      $('p2pBuyPaymentHeading').textContent = `Send ${Math.round(order.amount_mmk).toLocaleString()} MMK via ${order.payment_method}`;
    }
    this.setupP2pTradePanel('buy', order);
  },

  async submitP2pBuyOrder() {
    if (!this._p2pBuyListing) return;
    const amountUsdt = parseFloat($('p2pBuyAmountUsdt')?.value);
    const paymentMethod = $('p2pBuyPaymentMethod')?.value;

    if (!Number.isFinite(amountUsdt) || amountUsdt <= 0) {
      this.toast('Enter a valid USDT amount', 'error');
      return;
    }

    const btn = $('p2pBuyContinueBtn');
    if (btn) btn.disabled = true;
    try {
      const data = await Auth.api('POST', '/api/p2p/buy-orders', {
        ad_id: this._p2pBuyListing.id,
        amount_usdt: amountUsdt,
        payment_method: paymentMethod,
      });
      this.renderP2pBuyPaymentStep(data);
      this.toast('Order created — pay the seller externally via ' + (paymentMethod || 'KPay/Bank'), 'ok');
      this.loadP2pActiveOrders();
    } catch (err) {
      if (this.handleP2pKycError(err)) return;
      this.toast(err.message || 'Failed to create order', 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  },

  async confirmP2pBuyTransfer() {
    await this.submitP2pBuyPaymentProof();
  },

  resetP2pBuyPaymentProofState() {
    this._p2pBuyPaymentProofFile = null;
    this._p2pBuyPaymentProofBase64 = null;
    if ($('p2pBuyPaymentProofFile')) $('p2pBuyPaymentProofFile').value = '';
    if ($('p2pBuyPaymentTxRef')) $('p2pBuyPaymentTxRef').value = '';
    $('p2pBuyPaymentProofPreview')?.classList.add('hidden');
    const previewImg = $('p2pBuyPaymentProofPreviewImg');
    if (previewImg?._objectUrl) {
      URL.revokeObjectURL(previewImg._objectUrl);
      previewImg._objectUrl = null;
    }
    if (previewImg) {
      previewImg.src = '';
      previewImg.classList.add('hidden');
    }
    if ($('p2pBuyPaymentProofPreviewName')) $('p2pBuyPaymentProofPreviewName').textContent = '';
  },

  previewP2pBuyPaymentProofFile() {
    const input = $('p2pBuyPaymentProofFile');
    const file = input?.files?.[0];
    const previewWrap = $('p2pBuyPaymentProofPreview');
    const previewImg = $('p2pBuyPaymentProofPreviewImg');
    const previewName = $('p2pBuyPaymentProofPreviewName');

    if (!file) {
      this.resetP2pBuyPaymentProofState();
      return;
    }

    this._p2pBuyPaymentProofFile = file;
    previewWrap?.classList.remove('hidden');
    if (previewName) previewName.textContent = file.name;

    if (previewImg?._objectUrl) {
      URL.revokeObjectURL(previewImg._objectUrl);
      previewImg._objectUrl = null;
    }

    const reader = new FileReader();
    reader.onload = () => {
      this._p2pBuyPaymentProofBase64 = reader.result;
      if (previewImg && String(reader.result).startsWith('data:image/')) {
        previewImg.src = reader.result;
        previewImg.classList.remove('hidden');
      } else if (previewImg) {
        previewImg.classList.add('hidden');
      }
    };
    reader.onerror = () => {
      this.toast('Could not read the selected image', 'error');
    };
    reader.readAsDataURL(file);
  },

  renderP2pPaymentProofHtml(order, { allowView = true } = {}) {
    const esc = (t) => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    const proofUrl = order.payment_proof_url || order.paymentProofUrl || order.payment_proof_path;
    const txRef = order.payment_tx_ref;
    if (!proofUrl && !txRef) {
      return '<p class="hint">No payment proof uploaded yet.</p>';
    }
    const isVideo = /\.(mp4|webm|mov|avi)(\?|$)/i.test(proofUrl || '') || String(order.payment_proof_mime_type || '').startsWith('video/');
    const proofBlock = proofUrl
      ? (allowView
        ? `<button type="button" class="p2p-proof-thumb-btn" data-p2p-proof-src="${esc(proofUrl)}" data-p2p-proof-type="${isVideo ? 'video' : 'image'}">
            ${isVideo
              ? `<span class="hint">Video receipt — click to view</span>`
              : `<img src="${esc(proofUrl)}" alt="Payment proof" onerror="this.replaceWith(document.createTextNode('View payment proof'))">`}
          </button>`
        : `<a href="${esc(proofUrl)}" target="_blank" rel="noopener">View payment proof</a>`)
      : '';
    const txBlock = txRef ? `<p class="hint" style="margin:0.35rem 0 0"><strong>TxRef:</strong> ${esc(txRef)}</p>` : '';
    return `${proofBlock}${txBlock}`;
  },

  bindP2pPaymentProofViewers(root) {
    (root || document).querySelectorAll('[data-p2p-proof-src]').forEach((btn) => {
      if (btn.dataset.boundProof) return;
      btn.dataset.boundProof = '1';
      btn.addEventListener('click', () => {
        const src = btn.dataset.p2pProofSrc;
        const type = btn.dataset.p2pProofType || 'image';
        if (src) this.openProofLightbox(src, 'Payment proof', type);
      });
    });
  },

  async submitP2pBuyPaymentProof() {
    if (!this._p2pBuyOrder?.id) {
      this.toast('Create an order first', 'error');
      return;
    }
    if (this._p2pBuyOrder.status !== 'pending_payment') {
      this.toast('Payment has already been confirmed for this order', 'error');
      return;
    }

    const fileInput = $('p2pBuyPaymentProofFile');
    const file = this._p2pBuyPaymentProofFile || fileInput?.files?.[0];
    const base64 = this._p2pBuyPaymentProofBase64;

    if (!file && !base64) {
      this.toast('Upload a payment receipt screenshot before confirming transfer', 'error');
      fileInput?.focus();
      return;
    }

    const btn = $('p2pBuyConfirmTransferBtn');
    const prevLabel = btn?.textContent;
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Submitting…';
    }

    try {
      const txRef = $('p2pBuyPaymentTxRef')?.value?.trim();
      let data;

      if (file) {
        const formData = new FormData();
        formData.append('proof', file, file.name || 'receipt.jpg');
        if (txRef) formData.append('tx_ref', txRef);
        data = await Auth.apiForm(
          `/api/p2p/buy-orders/${this._p2pBuyOrder.id}/confirm-transfer`,
          formData,
          { sensitive: true }
        );
      } else {
        data = await Auth.api('POST', `/api/p2p/buy-orders/${this._p2pBuyOrder.id}/confirm-transfer`, {
          proof_base64: base64,
          proof_filename: file?.name || 'receipt.jpg',
          tx_ref: txRef || undefined,
        }, { sensitive: true });
      }

      this._p2pBuyOrder = { ...this._p2pBuyOrder, ...(data.order || {}) };
      this.stopP2pTradePolling();
      this.resetP2pBuyPaymentProofState();
      $('p2pBuyStepPayment')?.classList.add('hidden');
      $('p2pBuyStepDone')?.classList.remove('hidden');
      $('p2pBuyRefCode').textContent = data.order?.ref_code || this._p2pBuyOrder.ref_code;
      $('p2pBuyDoneMessage').textContent = data.message || 'Pending seller release — USDT will be credited to your USDT wallet after approval.';
      this.toast(data.message || 'Payment proof submitted — pending seller release', 'ok');
      this.log(`P2P buy order ${data.order?.ref_code} pending seller release`, 'ok');
      this.loadP2pActiveOrders();
    } catch (err) {
      if (err.code === 'SENSITIVE_AUTH_REQUIRED') $('pinUnlockModal')?.classList.remove('hidden');
      this.toast(err.message || 'Failed to confirm transfer', 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = prevLabel || 'I Have Transferred via KPay/Bank';
        this.updateP2pConfirmButtonLabel(this._p2pBuyOrder?.payment_method);
      }
    }
  },

  updateP2pChatAttachHint(orderType) {
    const prefix = orderType === 'sell' ? 'p2pSell' : 'p2pBuy';
    const fileInput = $(`${prefix}ChatAttachment`);
    const hint = $(`${prefix}ChatAttachHint`);
    const file = fileInput?.files?.[0];
    if (!hint) return;
    if (!file) {
      hint.classList.add('hidden');
      hint.textContent = '';
      return;
    }
    hint.classList.remove('hidden');
    hint.textContent = `Attached: ${file.name} — click Send to share in chat`;
  },

  async loadP2pPage() {
    if (!Auth.isLoggedIn()) {
      $('p2pActiveOrdersSection')?.classList.add('hidden');
      $('p2pMyAdsSection')?.classList.add('hidden');
      const el = $('p2pMarketList');
      if (el) el.innerHTML = '<p class="hint">Log in to view P2P market.</p>';
      return;
    }
    await Promise.all([
      this.loadP2pActiveOrders(),
      this.loadP2pMarket(),
      this.loadMyP2pAds(),
      this.loadKycStatus(),
    ]);
  },

  async loadP2pMarket() {
    const el = $('p2pMarketList');
    if (!el || !Auth.isLoggedIn()) {
      if (el) el.innerHTML = '<p class="hint">Log in to view P2P market.</p>';
      return;
    }
    const side = this._p2pTab === 'sell' ? 'buy' : 'sell';
    const network = $('p2pNetworkFilter')?.value || '';
    try {
      const qs = new URLSearchParams({ side });
      if (network) qs.set('network', network);
      const data = await Auth.api('GET', `/api/p2p/market?${qs.toString()}`);
      const listings = data.listings || [];
      this._p2pListings = listings;
      if (data.fee_info) {
        this._p2pFeeInfo = data.fee_info;
        const badge = $('p2pBuyerFeeBadge');
        if (badge) badge.textContent = data.fee_info.buyer_fee_note || data.fee_info.buyer_fee_label || '0% Fee for Buyers';
      }
      const tabLabel = this._p2pTab === 'buy' ? 'Buy USDT' : 'Sell USDT';
      const actionLabel = this._p2pTab === 'buy' ? 'Buy USDT' : 'Sell USDT';
      const emptyMsg = this._p2pTab === 'buy'
        ? 'No users selling USDT right now. Post a sell ad or check back later.'
        : 'No buyers available right now. Post a buy ad or check back later.';
      if (!listings.length) {
        el.innerHTML = `<p class="hint">${emptyMsg}</p>`;
        return;
      }
      const esc = (t) => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
      el.innerHTML = listings.map((l) => `
        <article class="p2p-order-card">
          <div class="p2p-order-main">
            <h3>${esc(l.user_name || l.name)}${l.is_kyc_verified ? ' <span class="p2p-verified-badge" title="KYC Verified">🛡 Verified</span>' : ''} <span class="p2p-network-badge">${esc(l.network)}</span></h3>
            <div class="p2p-order-price">${esc(l.price_mmk_formatted)} <small style="font-weight:500;color:var(--text-secondary)">/ USDT</small></div>
            <div class="p2p-order-meta">
              <span>Limits: <strong>${esc(l.limits_formatted)}</strong></span>
              <span>Available: <strong style="color:#4ade80">${esc(l.liquidity_formatted || (Number(l.available_volume_usdt || 0).toFixed(2) + ' USDT'))}</strong></span>
            </div>
            <div class="p2p-pay-methods">
              ${(l.payment_methods || []).map((m) => `<span class="p2p-pay-badge">${esc(m)}</span>`).join('')}
            </div>
          </div>
          <div class="p2p-order-actions">
            <button type="button" class="btn btn-primary btn-sm" data-p2p-trade="${this._p2pTab}" data-id="${l.id}">${actionLabel}</button>
          </div>
        </article>
      `).join('');
    } catch (err) {
      const msg = String(err.message || 'Failed to load P2P market').replace(/&/g, '&amp;').replace(/</g, '&lt;');
      el.innerHTML = `<p class="hint" style="color:#ef4444">${msg}</p>`;
    }
  },

  formatP2pTimer(seconds) {
    const s = Math.max(0, Number(seconds) || 0);
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  },

  parseP2pExpiresMs(expiresAt) {
    if (!expiresAt) return null;
    const iso = String(expiresAt).includes('T') ? expiresAt : `${String(expiresAt).replace(' ', 'T')}Z`;
    const ms = Date.parse(iso);
    return Number.isFinite(ms) ? ms : null;
  },

  stopP2pTradePolling() {
    if (this._p2pTimerInterval) {
      clearInterval(this._p2pTimerInterval);
      this._p2pTimerInterval = null;
    }
    if (this._p2pChatInterval) {
      clearInterval(this._p2pChatInterval);
      this._p2pChatInterval = null;
    }
    this._p2pActiveTrade = null;
  },

  setupP2pTradePanel(orderType, order) {
    if (!order?.id) return;
    this.stopP2pTradePolling();
    this._p2pActiveTrade = { orderType, orderId: order.id };

    const prefix = orderType === 'sell' ? 'p2pSell' : 'p2pBuy';
    const timerBanner = $(`${prefix}TimerBanner`);
    const timerDisplay = $(`${prefix}TimerDisplay`);
    const disputeBanner = $(`${prefix}DisputeBanner`);
    const openDisputeBtn = $(`${prefix}OpenDisputeBtn`);
    const disputeForm = $(`${prefix}DisputeForm`);
    const confirmBtn = orderType === 'buy' ? $('p2pBuyConfirmTransferBtn') : $('p2pSellConfirmMmkBtn');
    const cancelBtn = orderType === 'sell' ? $('p2pSellCancelBtn') : null;

    const isDisputed = order.is_disputed || order.dispute_status === 'open';
    disputeBanner?.classList.toggle('hidden', !isDisputed);
    disputeForm?.classList.add('hidden');
    openDisputeBtn?.classList.toggle('hidden', isDisputed);
    if (orderType === 'buy') {
      const isMaker = order.role === 'maker' || order.maker_can_release;
      openDisputeBtn?.classList.toggle('hidden', isDisputed || (isMaker && order.status === 'pending_seller_release'));
    }
    if (isDisputed) {
      confirmBtn?.classList.add('hidden');
      cancelBtn?.classList.add('hidden');
      $('p2pBuyReleaseBtn')?.classList.add('hidden');
      $('p2pBuySellerActions')?.classList.add('hidden');
    }

    const showTimer = order.show_timer ?? (
      orderType === 'buy'
        ? order.status === 'pending_payment' && !!order.expires_at
        : order.status === 'pending_merchant_mmk' && !!order.expires_at
    );
    timerBanner?.classList.toggle('hidden', !showTimer);

    const tickTimer = () => {
      let remaining = order.seconds_remaining;
      if (order.expires_at) {
        const ms = this.parseP2pExpiresMs(order.expires_at);
        if (ms) remaining = Math.max(0, Math.floor((ms - Date.now()) / 1000));
      }
      if (timerDisplay) timerDisplay.textContent = this.formatP2pTimer(remaining);
      timerBanner?.classList.toggle('is-urgent', remaining <= 120);
      if (remaining <= 0 && showTimer) {
        this.toast('Order payment window expired — refreshing…', 'error');
        this.loadP2pActiveOrders();
        if (this._p2pActiveTrade?.orderId === order.id) {
          this.resumeP2pOrder(orderType, order.id);
        }
      }
    };
    if (showTimer) {
      tickTimer();
      this._p2pTimerInterval = setInterval(tickTimer, 1000);
    }

    this.loadP2pChatMessages(orderType, order.id);
    this._p2pChatInterval = setInterval(() => {
      this.loadP2pChatMessages(orderType, order.id, { silent: true });
    }, 8000);
  },

  renderP2pChatMessages(orderType, messages) {
    const el = orderType === 'sell' ? $('p2pSellChatMessages') : $('p2pBuyChatMessages');
    if (!el) return;
    const esc = (t) => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    if (!messages?.length) {
      el.innerHTML = '<p class="hint" style="margin:0">No messages yet — share payment details or receipts here.</p>';
      return;
    }
    el.innerHTML = messages.map((m) => {
      const roleCls = m.sender_role === 'system' ? 'is-system' : m.sender_role === 'admin' ? 'is-admin' : '';
      const isVideo = /\.(mp4|webm|mov|avi)(\?|$)/i.test(m.attachment_path || '');
      const attachment = m.attachment_path
        ? `<div class="p2p-chat-msg-attachment">
            <button type="button" class="p2p-proof-thumb-btn" data-p2p-proof-src="${esc(m.attachment_path)}" data-p2p-proof-type="${isVideo ? 'video' : 'image'}">
              ${isVideo
                ? `<span class="hint">Video attachment — click to view</span>`
                : `<img src="${esc(m.attachment_path)}" alt="Attachment" onerror="this.parentElement.textContent='View attachment'">`}
            </button>
          </div>`
        : '';
      const tx = m.tx_ref ? `<div><small>TxRef: ${esc(m.tx_ref)}</small></div>` : '';
      return `<div class="p2p-chat-msg ${roleCls}"><div class="p2p-chat-msg-meta">${esc(m.sender_name || m.sender_role)} · ${esc(m.created_at || '')}</div><div>${esc(m.message || '')}</div>${tx}${attachment}</div>`;
    }).join('');
    this.bindP2pPaymentProofViewers(el);
    el.scrollTop = el.scrollHeight;
  },

  async loadP2pChatMessages(orderType, orderId, { silent = false } = {}) {
    try {
      const data = await Auth.api('GET', `/api/p2p/orders/${orderType}/${orderId}/messages`);
      this.renderP2pChatMessages(orderType, data.messages || []);
    } catch (err) {
      if (!silent) console.warn('[p2p chat]', err.message);
    }
  },

  async sendP2pChatMessage(orderType) {
    const prefix = orderType === 'sell' ? 'p2pSell' : 'p2pBuy';
    const order = orderType === 'sell' ? this._p2pSellOrder : this._p2pBuyOrder;
    if (!order?.id) return;
    const input = $(`${prefix}ChatInput`);
    const fileInput = $(`${prefix}ChatAttachment`);
    const text = input?.value?.trim();
    const file = fileInput?.files?.[0];
    if (!text && !file) {
      this.toast('Enter a message or attach a file', 'error');
      return;
    }
    try {
      const formData = new FormData();
      if (text) formData.append('message', text);
      if (file) formData.append('attachment', file);
      await Auth.apiForm(`/api/p2p/orders/${orderType}/${order.id}/messages`, formData, { sensitive: true });
      if (input) input.value = '';
      if (fileInput) fileInput.value = '';
      this.updateP2pChatAttachHint(orderType);
      await this.loadP2pChatMessages(orderType, order.id);
    } catch (err) {
      this.toast(err.message || 'Failed to send message', 'error');
    }
  },

  async submitP2pDispute(orderType) {
    const prefix = orderType === 'sell' ? 'p2pSell' : 'p2pBuy';
    const order = orderType === 'sell' ? this._p2pSellOrder : this._p2pBuyOrder;
    if (!order?.id) return;
    const reason = $(`${prefix}DisputeReason`)?.value?.trim();
    const txRef = $(`${prefix}DisputeTxRef`)?.value?.trim();
    const proofInput = $(`${prefix}DisputeProof`);
    const formData = new FormData();
    if (reason) formData.append('reason', reason);
    if (txRef) formData.append('tx_ref', txRef);
    if (proofInput?.files?.[0]) formData.append('proof', proofInput.files[0]);
    try {
      const data = await Auth.apiForm(`/api/p2p/orders/${orderType}/${order.id}/dispute`, formData, { sensitive: true });
      this.toast(data.message || 'Dispute submitted', 'ok');
      if (orderType === 'sell') this._p2pSellOrder = { ...order, ...data.order, is_disputed: true };
      else this._p2pBuyOrder = { ...order, ...data.order, is_disputed: true };
      $(`${prefix}DisputeForm`)?.classList.add('hidden');
      this.setupP2pTradePanel(orderType, orderType === 'sell' ? this._p2pSellOrder : this._p2pBuyOrder);
      await this.loadP2pActiveOrders();
    } catch (err) {
      this.toast(err.message || 'Failed to open dispute', 'error');
    }
  },

  async loadP2pActiveOrders() {
    const section = $('p2pActiveOrdersSection');
    const list = $('p2pActiveOrdersList');
    if (!section || !list) return;

    if (!Auth.isLoggedIn()) {
      section.classList.add('hidden');
      list.innerHTML = '';
      return;
    }

    list.innerHTML = '<p class="hint p2p-active-orders-loading">Loading active orders…</p>';
    section.classList.remove('hidden');

    try {
      const data = await Auth.api('GET', '/api/p2p/active-orders');
      this._p2pActiveOrders = data.orders || [];
      if (!this._p2pActiveOrders.length) {
        section.classList.add('hidden');
        list.innerHTML = '';
        return;
      }
      section.classList.remove('hidden');
      const esc = (t) => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
      list.innerHTML = this._p2pActiveOrders.map((o) => {
        const amount = Number(o.escrow_amount_usdt ?? o.amount_usdt).toFixed(2);
        const statusClass = o.requires_action ? 'needs-action' : '';
        const badgeClass = o.display_status_code === 'ESCROWED' ? 'is-escrowed' : (o.is_disputed ? 'is-disputed' : '');
        const timerHtml = o.show_timer && o.seconds_remaining != null
          ? `<span class="p2p-active-order-timer">⏱ ${this.formatP2pTimer(o.seconds_remaining)} left</span>`
          : '';
        const isSellerPendingRelease = o.order_type === 'buy'
          && o.role === 'maker'
          && o.status === 'pending_seller_release'
          && !o.is_disputed;
        const proofUrl = o.payment_proof_url || o.paymentProofUrl || o.payment_proof_path;
        let actionsHtml;
        if (isSellerPendingRelease) {
          actionsHtml = `
            <div class="p2p-active-order-actions">
              ${proofUrl ? `<button type="button" class="btn btn-secondary btn-sm" data-p2p-view-receipt data-order-id="${o.id}">View Receipt</button>` : ''}
              <button type="button" class="btn btn-sm btn-reject" data-p2p-seller-dispute data-order-type="buy" data-order-id="${o.id}">Open Dispute</button>
              <button type="button" class="btn btn-sm btn-approve" data-p2p-seller-release data-order-id="${o.id}">Release USDT</button>
            </div>`;
        } else {
          actionsHtml = `<button type="button" class="btn btn-primary btn-sm" data-p2p-reopen-order data-order-type="${esc(o.order_type)}" data-order-id="${o.id}">${esc(o.action_label || 'Resume / View Details')}</button>`;
        }
        return `
          <article class="p2p-active-order-card ${statusClass}">
            <div class="p2p-active-order-main">
              <div class="p2p-active-order-ref">${esc(o.ref_code)} · ${esc(o.counterparty_name || o.seller_name || 'User')}${o.role === 'maker' ? ' (your ad)' : ''}</div>
              <div class="p2p-active-order-amount">${amount} USDT${o.order_type === 'buy' && o.role === 'maker' ? ' to release' : ' escrowed'}</div>
              <div class="p2p-active-order-meta">
                <span class="p2p-active-order-status ${badgeClass}">${esc(o.status_badge || o.display_status)}</span>
                ${timerHtml}
              </div>
            </div>
            ${actionsHtml}
          </article>
        `;
      }).join('');
    } catch (err) {
      console.warn('[p2p active orders]', err.message);
      section.classList.add('hidden');
      list.innerHTML = '';
    }
  },

  async resumeP2pOrder(orderType, orderId) {
    try {
      const data = await Auth.api('GET', `/api/p2p/active-orders/${orderType}/${orderId}`);
      const order = data.order;
      if (!order) {
        this.toast('This order is no longer active', 'error');
        await this.loadP2pActiveOrders();
        return;
      }
      this.reopenP2pOrder(order);
    } catch (err) {
      this.toast(err.message || 'Failed to load order', 'error');
      await this.loadP2pActiveOrders();
    }
  },

  reopenP2pOrder(order) {
    if (!order) return;
    if (order.order_type === 'sell') {
      this.reopenP2pSellOrder(order);
      return;
    }
    this.reopenP2pBuyOrder(order);
  },

  reopenP2pSellOrder(order) {
    this._p2pSellListing = {
      id: order.ad_id || order.seller_id,
      name: order.seller_name || order.counterparty_name,
      price_mmk_per_usdt: order.price_mmk_per_usdt,
    };
    this._p2pSellOrder = order;
    const modal = $('p2pSellModal');
    if (!modal) return;
    $('p2pSellModalTitle').textContent = `Sell USDT — ${order.seller_name || 'Buyer'}`;
    this.renderP2pSellWaitingStep({ order, fee: order.fee || {} });
    modal.classList.remove('hidden');
    document.body.classList.add('sidebar-scroll-lock');
  },

  reopenP2pBuyOrder(order) {
    this._p2pBuyListing = {
      id: order.ad_id || order.seller_id,
      name: order.seller_name || order.counterparty_name,
      price_mmk_per_usdt: order.price_mmk_per_usdt,
    };
    this._p2pBuyOrder = order;
    const modal = $('p2pBuyModal');
    if (!modal) return;
    const isMaker = order.role === 'maker' || order.maker_can_release;
    $('p2pBuyModalTitle').textContent = isMaker
      ? `Release USDT — ${order.ref_code}`
      : `Buy USDT — ${order.seller_name || order.counterparty_name || 'Seller'}`;

    if (order.status === 'pending_seller_release') {
      this.renderP2pBuyPendingReleaseStep(order);
    } else {
      $('p2pBuyReleaseBtn')?.classList.add('hidden');
      this.renderP2pBuyPaymentStep({
        order,
        payment_account: order.payment_account,
        fee: order.fee || this.calcP2pFeeBreakdown(order.amount_usdt),
      });
    }

    modal.classList.remove('hidden');
    document.body.classList.add('sidebar-scroll-lock');
  },

  renderP2pBuyPendingReleaseStep(order) {
    this._p2pBuyOrder = order;
    const esc = (t) => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const fee = order.fee || this.calcP2pFeeBreakdown(order.amount_usdt);
    const buyerReceives = fee.buyer_receives_usdt ?? Number(order.amount_usdt);
    const isMaker = order.role === 'maker' || order.maker_can_release;
    const counterparty = isMaker ? (order.user_name || 'Buyer') : (order.seller_name || order.counterparty_name || 'Seller');
    $('p2pBuyOrderSummary').innerHTML = `
      <div class="p2p-buy-summary-row"><span>${isMaker ? 'Buyer' : 'Seller'}</span><strong>${esc(counterparty)}</strong></div>
      <div class="p2p-buy-summary-row"><span>${isMaker ? 'Release to buyer' : 'You receive'}</span><strong>${buyerReceives.toFixed(2)} USDT</strong></div>
      <div class="p2p-buy-summary-row"><span>External payment</span><strong>${Math.round(order.amount_mmk).toLocaleString()} MMK</strong></div>
      <div class="p2p-buy-summary-row"><span>Order ref</span><strong>${esc(order.ref_code)}</strong></div>
      <div class="p2p-buy-summary-row"><span>Status</span><strong>${isMaker ? 'Confirm & Release' : 'Pending Release'}</strong></div>
    `;
    $('p2pBuyPaymentDetails').innerHTML = isMaker
      ? '<p class="hint">Buyer confirmed MMK payment with receipt. Review the payment proof below, then release USDT. Platform fee is deducted from your escrow automatically.</p>'
      : '<p class="hint">MMK payment confirmed. Waiting for seller to release USDT to your wallet.</p>';
    const proofView = $('p2pBuyPaymentProofView');
    const proofBody = $('p2pBuyPaymentProofViewBody');
    const hasProof = order.payment_proof_url || order.paymentProofUrl || order.payment_proof_path || order.payment_tx_ref;
    if (proofView && proofBody) {
      if (hasProof) {
        proofView.classList.remove('hidden');
        proofBody.innerHTML = this.renderP2pPaymentProofHtml(order);
        this.bindP2pPaymentProofViewers(proofBody);
      } else {
        proofView.classList.add('hidden');
        proofBody.innerHTML = '';
      }
    }
    this.resetP2pBuyPaymentProofState();
    $('p2pBuyStepAmount')?.classList.add('hidden');
    $('p2pBuyStepPayment')?.classList.remove('hidden');
    $('p2pBuyStepDone')?.classList.add('hidden');
    $('p2pBuyConfirmTransferBtn')?.classList.add('hidden');
    $('p2pBuyPaymentProofInline')?.classList.add('hidden');
    $('p2pBuyReleaseBtn')?.classList.toggle('hidden', !isMaker || order.is_disputed);
    $('p2pBuySellerActions')?.classList.toggle('hidden', !isMaker || order.is_disputed || order.dispute_status === 'open');
    if ($('p2pBuyPaymentHeading')) {
      $('p2pBuyPaymentHeading').textContent = isMaker ? 'Release USDT to buyer' : 'Order pending seller release';
    }
    $('p2pBuyTimerBanner')?.classList.add('hidden');
    this.setupP2pTradePanel('buy', order);
  },

  getP2pPaymentProofUrl(order) {
    if (!order) return null;
    return order.payment_proof_url || order.paymentProofUrl || order.payment_proof_path || null;
  },

  viewP2pOrderPaymentProof(order) {
    const proofUrl = this.getP2pPaymentProofUrl(order);
    if (!proofUrl) {
      this.toast('No payment receipt uploaded yet', 'error');
      return;
    }
    const mime = order.payment_proof_mime_type || '';
    const isVideo = mime.startsWith('video/') || /\.(mp4|webm|mov|avi)(\?|$)/i.test(proofUrl);
    const caption = order.payment_tx_ref
      ? `Payment proof · TxRef: ${order.payment_tx_ref}`
      : 'Buyer payment receipt';
    this.openProofLightbox(proofUrl, caption, isVideo ? 'video' : 'image');
  },

  promptP2pBuyReleaseConfirm(orderId) {
    const id = orderId || this._p2pBuyOrder?.id;
    if (!id) return;
    this._p2pReleaseConfirmOrderId = id;
    $('p2pReleaseConfirmModal')?.classList.remove('hidden');
    document.body.classList.add('sidebar-scroll-lock');
  },

  closeP2pReleaseConfirmModal() {
    $('p2pReleaseConfirmModal')?.classList.add('hidden');
    this._p2pReleaseConfirmOrderId = null;
    if (!$('p2pBuyModal')?.classList.contains('hidden') || !$('p2pSellerDisputeModal')?.classList.contains('hidden')) return;
    document.body.classList.remove('sidebar-scroll-lock');
  },

  openP2pSellerDisputeModal(order) {
    if (!order?.id) return;
    this._p2pSellerDisputeOrder = order;
    if ($('p2pSellerDisputeOrderId')) $('p2pSellerDisputeOrderId').value = String(order.id);
    if ($('p2pSellerDisputeOrderType')) $('p2pSellerDisputeOrderType').value = order.order_type || 'buy';
    if ($('p2pSellerDisputeReason')) {
      $('p2pSellerDisputeReason').value = order.role === 'maker'
        ? 'MMK payment not received in my KPay/Bank account — buyer receipt appears invalid.'
        : '';
    }
    if ($('p2pSellerDisputeProof')) $('p2pSellerDisputeProof').value = '';
    if ($('p2pSellerDisputeTitle')) {
      $('p2pSellerDisputeTitle').textContent = `Open Dispute — ${order.ref_code || 'Order'}`;
    }
    $('p2pSellerDisputeModal')?.classList.remove('hidden');
    document.body.classList.add('sidebar-scroll-lock');
  },

  closeP2pSellerDisputeModal() {
    $('p2pSellerDisputeModal')?.classList.add('hidden');
    this._p2pSellerDisputeOrder = null;
    if (!$('p2pBuyModal')?.classList.contains('hidden') || !$('p2pReleaseConfirmModal')?.classList.contains('hidden')) return;
    document.body.classList.remove('sidebar-scroll-lock');
  },

  async submitP2pSellerDispute() {
    const order = this._p2pSellerDisputeOrder;
    const orderType = $('p2pSellerDisputeOrderType')?.value || 'buy';
    const orderId = parseInt($('p2pSellerDisputeOrderId')?.value || order?.id, 10);
    const reason = $('p2pSellerDisputeReason')?.value?.trim();
    if (!orderId || !reason) {
      this.toast('Describe why you are opening this dispute', 'error');
      return;
    }

    const formData = new FormData();
    formData.append('reason', reason);
    const proofFile = $('p2pSellerDisputeProof')?.files?.[0];
    if (proofFile) formData.append('proof', proofFile);

    const btn = $('p2pSellerDisputeForm')?.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    try {
      const data = await Auth.apiForm(`/api/p2p/orders/${orderType}/${orderId}/dispute`, formData, { sensitive: true });
      this.toast(data.message || 'Dispute submitted — admin will review', 'ok');
      this.closeP2pSellerDisputeModal();
      if (this._p2pBuyOrder?.id === orderId) {
        this._p2pBuyOrder = { ...this._p2pBuyOrder, ...(data.order || {}), is_disputed: true, dispute_status: 'open' };
        this.renderP2pBuyPendingReleaseStep(this._p2pBuyOrder);
      }
      await this.loadP2pActiveOrders();
    } catch (err) {
      if (err.code === 'SENSITIVE_AUTH_REQUIRED') $('pinUnlockModal')?.classList.remove('hidden');
      this.toast(err.message || 'Failed to open dispute', 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  },

  async releaseP2pBuyOrderAsMaker() {
    this.promptP2pBuyReleaseConfirm();
  },

  async executeP2pBuyRelease() {
    const orderId = this._p2pReleaseConfirmOrderId || this._p2pBuyOrder?.id;
    if (!orderId) return;

    this.closeP2pReleaseConfirmModal();
    const btn = $('p2pBuyReleaseBtn');
    const cardReleaseBtns = document.querySelectorAll(`[data-p2p-seller-release][data-order-id="${orderId}"]`);
    if (btn) btn.disabled = true;
    cardReleaseBtns.forEach((b) => { b.disabled = true; });

    try {
      const data = await Auth.api('POST', `/api/p2p/buy-orders/${orderId}/release`);
      if (this._p2pBuyOrder?.id === orderId) {
        this.stopP2pTradePolling();
        $('p2pBuyStepPayment')?.classList.add('hidden');
        $('p2pBuyStepDone')?.classList.remove('hidden');
        $('p2pBuyReleaseBtn')?.classList.add('hidden');
        $('p2pBuySellerActions')?.classList.add('hidden');
        $('p2pBuyRefCode').textContent = data.order?.ref_code || this._p2pBuyOrder.ref_code;
        $('p2pBuyDoneMessage').textContent = data.message || 'USDT released to buyer.';
      }
      this.toast('USDT released to buyer', 'ok');
      this.loadP2pActiveOrders();
      this.loadMyP2pAds();
    } catch (err) {
      this.toast(err.message || 'Failed to release USDT', 'error');
    } finally {
      if (btn) btn.disabled = false;
      cardReleaseBtns.forEach((b) => { b.disabled = false; });
    }
  },

  bindP2pPostAdModal() {
    $('p2pPostAdModalClose')?.addEventListener('click', () => this.closePostP2pAdModal());
    $('p2pPostAdModal')?.addEventListener('click', (e) => {
      if (e.target.id === 'p2pPostAdModal') this.closePostP2pAdModal();
    });
    $('p2pAdSide')?.addEventListener('change', () => this.updateP2pAdEscrowHint());
    $('p2pPostAdForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.submitPostP2pAd();
    });
  },

  updateP2pAdEscrowHint() {
    const side = $('p2pAdSide')?.value;
    const hint = $('p2pAdEscrowHint');
    if (hint) {
      hint.textContent = side === 'sell'
        ? 'Sell ads: this amount is escrowed from your USDT wallet immediately.'
        : 'Buy ads: no USDT escrow — you pay MMK externally when sellers accept your ad.';
    }
  },

  openPostP2pAdModal() {
    if (!Auth.isLoggedIn()) {
      this.toast('Please log in to post an ad', 'error');
      return;
    }
    if (!this.isKycVerified()) {
      this.showKycGateModal();
      return;
    }
    $('p2pPostAdError').textContent = '';
    $('p2pPostAdForm')?.reset();
    if ($('p2pAdMin')) $('p2pAdMin').value = '5';
    if ($('p2pAdMax')) $('p2pAdMax').value = '500';
    this.updateP2pAdEscrowHint();
    $('p2pPostAdModal')?.classList.remove('hidden');
    document.body.classList.add('sidebar-scroll-lock');
  },

  closePostP2pAdModal() {
    $('p2pPostAdModal')?.classList.add('hidden');
    document.body.classList.remove('sidebar-scroll-lock');
  },

  async submitPostP2pAd() {
    const side = $('p2pAdSide')?.value || 'sell';
    const methods = [...document.querySelectorAll('input[name="p2pAdPayMethod"]:checked')].map((el) => el.value);
    if (!methods.length) {
      $('p2pPostAdError').textContent = 'Select at least one payment method';
      return;
    }
    const body = {
      side,
      network: $('p2pAdNetwork')?.value || 'TRC20',
      price_mmk_per_usdt: parseFloat($('p2pAdRate')?.value),
      total_volume_usdt: parseFloat($('p2pAdVolume')?.value),
      min_order_usdt: parseFloat($('p2pAdMin')?.value || '5'),
      max_order_usdt: parseFloat($('p2pAdMax')?.value || '500'),
      payment_methods: methods,
      kpay_account_name: $('p2pAdKpayName')?.value?.trim(),
      kpay_account_number: $('p2pAdKpayNumber')?.value?.trim(),
      wave_account_name: $('p2pAdWaveName')?.value?.trim(),
      wave_account_number: $('p2pAdWaveNumber')?.value?.trim(),
      kbz_account_name: $('p2pAdKbzName')?.value?.trim(),
      kbz_account_number: $('p2pAdKbzNumber')?.value?.trim(),
    };
    try {
      const data = await Auth.api('POST', '/api/p2p/ads', body);
      this.toast(data.message || 'Ad posted', 'ok');
      this.closePostP2pAdModal();
      this.loadP2pPage();
      this.loadWallet();
    } catch (err) {
      if ($('p2pPostAdError')) $('p2pPostAdError').textContent = err.message || 'Failed to post ad';
      if (this.handleP2pKycError(err)) return;
    }
  },

  async loadMyP2pAds() {
    const section = $('p2pMyAdsSection');
    const list = $('p2pMyAdsList');
    if (!section || !list || !Auth.isLoggedIn()) {
      section?.classList.add('hidden');
      return;
    }
    try {
      const data = await Auth.api('GET', '/api/p2p/ads');
      const ads = (data.ads || []).filter((a) => a.status === 'active' || a.status === 'paused');
      if (!ads.length) {
        section.classList.add('hidden');
        return;
      }
      section.classList.remove('hidden');
      const esc = (t) => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
      list.innerHTML = ads.map((a) => `
        <article class="p2p-order-card">
          <div class="p2p-order-main">
            <h3>${esc(a.side === 'sell' ? 'Sell' : 'Buy')} USDT · ${esc(a.price_mmk_formatted)}</h3>
            <div class="p2p-order-meta">
              <span>Available: <strong>${Number(a.available_volume_usdt).toFixed(2)} / ${Number(a.total_volume_usdt).toFixed(2)} USDT</strong></span>
              <span>Status: <strong>${esc(a.status)}</strong></span>
            </div>
          </div>
          <div class="p2p-order-actions">
            <button type="button" class="btn btn-reject btn-sm" data-cancel-p2p-ad data-id="${a.id}">Cancel Ad</button>
          </div>
        </article>
      `).join('');
    } catch (_) {
      section.classList.add('hidden');
    }
  },

  async cancelP2pAd(adId) {
    if (!confirm('Cancel this ad? Remaining USDT escrow will be refunded for sell ads.')) return;
    try {
      const data = await Auth.api('POST', `/api/p2p/ads/${adId}/cancel`);
      this.toast(data.message || 'Ad cancelled', 'ok');
      this.loadP2pPage();
      this.loadWallet();
    } catch (err) {
      this.toast(err.message || 'Failed to cancel ad', 'error');
    }
  },

  calculateUsdtDepositFeePreviewClient(amountUsdt) {
    const fees = this.withdrawalFees || this.pricingSettings || {};
    const amount = Math.round((Number(amountUsdt) || 0) * 100) / 100;
    if (!(amount > 0)) return null;
    const feePercent = Number(fees.payment_service_fee_percent ?? 2);
    const minimumFee = Number(fees.payment_service_fee_minimum_usdt ?? 1);
    const percentFee = Math.round(amount * feePercent) / 100;
    const fee = Math.round(Math.max(percentFee, minimumFee) * 100) / 100;
    const net = Math.round((amount - fee) * 100) / 100;
    return {
      amount_usdt: amount,
      fee_usdt: fee,
      net_usdt: net,
      fee_label: percentFee < minimumFee
        ? `min $${minimumFee.toFixed(2)} (2% = $${percentFee.toFixed(2)})`
        : `${feePercent}% ($${fee.toFixed(2)})`,
      invalid_net: net <= 0,
    };
  },

  calculateMmkDepositFeePreviewClient(amountMmk) {
    const fees = this.withdrawalFees || this.pricingSettings || {};
    const amount = Math.round(Number(amountMmk) || 0);
    if (!(amount > 0)) return null;
    const feePercent = Number(fees.payment_service_fee_percent ?? 2);
    const rate = Number(fees.mmk_to_usd_rate || this.pricingSettings?.mmk_to_usd_rate || 4500);
    const minimumFee = Math.round(Number(fees.payment_service_fee_minimum_usdt ?? 1) * rate);
    const percentFee = Math.round(amount * feePercent / 100);
    const fee = Math.max(percentFee, minimumFee);
    const net = amount - fee;
    return {
      amount_mmk: amount,
      fee_mmk: fee,
      net_mmk: net,
      fee_label: percentFee < minimumFee
        ? `min ${minimumFee.toLocaleString()} MMK (${feePercent}% = ${percentFee.toLocaleString()} MMK)`
        : `${feePercent}% (${fee.toLocaleString()} MMK)`,
      invalid_net: net <= 0,
    };
  },

  updateUsdtDepositFeePreview() {
    const amount = parseFloat($('usdtAmount')?.value);
    const preview = this.calculateUsdtDepositFeePreviewClient(amount);
    if ($('usdtDepositPreviewGross')) {
      $('usdtDepositPreviewGross').textContent = preview ? `$${preview.amount_usdt.toFixed(2)}` : '—';
    }
    if ($('usdtDepositPreviewFee')) {
      $('usdtDepositPreviewFee').textContent = preview ? preview.fee_label : '—';
    }
    if ($('usdtDepositPreviewNet')) {
      $('usdtDepositPreviewNet').textContent = preview
        ? (preview.invalid_net ? 'Invalid' : `$${preview.net_usdt.toFixed(2)}`)
        : '—';
    }
  },

  updateMmkDepositFeePreview() {
    const amount = parseFloat($('amountMmk')?.value);
    const preview = this.calculateMmkDepositFeePreviewClient(amount);
    if ($('mmkDepositPreviewGross')) {
      $('mmkDepositPreviewGross').textContent = preview ? `${preview.amount_mmk.toLocaleString()} MMK` : '—';
    }
    if ($('mmkDepositPreviewFee')) {
      $('mmkDepositPreviewFee').textContent = preview ? preview.fee_label : '—';
    }
    if ($('mmkDepositPreviewNet')) {
      $('mmkDepositPreviewNet').textContent = preview
        ? (preview.invalid_net ? 'Invalid' : `${preview.net_mmk.toLocaleString()} MMK`)
        : '—';
    }
  },

  bindUsdtDepositForms() {
    $('usdtNetwork')?.addEventListener('change', () => {
      const net = $('usdtNetwork').value;
      const addr = net === 'BEP20'
        ? this.usdtAddresses?.usdt_bep20_address
        : this.usdtAddresses?.usdt_trc20_address;
      if (addr && !$('usdtAddressBox')?.classList.contains('hidden')) {
        this.showUsdtDepositAddress(net, addr);
      }
    });

    $('usdtAmount')?.addEventListener('input', () => this.updateUsdtDepositFeePreview());
    $('amountMmk')?.addEventListener('input', () => this.updateMmkDepositFeePreview());
    this.updateUsdtDepositFeePreview();
    this.updateMmkDepositFeePreview();

    const setUsdtDepositMode = (mode) => {
      this._usdtDepositMode = mode === 'binance' ? 'binance' : 'direct';
      const binance = this._usdtDepositMode === 'binance';
      $('btnUsdtDepositDirect')?.classList.toggle('is-active', !binance);
      $('btnUsdtDepositBinance')?.classList.toggle('is-active', binance);
      $('usdtNetwork')?.closest('.field')?.classList.toggle('hidden', binance);
      $('btnSubmitUsdtDeposit')?.classList.toggle('hidden', binance);
      $('btnCreateBinancePay')?.classList.toggle('hidden', !binance);
      if (!binance) $('binancePayBox')?.classList.add('hidden');
    };
    $('btnUsdtDepositDirect')?.addEventListener('click', () => setUsdtDepositMode('direct'));
    $('btnUsdtDepositBinance')?.addEventListener('click', () => setUsdtDepositMode('binance'));
    setUsdtDepositMode('direct');

    $('btnCreateBinancePay')?.addEventListener('click', async () => {
      try {
        const amountUsdt = parseFloat($('usdtAmount')?.value);
        if (!Number.isFinite(amountUsdt) || amountUsdt <= 0) {
          this.toast('Enter a valid USDT amount', 'error');
          return;
        }
        const btn = $('btnCreateBinancePay');
        const prev = btn?.textContent;
        if (btn) {
          btn.disabled = true;
          btn.textContent = 'Creating…';
        }
        const data = await Auth.api('POST', '/api/deposit/create', {
          amount_usdt: amountUsdt,
          terminalType: 'WEB',
        }, { sensitive: true });

        $('binancePayBox')?.classList.remove('hidden');
        if ($('binancePayRef')) {
          $('binancePayRef').textContent = data.deposit?.ref_code || data.binance?.merchant_trade_no || '—';
        }
        if ($('binancePayStatus')) {
          $('binancePayStatus').textContent = data.message
            || `Pay $${amountUsdt.toFixed(2)} — net $${Number(data.fee_breakdown?.net_usdt || 0).toFixed(2)} credited after success.`;
        }
        const checkout = data.checkout_url || data.binance?.checkout_url;
        const qr = data.qrcode_link || data.binance?.qrcode_link;
        const qrImg = $('binancePayQrImg');
        if (qrImg) {
          // Prefer Binance-hosted QR image; fall back to our /api/qr of the checkout URL
          const qrSrc = qr || (checkout ? `/api/qr?size=200&data=${encodeURIComponent(checkout)}` : '');
          if (qrSrc) {
            qrImg.src = qrSrc;
            qrImg.classList.remove('hidden');
            qrImg.onerror = () => {
              if (checkout && qrImg.src !== `/api/qr?size=200&data=${encodeURIComponent(checkout)}`) {
                qrImg.src = `/api/qr?size=200&data=${encodeURIComponent(checkout)}`;
              }
            };
          } else {
            qrImg.classList.add('hidden');
            qrImg.removeAttribute('src');
          }
        }
        if ($('binancePayCheckoutLink')) {
          if (checkout) {
            $('binancePayCheckoutLink').href = checkout;
            $('binancePayCheckoutLink').classList.remove('hidden');
          } else {
            $('binancePayCheckoutLink').classList.add('hidden');
          }
        }
        if ($('binancePayQrLink')) {
          if (qr || checkout) {
            $('binancePayQrLink').href = qr || checkout;
            $('binancePayQrLink').classList.remove('hidden');
          } else {
            $('binancePayQrLink').classList.add('hidden');
          }
        }
        this.toast('Binance Pay order created', 'ok');
        this.loadDepositHistory();
        if (btn) {
          btn.disabled = false;
          btn.textContent = prev || 'Pay with Binance Pay';
        }
      } catch (err) {
        if (err.code === 'SENSITIVE_AUTH_REQUIRED') $('pinUnlockModal')?.classList.remove('hidden');
        this.toast(err.message || 'Binance Pay create failed', 'error');
        const btn = $('btnCreateBinancePay');
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Pay with Binance Pay';
        }
      }
    });

    $('usdtDepositForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (this._usdtDepositMode === 'binance') {
        $('btnCreateBinancePay')?.click();
        return;
      }
      try {
        const network = $('usdtNetwork').value;
        const amountUsdt = parseFloat($('usdtAmount').value);
        const body = {
          deposit_type: 'usdt',
          amount_usdt: amountUsdt,
          network,
          deposit_channel: 'platform_direct',
        };

        const data = await Auth.api('POST', '/api/deposit/request', body, { sensitive: true });

        const addr = data.payment_instructions?.deposit_address;
        this.showUsdtDepositAddress(network, addr);
        if ($('usdtRefCodeDisplay')) $('usdtRefCodeDisplay').textContent = data.deposit.ref_code;
        if ($('usdtActiveDepositId')) $('usdtActiveDepositId').value = data.deposit.id;
        if ($('usdtDepositStatus')) {
          const feeNote = data.fee_breakdown
            ? ` Fee $${Number(data.fee_breakdown.fee_usdt).toFixed(2)} → net $${Number(data.fee_breakdown.net_usdt).toFixed(2)} credited after approval.`
            : '';
          $('usdtDepositStatus').textContent = (data.payment_instructions?.message || 'Send USDT, then submit TxHash below.') + feeNote;
        }
        $('usdtDepositSubmitForm')?.classList.remove('hidden');
        this.toast(data.message || `USDT deposit request: ${data.deposit.ref_code}`, 'ok');
        this.loadDepositHistory();
      } catch (err) {
        if (err.code === 'SENSITIVE_AUTH_REQUIRED') $('pinUnlockModal').classList.remove('hidden');
        this.toast(err.message || 'USDT deposit request failed', 'error');
      }
    });

    $('usdtDepositSubmitForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const hash = $('usdtTxnHash')?.value?.trim();
      if (!hash) {
        this.toast('Please enter your TxHash / Transaction ID', 'error');
        $('usdtTxnHash')?.focus();
        return;
      }
      if (!$('usdtActiveDepositId')?.value) {
        this.toast('Generate a deposit request first', 'error');
        return;
      }
      try {
        const body = {
          deposit_id: parseInt($('usdtActiveDepositId').value, 10),
          tx_hash: hash,
          txn_id: hash,
        };
        if ($('usdtDepositNote')?.value?.trim()) {
          body.user_note = $('usdtDepositNote').value.trim();
        }

        const data = await Auth.api('POST', '/api/deposit/submit', body, { sensitive: true });

        if (data.pending_p2p || (data.pending && data.deposit?.is_p2p)) {
          this.resetUsdtDepositForm();
          this.toast(data.message || 'P2P deposit submitted — pending merchant/admin verification.', 'ok');
          this.log('P2P USDT deposit pending verification', 'ok');
          this.loadDepositHistory();
          this.loadTransactions();
          if (typeof AppNav !== 'undefined') AppNav.navigate('deposits', { pushHash: true });
          return;
        }

        if (data.auto_verified) {
          this.resetUsdtDepositForm();
          this.toast(data.message || 'USDT Deposit Approved Successfully!', 'ok');
          this.log('USDT deposit auto-verified on blockchain', 'ok');
          this.loadWallet();
          this.loadDepositHistory();
          this.loadTransactions();
          if (typeof AppNav !== 'undefined') AppNav.navigate('deposits', { pushHash: true });
          return;
        }

        if (data.pending) {
          this.toast(data.message || 'Transaction pending on blockchain or invalid TxHash.', 'error');
          this.log(data.message || 'USDT deposit pending on-chain', 'warn');
          this.loadDepositHistory();
          return;
        }

        this.resetUsdtDepositForm();
        await this.onPaymentProofSubmitted(
          data.message || 'USDT Deposit Submitted Successfully!'
        );
      } catch (err) {
        if (err.code === 'SENSITIVE_AUTH_REQUIRED') $('pinUnlockModal').classList.remove('hidden');
        this.toast(err.message || 'Failed to submit USDT proof', 'error');
      }
    });

    $('btnCopyUsdtAddress')?.addEventListener('click', async () => {
      const addr = this._usdtDepositAddress || $('usdtDepositAddress')?.textContent?.trim();
      if (!addr || addr === '—') return;
      await this.copyToClipboard(addr);
      this.copyToast('Address copied to clipboard!');
    });
  },

  resetWalletDepositForm() {
    $('depositForm')?.reset();
    $('depositSubmitForm')?.reset();
    $('refCodeBox')?.classList.add('hidden');
    $('depositSubmitForm')?.classList.add('hidden');
    const receipt = $('depositReceiptSummary');
    if (receipt) {
      receipt.classList.add('hidden');
      receipt.innerHTML = '';
    }
    const status = $('depositStatus');
    if (status) {
      status.textContent = 'Send payment, then submit transaction ID below.';
      status.className = 'status-line';
    }
    if ($('activeDepositId')) $('activeDepositId').value = '';
    this.clearDepositScreenshotPreview();
    this.hideDebugOutput('depositOutput');
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  },

  resetReloadModalForm() {
    $('reloadCardForm')?.reset();
    $('reloadProofForm')?.reset();
    $('reloadRefBox')?.classList.add('hidden');
    $('reloadProofForm')?.classList.add('hidden');
    const status = $('reloadStatus');
    if (status) {
      status.textContent = 'Send payment, then submit proof below.';
      status.className = 'status-line';
    }
    if ($('reloadActiveDepositId')) $('reloadActiveDepositId').value = '';
    this.clearReloadScreenshotPreview();
    this.hideDebugOutput('reloadOutput');
    this.updateReloadPreview();
    if (this.reloadPollTimer) {
      clearInterval(this.reloadPollTimer);
      this.reloadPollTimer = null;
    }
  },

  async onPaymentProofSubmitted(message = 'Payment Proof Submitted Successfully!') {
    this.toast(message, 'ok');
    this.log('Payment proof submitted — pending admin approval', 'ok');
    await this.loadDepositHistory();
    this.loadTransactions();
    if (typeof AppNav !== 'undefined') {
      AppNav.navigate('deposits', { pushHash: true });
    }
    requestAnimationFrame(() => {
      $('depositHistoryTable')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  },

  async copyToClipboard(text) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  },

  formatCardNumber(raw) {
    const digits = String(raw || '').replace(/\s/g, '');
    return digits.replace(/(.{4})/g, '$1 ').trim();
  },

  formatAllCardDetails(card) {
    const number = this.formatCardNumber(card.card_number);
    return [
      `Card Number: ${number}`,
      `Expiry: ${card.exp_date}`,
      `CVV: ${card.cvv}`,
    ].join('\n');
  },

  bindCardCopyButtons() {
    $('btnCopyCardNumber').onclick = async () => {
      if (!this.currentCard) return;
      const raw = String(this.currentCard.card_number).replace(/\s/g, '');
      await this.copyToClipboard(raw);
      this.copyToast('Copied to clipboard!');
      this.log('Card number copied', 'ok');
    };

    $('btnCopyExp').onclick = async () => {
      if (!this.currentCard) return;
      await this.copyToClipboard(this.currentCard.exp_date);
      this.copyToast('Copied to clipboard!');
      this.log('Expiry date copied', 'ok');
    };

    $('btnCopyCvv').onclick = async () => {
      if (!this.currentCard) return;
      await this.copyToClipboard(this.currentCard.cvv);
      this.copyToast('Copied to clipboard!');
      this.log('CVV copied', 'ok');
    };

    $('btnCopyAllCard').onclick = async () => {
      if (!this.currentCard) return;
      await this.copyToClipboard(this.formatAllCardDetails(this.currentCard));
      this.copyToast('Copied to clipboard!');
      this.log('All card details copied', 'ok');
    };
  },

  bindCardSelector() {
    $('cardSelect').onchange = () => {
      const idx = parseInt($('cardSelect').value, 10);
      if (!Number.isNaN(idx)) this.selectCard(idx);
    };

    $('btnPrevCard').onclick = () => {
      if (!this.allCards.length) return;
      const next = (this.activeCardIndex - 1 + this.allCards.length) % this.allCards.length;
      this.selectCard(next);
    };

    $('btnNextCard').onclick = () => {
      if (!this.allCards.length) return;
      const next = (this.activeCardIndex + 1) % this.allCards.length;
      this.selectCard(next);
    };
  },

  cardThumbLabel(card) {
    if (this.isCardPending(card)) return typeof t === 'function' ? t('pending') : 'Pending';
    return `•••• ${card.last4 || '????'}`;
  },

  cardStatusLabel(card) {
    if (!card) return '—';
    const map = {
      pending: typeof t === 'function' ? t('pending_issuance') : 'PENDING_ISSUANCE',
      active: typeof t === 'function' ? t('active') : 'ACTIVE',
      suspended: typeof t === 'function' ? t('suspended') : 'SUSPENDED',
      frozen: typeof t === 'function' ? t('frozen') : 'FROZEN',
      terminated: typeof t === 'function' ? t('terminated') : 'TERMINATED',
    };
    return map[this.resolveCardStatus(card)] || String(card.status || '—').toUpperCase();
  },

  cardDetailsRevealed: false,

  toggleCardDetails() {
    const card = this.allCards[this.activeCardIndex];
    if (!card || !this.isCardActive(card)) return;
    this.cardDetailsRevealed = !this.cardDetailsRevealed;
    this.renderActiveCard(card);
  },

  renderCardSelector() {
    const section = $('cardSelectorSection');
    const thumbs = $('cardThumbnails');
    const select = $('cardSelect');

    if (!this.allCards.length) {
      section.classList.add('hidden');
      return;
    }

    section.classList.remove('hidden');
    $('cardIndexLabel').textContent = `${this.activeCardIndex + 1} / ${this.allCards.length}`;

    select.innerHTML = this.allCards.map((c, i) =>
      `<option value="${i}" ${i === this.activeCardIndex ? 'selected' : ''}>${c.label}</option>`
    ).join('');

    thumbs.innerHTML = this.allCards.map((c, i) => {
      const pending = this.isCardPending(c);
      const active = this.isCardActive(c);
      const pillCls = this.cardStatusPillClass(c);
      return `
      <button type="button" class="card-thumb ${pending ? 'pending' : ''} ${active ? 'is-live' : ''} ${pillCls ? `status-${pillCls}` : ''} ${i === this.activeCardIndex ? 'active' : ''}"
        data-index="${i}" role="tab" aria-selected="${i === this.activeCardIndex}">
        <span class="card-thumb-brand">EISY MYANMAR</span>
        <span class="card-thumb-number">${this.cardThumbLabel(c)}</span>
        <span class="card-thumb-meta">
          <span class="card-status-pill ${pillCls}">${this.cardStatusLabel(c)}</span>
        </span>
      </button>`;
    }).join('');

    thumbs.querySelectorAll('.card-thumb').forEach((btn) => {
      btn.onclick = () => this.selectCard(parseInt(btn.dataset.index, 10));
    });

    $('btnPrevCard').disabled = this.allCards.length <= 1;
    $('btnNextCard').disabled = this.allCards.length <= 1;
  },

  selectCard(index, { forceRevealReset = false } = {}) {
    if (!this.allCards.length || index < 0 || index >= this.allCards.length) return;
    const changed = index !== this.activeCardIndex;
    this.activeCardIndex = index;
    if (changed || forceRevealReset) this.cardDetailsRevealed = false;
    this.renderCardSelector();
    this.renderActiveCard(this.allCards[index]);
  },

  updateCardStatusSummary(card) {
    const statusEl = $('sumCardStatus');
    if (!statusEl) return;
    if (!card) {
      statusEl.textContent = '—';
      statusEl.className = 'value';
      return;
    }
    const label = this.cardStatusLabel(card);
    const pillCls = this.cardStatusPillClass(card);
    statusEl.textContent = label;
    statusEl.className = `value card-status-pill ${pillCls}`;
  },

  renderActiveCard(card) {
    const pending = this.isCardPending(card);
    const active = this.isCardActive(card);
    const restricted = this.isCardRestricted(card);
    const terminated = this.isCardTerminated(card);
    this.currentCard = pending ? null : card;

    const pillCls = this.cardStatusPillClass(card);
    const canRevealDetails = active && Boolean(card?.card_number);
    const showDetails = canRevealDetails && this.cardDetailsRevealed;

    $('cardDetailsTitle').textContent = card ? `— ${card.label}` : '';
    $('visCardStatus').textContent = this.cardStatusLabel(card);
    $('visCardStatus').className = `card-status-pill ${pillCls}`;

    const statusDisplay = $('cardStatusDisplay');
    if (statusDisplay) {
      statusDisplay.textContent = card ? this.cardStatusLabel(card) : '—';
      statusDisplay.className = `card-status-pill ${pillCls}`;
    }
    const last4Display = $('cardLast4Display');
    if (last4Display) {
      last4Display.textContent = card
        ? (pending ? 'Awaiting issuance' : `•••• ${card.last4 || '????'}`)
        : '—';
    }

    const balanceDisplay = $('cardBalanceDisplay');
    if (balanceDisplay) {
      if (!card || pending) {
        balanceDisplay.textContent = pending ? 'Balance pending' : '—';
      } else if (card.balance_usd != null && Number.isFinite(Number(card.balance_usd))) {
        balanceDisplay.textContent = `$${Number(card.balance_usd).toFixed(2)} USD`;
      } else {
        balanceDisplay.textContent = '$0.00 USD';
      }
    }

    const showBtn = $('btnShowCardDetails');
    if (showBtn) {
      showBtn.disabled = !canRevealDetails;
      showBtn.textContent = showDetails ? 'Hide Card Details' : 'Show Card Details';
    }

    const reloadBtn = $('btnReloadSelectedCard');
    if (reloadBtn) reloadBtn.disabled = !active;

    const alertEl = $('cardStatusAlert');
    const alertMsg = card ? this.cardStatusAlertMessage(card) : '';
    if (alertEl) {
      if (alertMsg) {
        alertEl.textContent = alertMsg;
        alertEl.className = `card-status-alert ${pillCls}`;
        alertEl.classList.remove('hidden');
        if (card.status_reason) {
          alertEl.textContent = `${alertMsg} (${card.status_reason})`;
        }
      } else {
        alertEl.textContent = '';
        alertEl.classList.add('hidden');
      }
    }

    if (!card) {
      $('cardVisual').classList.add('hidden');
      $('cardPendingNotice').classList.add('hidden');
      $('sumCard').textContent = '—';
      this.updateCardStatusSummary(null);
      return;
    }

    $('sumCard').textContent = pending ? 'Pending approval' : `•••• ${card.last4 || '????'}`;
    this.updateCardStatusSummary(card);

    if (pending) {
      $('cardVisual').classList.add('hidden');
      $('cardPendingNotice').classList.remove('hidden');
      $('visHolder').textContent = card.card_holder_name || '—';
      return;
    }

    $('cardPendingNotice').classList.add('hidden');
    const visual = $('cardVisual');
    if (visual) {
      visual.classList.remove('hidden');
      visual.className = `card-visual ${pillCls}${terminated ? ' card-visual-terminated' : ''}${restricted ? ' card-visual-restricted' : ''}`;
    }

    if (showDetails) {
      $('visNumber').textContent = this.formatCardNumber(card.card_number);
      $('visExp').textContent = card.exp_date;
      $('visCvv').textContent = card.cvv;
    } else {
      $('visNumber').textContent = `**** **** **** ${card.last4 || '****'}`;
      $('visExp').textContent = '**/**';
      $('visCvv').textContent = '***';
    }
    $('visHolder').textContent = card.card_holder_name || '—';

    const copyDisabled = !showDetails;
    ['btnCopyCardNumber', 'btnCopyExp', 'btnCopyCvv', 'btnCopyAllCard'].forEach((id) => {
      const el = $(id);
      if (el) el.disabled = copyDisabled;
    });
  },

  setInlineError(id, message) {
    const el = $(id);
    if (!el) return;
    if (message) {
      el.textContent = message;
      el.classList.remove('hidden');
    } else {
      el.textContent = '';
      el.classList.add('hidden');
    }
  },

  bindAuthForms() {
    const authTabs = $('authTabs');
    if (!authTabs) {
      console.warn('[Dashboard] #authTabs missing — auth UI not bound');
      return;
    }

    authTabs.querySelectorAll('.tab').forEach((tab) => {
      tab.onclick = () => {
        authTabs.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        $('panelLogin').classList.toggle('hidden', tab.dataset.tab !== 'login');
        $('panelRegister').classList.toggle('hidden', tab.dataset.tab !== 'register');
        this.hideDevOtp();
      };
    });

    const loginPinForm = $('loginPinForm');
    if (loginPinForm) {
      loginPinForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = $('loginEmail')?.value.trim();
        const pin = $('loginPin')?.value.trim();
        if (!email || !pin) {
          this.toast('Email and PIN are required', 'error');
          return;
        }
        const btn = $('loginPinBtn');
        if (btn) btn.disabled = true;
        try {
          await Auth.loginWithPin(email, pin);
          this.log('Logged in with PIN', 'ok');
          $('pinUnlockModal')?.classList.add('hidden');
          this.refreshAuthUI();
        } catch (err) {
          this.toast(err.message || 'PIN login failed', 'error');
          this.log(err.message, 'error');
        } finally {
          if (btn) btn.disabled = false;
        }
      });
    }

    const loginSendOtpForm = $('loginSendOtpForm');
    if (loginSendOtpForm) {
      loginSendOtpForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        this.setInlineError('regAuthError', null);
        const email = $('loginEmail').value.trim();
        if (!email) {
          this.toast('Please enter your email address', 'error');
          return;
        }
        const btn = $('loginSendOtp');
        if (btn) btn.disabled = true;
        try {
          const data = await Auth.sendLoginOtp(email);
          $('loginVerifyForm')?.classList.remove('hidden');
          this.showDevOtp(data, 'loginOtp');
          this.toast('Login OTP sent!', 'ok', data.dev_otp || null);
          this.log(`OTP sent to ${email}`, 'ok');
          $('loginOtp')?.focus();
        } catch (err) {
          this.toast(err.message || 'Failed to send OTP', 'error');
          this.log(err.message, 'error');
        } finally {
          if (btn) btn.disabled = false;
        }
      });
    }

    const loginVerifyForm = $('loginVerifyForm');
    if (loginVerifyForm) {
      loginVerifyForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          await Auth.verifyLoginOtp($('loginEmail').value.trim(), $('loginOtp').value.trim());
          this.log('Logged in successfully', 'ok');
          if (Auth.needsPinUnlock()) {
            $('pinUnlockModal')?.classList.remove('hidden');
          }
          this.refreshAuthUI();
        } catch (err) {
          this.log(err.message, 'error');
        }
      });
    }

    const bioLoginBtn = $('bioLoginBtn');
    if (bioLoginBtn) {
      bioLoginBtn.onclick = async () => {
        try {
          await Auth.biometricLogin($('loginEmail')?.value.trim());
          this.log('Biometric login successful', 'ok');
          $('pinUnlockModal')?.classList.add('hidden');
          this.refreshAuthUI();
        } catch (err) {
          this.log(err.message, 'error');
          this.toast(err.message || 'Biometric login failed', 'error');
        }
      };
    }

    const registerSendOtpForm = $('registerSendOtpForm');
    if (registerSendOtpForm) {
      registerSendOtpForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        this.setInlineError('regAuthError', null);
        const email = $('regEmail').value.trim();
        const pin = $('regPin').value.trim();

        if (!email) {
          this.toast('Please enter an email address to register', 'error');
          this.setInlineError('regAuthError', 'Email is required.');
          return;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          this.toast('Please enter a valid email address', 'error');
          this.setInlineError('regAuthError', 'Invalid email format.');
          return;
        }
        if (pin && !/^\d{6}$/.test(pin)) {
          this.toast('PIN must be exactly 6 digits', 'error');
          this.setInlineError('regAuthError', 'PIN must be 6 digits (or leave blank and set later).');
          return;
        }

        const btn = $('registerSendOtp');
        if (btn) {
          btn.disabled = true;
          btn.textContent = 'Sending…';
        }
        try {
          const data = await Auth.sendRegisterOtp(email);
          $('registerCompleteForm')?.classList.remove('hidden');
          this.showDevOtp(data, 'regOtp');
          const otp = data.dev_otp;
          if (otp) {
            this.toast('Registration OTP — use this code:', 'ok', otp);
          } else {
            this.toast('Registration OTP sent! Check server console.', 'ok');
          }
          this.log(`Registration OTP sent to ${email}`, 'ok');
          $('regOtp')?.focus();
        } catch (err) {
          const msg = err.message || 'Failed to send registration OTP';
          this.toast(msg, 'error');
          this.setInlineError('regAuthError', msg);
          if (msg.includes('already registered')) {
            this.setInlineError('regAuthError', `${msg} — switch to Login tab instead.`);
          }
          this.log(msg, 'error');
        } finally {
          if (btn) {
            btn.disabled = false;
            btn.textContent = 'Send Registration OTP';
          }
        }
      });
    }

    const registerCompleteForm = $('registerCompleteForm');
    if (registerCompleteForm) {
      registerCompleteForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          await Auth.completeRegister({
            email: $('regEmail').value.trim(),
            otp: $('regOtp').value.trim(),
            name: $('regName').value.trim(),
            phone: $('regPhone').value.trim() || undefined,
            pin: $('regPin').value.trim(),
          });
          this.log('Account created and logged in', 'ok');
          this.refreshAuthUI();
        } catch (err) {
          this.log(err.message, 'error');
        }
      });
    }

    const pinSetupForm = $('pinSetupForm');
    if (pinSetupForm) {
      pinSetupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          await Auth.setPin($('setupPin').value.trim());
          $('pinSetupModal')?.classList.add('hidden');
          $('pinSetupError').textContent = '';
          this.log('PIN set successfully', 'ok');
          this.refreshAuthUI();
        } catch (err) {
          $('pinSetupError').textContent = err.message;
        }
      });
    }

    const pinUnlockForm = $('pinUnlockForm');
    if (pinUnlockForm) {
      pinUnlockForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          await Auth.verifyPin($('unlockPin').value.trim());
          $('pinUnlockModal')?.classList.add('hidden');
          $('pinUnlockError').textContent = '';
          if ($('unlockPin')) $('unlockPin').value = '';
          this.log('PIN verified — sensitive access unlocked', 'ok');
          this.refreshAuthUI();
          this.loadWallet();
          this.loadAllCards();
        } catch (err) {
          $('pinUnlockError').textContent = err.message;
        }
      });
    }

    const pinResetDefaultBtn = $('pinResetDefaultBtn');
    if (pinResetDefaultBtn) {
      pinResetDefaultBtn.onclick = async () => {
        try {
          pinResetDefaultBtn.disabled = true;
          const data = await Auth.resetPinToDefault();
          if ($('unlockPin')) $('unlockPin').value = '123456';
          $('pinUnlockModal')?.classList.add('hidden');
          $('pinUnlockError').textContent = '';
          this.toast(data.message || 'PIN reset to 123456 — unlocked', 'ok');
          this.log('PIN reset to default test PIN (123456)', 'ok');
          this.refreshAuthUI();
          this.loadWallet();
          this.loadAllCards();
        } catch (err) {
          $('pinUnlockError').textContent = err.message;
          this.toast(err.message || 'Failed to reset PIN', 'error');
        } finally {
          pinResetDefaultBtn.disabled = false;
        }
      };
    }

    const registerBioBtn = $('registerBioBtn');
    if (registerBioBtn) {
      registerBioBtn.onclick = async () => {
        try {
          await Auth.registerBiometrics();
          if (Auth.user?.email) {
            Auth.saveDeviceProfile({ email: Auth.user.email, biometricsEnabled: true });
          }
          Auth.initLoginPanel();
          this.log('Biometrics registered for this device', 'ok');
        } catch (err) {
          this.log(err.message, 'error');
        }
      };
    }

    const logoutBtn = $('logoutBtn');
    if (logoutBtn) {
      logoutBtn.onclick = async () => {
        await Auth.logout();
        Auth.initLoginPanel();
        this.log('Logged out', 'ok');
        this._navInitialized = false;
        history.replaceState(null, '', window.location.pathname + window.location.search);
        this.refreshAuthUI();
      };
    }

    const unlockBtn = $('unlockBtn');
    if (unlockBtn) unlockBtn.onclick = () => $('pinUnlockModal')?.classList.remove('hidden');
    $('unlockBtnSettings')?.addEventListener('click', () => $('pinUnlockModal')?.classList.remove('hidden'));
    $('registerBioBtnSettings')?.addEventListener('click', () => $('registerBioBtn')?.click());
    $('logoutBtnSettings')?.addEventListener('click', () => $('logoutBtn')?.click());
  },

  validatePasswordClient(newPassword, confirmPassword, currentPassword, hasPassword) {
    const next = String(newPassword || '');
    const confirm = String(confirmPassword || '');
    const current = String(currentPassword || '');
    if (hasPassword && !current) {
      return 'Current password is required';
    }
    if (next.length < 6) {
      return 'Password must be at least 6 characters';
    }
    if (next.length > 128) {
      return 'Password must be at most 128 characters';
    }
    if (next !== confirm) {
      return 'New password and confirmation do not match';
    }
    return null;
  },

  updateChangePasswordUI() {
    const hint = $('changePasswordHint');
    const currentField = $('currentPassword');
    if (!hint || !currentField) return;
    const hasPassword = Boolean(Auth.user?.has_password);
    hint.textContent = hasPassword
      ? 'Update your account password (minimum 6 characters).'
      : 'Set your account password (minimum 6 characters). Leave current password blank if you have not set one yet.';
    currentField.required = hasPassword;
  },

  bindChangePasswordForm() {
    const form = $('changePasswordForm');
    if (!form || form.dataset.bound) return;
    form.dataset.bound = '1';
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errEl = $('changePasswordError');
      const submitBtn = $('changePasswordSubmit');
      const currentPassword = $('currentPassword')?.value || '';
      const newPassword = $('newPassword')?.value || '';
      const confirmPassword = $('confirmPassword')?.value || '';
      const hasPassword = Boolean(Auth.user?.has_password);

      const clientErr = this.validatePasswordClient(newPassword, confirmPassword, currentPassword, hasPassword);
      if (clientErr) {
        if (errEl) {
          errEl.textContent = clientErr;
          errEl.classList.remove('hidden');
        }
        this.toast(clientErr, 'error');
        return;
      }
      if (errEl) {
        errEl.textContent = '';
        errEl.classList.add('hidden');
      }

      if (submitBtn) submitBtn.disabled = true;
      try {
        const data = await Auth.changePassword({
          currentPassword,
          newPassword,
          confirmPassword,
        });
        form.reset();
        this.toast(data.message || 'Password updated successfully', 'ok');
        this.log('Account password updated', 'ok');
        if (Auth.user) {
          Auth.setSession({
            sessionToken: Auth.sessionToken,
            user: { ...Auth.user, has_password: true },
            pinToken: Auth.pinToken,
          });
        }
        this.updateChangePasswordUI();
      } catch (err) {
        if (errEl) {
          errEl.textContent = err.message;
          errEl.classList.remove('hidden');
        }
        this.toast(err.message || 'Failed to update password', 'error');
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  },

  showDevOtp(data, inputId) {
    const otp = data?.dev_otp;
    console.log('[Dashboard] showDevOtp', { otp, inputId, data });
    if (!otp) {
      console.warn('[Dashboard] No dev_otp in response — check DEV_SHOW_OTP env');
      return;
    }
    $('devOtpCode').textContent = otp;
    $('devOtpHint').textContent = data.dev_message || 'Auto-filled for testing';
    $('devOtpBanner').classList.remove('hidden');
    const input = $(inputId);
    if (input) {
      input.value = otp;
      input.focus();
    }
  },

  hideDevOtp() {
    $('devOtpBanner').classList.add('hidden');
  },

  bindDashboardForms() {
    const cardInitialLoad = $('cardInitialLoad');
    if (cardInitialLoad) {
      cardInitialLoad.addEventListener('input', () => this.updateCardPricingBreakdown());
    }
    $('cardPaymentMethod')?.addEventListener('change', () => {
      this.updateCardPricingBreakdown();
      this.updateCardWalletHint();
    });

    const cardRequestForm = $('cardRequestForm');
    if (cardRequestForm) {
      cardRequestForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          const initialLoad = parseFloat($('cardInitialLoad').value);
          const method = $('cardPaymentMethod').value;
          const payFromWallet = this.isWalletPaymentMethod(method);
          const walletType = this.getWalletTypeFromMethod(method);

          if (payFromWallet && walletType === 'mmk') {
            const required = this.cardPricing?.total_mmk ?? 0;
            if (Number(this.walletMmk ?? 0) < required) {
              this.toast(`Insufficient MMK wallet. Need ${this.formatMmk(required)}. Top up first.`, 'error');
              if (typeof AppNav !== 'undefined') AppNav.navigate('deposits', { pushHash: true });
              return;
            }
          }
          if (payFromWallet && walletType === 'usdt') {
            const required = this.cardPricing?.total_usdt ?? this.cardPricing?.total_usd_required ?? 0;
            if (Number(this.walletUsdt ?? 0) < required) {
              this.toast(`Insufficient USDT wallet. Need ${this.formatUsdt(required)}. Top up first.`, 'error');
              if (typeof AppNav !== 'undefined') AppNav.navigate('deposits', { pushHash: true, depositTab: 'usdt' });
              return;
            }
          }

          const body = {
            card_holder_name: $('holderName').value.trim() || undefined,
            initial_load_usd: initialLoad,
            pay_from_wallet: payFromWallet,
          };
          if (payFromWallet) body.wallet_type = walletType;
          if (!payFromWallet) body.payment_method = method;

          const data = await Auth.api('POST', '/api/user/card/request', body, { sensitive: true });

          if (data.paid_from_wallet) {
            const debited = data.wallet_type === 'usdt'
              ? (data.wallet?.usdt_formatted || this.formatUsdt(data.wallet?.debited_usdt))
              : (data.wallet?.mmk_formatted || this.formatMmk(data.wallet?.debited_mmk));
            this.toast(data.message || t('card_request_submitted'), 'ok');
            this.log(t('card_request_submitted_log', { amount: debited }), 'ok');
            const receipt = $('cardRequestReceipt');
            if (receipt) {
              receipt.classList.remove('hidden');
              receipt.innerHTML = `
                <p class="wallet-pay-hint ok" style="margin:0">
                  ${t('card_request_pending_msg')}
                  ${debited ? `<br><small>${t('card_request_deducted', { amount: debited })}</small>` : ''}
                </p>`;
            }
            $('cardRequestForm')?.reset();
            this.loadWallet();
            this.loadUsdtWalletPage(true);
            this.loadAllCards({ forceRefresh: true });
            this.loadDepositHistory();
            if (typeof AppNav !== 'undefined') AppNav.navigate('cards', { pushHash: true });
            return;
          }

          this.renderCardRequestReceipt(data);
          this.populateDepositFromCardRequest(data);
          this.toast(`New card request created — ref ${data.deposit?.ref_code || ''}`, 'ok');
          this.log('New card request + payment ref generated', 'ok');
          this.loadTransactions();
          this.loadDepositHistory();
          this.loadAllCards({ forceRefresh: true });
          if (typeof AppNav !== 'undefined') AppNav.navigate('deposits', { pushHash: true });
        } catch (err) {
          if (err.code === 'SENSITIVE_AUTH_REQUIRED') $('pinUnlockModal').classList.remove('hidden');
          if (err.code === 'INSUFFICIENT_MMK_BALANCE' || err.code === 'INSUFFICIENT_USDT_BALANCE') {
            this.toast(err.message, 'error');
            if (typeof AppNav !== 'undefined') AppNav.navigate('deposits', { pushHash: true });
            return;
          }
          this.toast(err.message || 'Card request failed', 'error');
          this.log(err.message, 'error');
        }
      });
    }

    $('issueCardForm').onsubmit = async (e) => {
      e.preventDefault();
      try {
        const data = await Auth.api('POST', '/api/admin/issue-card', {
          card_number: $('cardNumber').value.trim(),
          exp_date: $('expDate').value.trim(),
          cvv: $('cvv').value.trim(),
          card_holder_name: $('holderName').value.trim(),
        }, { sensitive: true });
        showOutput('issueCardOutput', data);
        this.log('Card issued/updated', 'ok');
        this.loadWallet();
        this.loadAllCards();
      } catch (err) {
        if (err.code === 'SENSITIVE_AUTH_REQUIRED') $('pinUnlockModal').classList.remove('hidden');
        showOutput('issueCardOutput', err.message, true);
        this.log(err.message, 'error');
      }
    };

    $('btnLoadCard').onclick = () => this.loadAllCards({ forceRefresh: true });
    $('btnShowCardDetails')?.addEventListener('click', () => this.toggleCardDetails());

    $('depositForm').onsubmit = async (e) => {
      e.preventDefault();
      try {
        const methodId = $('paymentMethod')?.value;
        if (!methodId) {
          this.toast('Select a bank payment method', 'error');
          return;
        }
        const data = await Auth.api('POST', '/api/deposit/request', {
          deposit_type: 'mmk',
          amount_mmk: parseFloat($('amountMmk').value),
          payment_method_id: parseInt(methodId, 10),
        }, { sensitive: true });
        $('refCodeBox').classList.remove('hidden');
        $('refCodeDisplay').textContent = data.deposit.ref_code;
        if ($('verifyRef')) $('verifyRef').value = data.deposit.ref_code;
        if ($('verifyAmount')) $('verifyAmount').value = data.deposit.amount_mmk;
        $('activeDepositId').value = data.deposit.id;
        $('depositSubmitForm').classList.remove('hidden');
        this.clearDepositScreenshotPreview();
        this.renderDepositReceiptSummary(data.deposit, data.pricing_breakdown);
        this.renderMmkPaymentDetails(data.payment_method || data.payment_instructions);
        const bank = data.payment_instructions?.bank_name || data.payment_method?.bank_name || 'bank';
        $('depositStatus').textContent = `Send payment to ${bank}, include ref ${data.deposit.ref_code}, then submit your transaction ID.`;
        this.toast(`Ref code generated: ${data.deposit.ref_code}`, 'ok');
        this.startPolling(data.deposit.ref_code);
        this.log(`Deposit requested: ${data.deposit.ref_code}`, 'ok');
        this.loadTransactions();
        this.loadDepositHistory();
      } catch (err) {
        if (err.code === 'SENSITIVE_AUTH_REQUIRED') $('pinUnlockModal').classList.remove('hidden');
        this.toast(err.message || 'Deposit request failed', 'error');
      }
    };

    $('depositSubmitForm').onsubmit = async (e) => {
      e.preventDefault();
      try {
        await this.submitDepositProof({
          depositId: $('activeDepositId').value,
          txnId: $('depositTxnId').value.trim(),
          userNote: $('depositNote').value.trim(),
          fileInput: $('depositScreenshot'),
          base64: this._depositReceiptBase64,
          filename: this._depositReceiptFile?.name || 'receipt.jpg',
          requireReceipt: true,
        });
        this.resetWalletDepositForm();
        await this.onPaymentProofSubmitted('Payment Proof Submitted Successfully!');
      } catch (err) {
        if (err.code === 'SENSITIVE_AUTH_REQUIRED') $('pinUnlockModal').classList.remove('hidden');
        this.toast(err.message || 'Failed to submit payment proof', 'error');
        this.log(err.message, 'error');
      }
    };

    $('depositScreenshot').onchange = () => this.previewDepositScreenshot();
    $('btnClearScreenshot').onclick = () => this.clearDepositScreenshotPreview();
    $('btnExpandProofPreview').onclick = () => {
      if (!this._proofPreviewUrl || !this._proofPreviewType) return;
      this.openProofLightbox(this._proofPreviewUrl, this._proofPreviewName, this._proofPreviewType);
    };

    $('verifyForm').onsubmit = async (e) => {
      e.preventDefault();
      try {
        const secret = localStorage.getItem('deposit_listener_secret');
        const adminKey = localStorage.getItem('adminKey') || localStorage.getItem('admin_api_key');
        const res = await fetch('/api/deposit/verify', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(secret
              ? { 'X-Deposit-Listener-Secret': secret }
              : (adminKey ? { 'X-Admin-Key': adminKey } : {})),
          },
          body: JSON.stringify({
            ref_code: $('verifyRef').value.trim(),
            amount: parseFloat($('verifyAmount').value),
            txn_id: $('verifyTxn').value.trim(),
            sender_phone: $('verifyPhone').value.trim(),
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        showOutput('verifyOutput', data);
        this.log('Deposit verified (listener simulation)', 'ok');
        this.loadWallet();
        this.loadTransactions();
      } catch (err) {
        showOutput('verifyOutput', err.message, true);
      }
    };

    $('btnCopyRef').onclick = () => {
      navigator.clipboard.writeText($('refCodeDisplay').textContent);
      this.log('Ref code copied', 'ok');
    };

    this.bindDepositTabs();
    this.bindUsdtDepositForms();
    this.bindP2pMarket();
    this.bindP2pBuyModal();
    this.bindP2pSellModal();
    this.bindP2pPostAdModal();
    this.bindKycModal();
    this.loadDepositPaymentMethods();

    $('paymentMethod')?.addEventListener('change', () => {
      const id = parseInt($('paymentMethod').value, 10);
      const method = (this._depositPaymentMethods || []).find((m) => Number(m.id) === id);
      this.renderMmkPaymentDetails(method);
    });
    $('btnCopyMmkAccount')?.addEventListener('click', () => {
      const num = $('mmkPayAccountNumber')?.textContent?.trim();
      if (!num || num === '—') return;
      navigator.clipboard.writeText(num).then(() => this.toast('Account number copied', 'ok'));
    });

    $('btnLoadTx')?.addEventListener('click', () => this.loadTransactions());
    $('btnLoadDeposits')?.addEventListener('click', () => this.loadDepositHistory());
    $('btnLoadCardReloads')?.addEventListener('click', () => this.loadReloadHistory());

    $('supportForm').onsubmit = async (e) => {
      e.preventDefault();
      try {
        await Auth.api('POST', '/api/support/threads', {
          subject: $('supportSubject').value.trim() || 'Support request',
          message: $('supportMessage').value.trim(),
        });
        $('supportMessage').value = '';
        this.log('Support ticket created', 'ok');
        this.loadSupportThreads();
      } catch (err) {
        this.log(err.message, 'error');
      }
    };
  },

  refreshAuthUI() {
    const loggedIn = Auth.isLoggedIn();
    const authScreen = $('authScreen');
    const dashboardScreen = $('dashboardScreen');

    if (authScreen) authScreen.classList.toggle('hidden', loggedIn);
    if (dashboardScreen) dashboardScreen.classList.toggle('hidden', !loggedIn);

    if (!loggedIn) {
      this.clearCardsCache();
      this.allCards = [];
      if (window.location.hash && !window.location.hash.startsWith('#admin')) {
        history.replaceState(null, '', window.location.pathname + window.location.search);
      }
      return;
    }

    this.initNavigationIfNeeded();

    if (Auth.user) {
      if ($('headerUser')) $('headerUser').textContent = Auth.user.name || Auth.user.email;
      if ($('headerEmail')) $('headerEmail').textContent = Auth.user.email || '';
      const acctInfo = $('settingsAccountInfo');
      if (acctInfo) {
        acctInfo.textContent = `Signed in as ${Auth.user.name || Auth.user.email} (${Auth.user.email})`;
      }
      if (Auth.needsPinUnlock()) {
        $('pinUnlockModal')?.classList.remove('hidden');
        this.applyCachedCardsIfAvailable();
      } else {
        $('pinUnlockModal')?.classList.add('hidden');
        this.applyCachedCardsIfAvailable();
        this.loadAllCards({ preserveSelection: true, silent: true });
      }
      this.loadWallet();
      this.loadTransactions();
      this.loadDepositHistory();
      this.loadCardPricing();
      this.loadWithdrawalFees();
      this.loadDepositPaymentMethods();
      this.updateHomeRateSummary();
      this.populateReloadCardSelect();
      this.loadKycStatus();
      this.updateChangePasswordUI();
      this.bindSupabaseUserRealtime();

      if (typeof AppNav !== 'undefined' && AppNav.currentPage == null) {
        const hashPage = AppNav.pageFromHash?.();
        AppNav.navigate(hashPage || 'home', { pushHash: !hashPage, replace: true });
      }
    }
  },

  async loadCardPricing() {
    if (!Auth.isLoggedIn()) return;
    try {
      const data = await Auth.api('GET', '/api/user/card/pricing');
      this.cardPricing = data;
      const min = data.minimum_initial_deposit_usd ?? 10;
      const input = $('cardInitialLoad');
      if (input) {
        input.min = min;
        input.placeholder = min.toFixed(2);
        if (!input.value) input.value = min.toFixed(2);
      }
      const hint = $('cardMinDepositHint');
      if (hint) hint.textContent = `Minimum initial deposit: $${min.toFixed(2)}`;
      this.updateCardPricingBreakdown();
      this.updateHomeRateSummary();
      this.renderRatesPage();
      this.updateReloadPreview();
      const minReload = $('reloadMinHint');
      if (minReload && data.minimum_card_reload_mmk) {
        minReload.textContent = `Minimum reload: ${Number(data.minimum_card_reload_mmk).toLocaleString()} MMK`;
      }
      const minUsdtReload = $('reloadMinUsdtHint');
      if (minUsdtReload && data.minimum_usdt_reload) {
        minUsdtReload.textContent = `Minimum reload: $${Number(data.minimum_usdt_reload).toFixed(2)} USDT`;
      }
      const usdtMinHint = $('usdtMinHint');
      if (usdtMinHint && data.minimum_usdt_deposit) {
        usdtMinHint.textContent = `Minimum deposit: $${Number(data.minimum_usdt_deposit).toFixed(2)} USDT`;
      }
      if ($('usdtAmount') && data.minimum_usdt_deposit) {
        $('usdtAmount').min = data.minimum_usdt_deposit;
      }
      const reloadInput = $('reloadAmountMmk');
      if (reloadInput && data.minimum_card_reload_mmk) {
        reloadInput.min = data.minimum_card_reload_mmk;
      }
      const reloadUsdtInput = $('reloadAmountUsdt');
      if (reloadUsdtInput && data.minimum_usdt_reload) {
        reloadUsdtInput.min = data.minimum_usdt_reload;
      }
      this.toggleReloadAmountFields();
      this.loadUsdtAddresses();
    } catch (err) {
      console.warn('[card pricing]', err.message);
    }
  },

  updateCardPricingBreakdown() {
    const p = this.cardPricing;
    if (!p) return;

    const initial = parseFloat($('cardInitialLoad')?.value) || 0;
    const fee = p.card_issuance_fee_usd || 0;
    const rate = p.mmk_to_usd_rate || 4500;
    const totalUsd = initial + fee;
    const totalMmk = Math.ceil(totalUsd * rate);
    const totalUsdt = Math.round(totalUsd * 100) / 100;
    const method = $('cardPaymentMethod')?.value || 'wallet_mmk';
    const isUsdtWallet = method === 'wallet_usdt';

    if ($('pbInitialLoad')) $('pbInitialLoad').textContent = `$${initial.toFixed(2)}`;
    if ($('pbIssuanceFee')) $('pbIssuanceFee').textContent = `$${fee.toFixed(2)}`;
    if ($('pbTotalUsd')) $('pbTotalUsd').textContent = `$${totalUsd.toFixed(2)}`;
    if ($('pbTotalMmk')) $('pbTotalMmk').textContent = `${totalMmk.toLocaleString()} MMK`;
    if ($('pbTotalUsdt')) $('pbTotalUsdt').textContent = `${totalUsdt.toFixed(2)} USDT`;
    if ($('pbMmkRow')) $('pbMmkRow').classList.toggle('hidden', isUsdtWallet);
    if ($('pbUsdtRow')) $('pbUsdtRow').classList.toggle('hidden', !isUsdtWallet);
    if ($('pbRateLabel')) {
      const eff = p.rate_effective_date ? ` (Effective: ${p.rate_effective_date})` : '';
      $('pbRateLabel').textContent = isUsdtWallet
        ? 'USDT wallet: 1 USDT ≈ 1 USD — no MMK exchange rate applied'
        : `${p.rate_label || "Today's Daily Exchange Rate"}: 1 USD = ${rate.toLocaleString()} MMK${eff}`;
    }

    this.cardPricing = {
      ...(this.cardPricing || {}),
      initial_load_usd: initial,
      issuance_fee_usd: fee,
      total_usd_required: totalUsd,
      total_mmk: totalMmk,
      total_usdt: totalUsdt,
      mmk_to_usd_rate: rate,
    };
    this.updateCardWalletHint();
  },

  formatPricingReceiptHtml(breakdown, refCode, extra) {
    if (!breakdown) return '';
    return `
      <h4>${extra?.title || 'Payment Summary'}</h4>
      <div class="pricing-row"><span>Initial Card Load</span><strong>$${Number(breakdown.initial_load_usd).toFixed(2)}</strong></div>
      <div class="pricing-row"><span>+ Card Issuance Fee</span><strong>$${Number(breakdown.issuance_fee_usd).toFixed(2)}</strong></div>
      <div class="pricing-row pricing-total"><span>= Total USD Required</span><strong>$${Number(breakdown.total_usd_required).toFixed(2)}</strong></div>
      <div class="pricing-row pricing-mmk"><span>Total Payable (MMK)</span><strong>${Number(breakdown.total_mmk).toLocaleString()} MMK</strong></div>
      ${refCode ? `<p class="receipt-ref">Ref: ${refCode}</p>` : ''}
      ${extra?.note ? `<p class="hint">${extra.note}</p>` : ''}
    `;
  },

  renderCardRequestReceipt(data) {
    const el = $('cardRequestReceipt');
    if (!el || !data.pricing_breakdown) return;
    el.classList.remove('hidden');
    el.innerHTML = this.formatPricingReceiptHtml(
      data.pricing_breakdown,
      data.payment_instructions?.ref_code || data.deposit?.ref_code,
      {
        title: 'New Card Request — Payment Required',
        note: `Send exactly ${Number(data.pricing_breakdown.total_mmk).toLocaleString()} MMK via ${data.pricing_breakdown.payment_method || 'KBZPay/WavePay'}, then submit proof below.`,
      }
    );
  },

  renderDepositReceiptSummary(deposit, breakdown) {
    const el = $('depositReceiptSummary');
    if (!el) return;
    const p = breakdown || deposit?.pricing_breakdown;
    if (!p) {
      el.classList.add('hidden');
      el.innerHTML = '';
      return;
    }
    el.classList.remove('hidden');
    el.innerHTML = this.formatPricingReceiptHtml(p, deposit?.ref_code, {
      title: deposit?.purpose === 'card_issuance' ? 'New Card Payment Receipt' : 'Deposit Summary',
      note: 'Include this reference in your KBZPay/WavePay payment note.',
    });
  },

  populateDepositFromCardRequest(data) {
    if (!data.deposit) return;
    $('refCodeBox')?.classList.remove('hidden');
    if ($('refCodeDisplay')) $('refCodeDisplay').textContent = data.deposit.ref_code;
    if ($('verifyRef')) $('verifyRef').value = data.deposit.ref_code;
    if ($('verifyAmount')) $('verifyAmount').value = data.deposit.amount_mmk;
    if ($('activeDepositId')) $('activeDepositId').value = data.deposit.id;
    if ($('amountMmk')) $('amountMmk').value = data.deposit.amount_mmk;
    if ($('paymentMethod') && data.pricing_breakdown?.payment_method) {
      $('paymentMethod').value = data.pricing_breakdown.payment_method;
    }
    $('depositSubmitForm')?.classList.remove('hidden');
    this.renderDepositReceiptSummary(data.deposit, data.pricing_breakdown);
    this.startPolling(data.deposit.ref_code);
  },

  getActiveCards() {
    return (this.allCards || []).filter((c) => this.isCardActive(c) && c.card_number);
  },

  cardReloadLabel(card) {
    const last4 = card.last4 || '????';
    return `**** **** **** ${last4} (Active)`;
  },

  populateReloadCardSelect(preselectedId) {
    const select = $('reloadCardSelect');
    if (!select) return;

    const active = this.getActiveCards();
    if (!active.length) {
      select.innerHTML = '<option value="">No active cards — apply for a card first</option>';
      select.disabled = true;
      return;
    }

    select.disabled = false;
    const pre = preselectedId != null ? String(preselectedId) : select.value;
    select.innerHTML = '<option value="">— Select an active card —</option>' +
      active.map((c) => {
        const label = this.cardReloadLabel(c);
        return `<option value="${c.id}">${label}${c.is_primary ? ' · Primary' : ''}</option>`;
      }).join('');

    if (pre && active.some((c) => String(c.id) === pre)) {
      select.value = pre;
    } else if (this.isCardActive(this.allCards[this.activeCardIndex])) {
      select.value = String(this.allCards[this.activeCardIndex].id);
    }

    this.updateReloadPreview();
  },

  calculateReloadPreviewUsdtClient(amountUsdt) {
    const p = this.cardPricing;
    if (!p || amountUsdt == null || amountUsdt === '') return null;

    const topUp = parseFloat(amountUsdt);
    const fee = 3.5;
    const minUsdt = p.minimum_usdt_reload ?? 5;

    if (!Number.isFinite(topUp) || topUp <= 0) return null;

    const topUpUsd = Math.round(topUp * 100) / 100;
    const totalWalletUsdt = Math.round((topUpUsd + fee) * 100) / 100;

    return {
      top_up_usd: topUpUsd,
      deposit_usdt: totalWalletUsdt,
      total_wallet_usd: totalWalletUsdt,
      reload_fee_usd: fee,
      net_usd_to_card: topUpUsd,
      below_min: topUpUsd < minUsdt,
      min_usdt: minUsdt,
      payment_currency: 'USDT',
    };
  },

  calculateReloadPreviewClient(amountMmk) {
    const p = this.cardPricing;
    if (!p || amountMmk == null || amountMmk === '') return null;

    const mmk = parseFloat(amountMmk);
    const rate = p.mmk_to_usd_rate || 4500;
    const fee = 3.5;
    const minMmk = p.minimum_card_reload_mmk ?? 10000;

    if (!Number.isFinite(mmk) || mmk <= 0) return null;

    const topUpUsd = Math.round((mmk / rate) * 100) / 100;
    const totalWalletUsd = Math.round((topUpUsd + fee) * 100) / 100;
    const totalWalletMmk = Math.ceil(totalWalletUsd * rate);

    return {
      top_up_mmk: mmk,
      top_up_usd: topUpUsd,
      deposit_mmk: totalWalletMmk,
      total_wallet_usd: totalWalletUsd,
      reload_fee_usd: fee,
      net_usd_to_card: topUpUsd,
      mmk_to_usd_rate: rate,
      rate_effective_date: p.rate_effective_date,
      below_min: mmk < minMmk,
      min_mmk: minMmk,
    };
  },

  updateReloadPreview() {
    const select = $('reloadCardSelect');
    const cardId = select?.value;
    const card = this.getActiveCards().find((c) => String(c.id) === String(cardId));
    const method = $('reloadPaymentMethod')?.value || 'wallet_mmk';
    const isUsdt = method === 'wallet_usdt';
    const preview = isUsdt
      ? this.calculateReloadPreviewUsdtClient($('reloadAmountUsdt')?.value)
      : this.calculateReloadPreviewClient($('reloadAmountMmk')?.value);
    const p = this.cardPricing;

    const set = (id, text) => { const el = $(id); if (el) el.textContent = text; };

    set('reloadPreviewCard', card ? this.cardReloadLabel(card) : '—');
    set('reloadPreviewTopUp', preview ? `$${preview.top_up_usd.toFixed(2)}` : '—');
    set('reloadPreviewFee', '$3.50');
    set('reloadPreviewTotal', preview
      ? (isUsdt
        ? `$${preview.total_wallet_usd.toFixed(2)} USDT`
        : `$${preview.total_wallet_usd.toFixed(2)} (${preview.deposit_mmk.toLocaleString()} MMK)`)
      : '—');
    set('reloadPreviewRateLabel', isUsdt ? 'Wallet debit' : "Today's Exchange Rate");
    set('reloadPreviewRate', isUsdt
      ? (preview ? `$${preview.total_wallet_usd.toFixed(2)} USDT total` : '—')
      : (p ? `1 USD = ${Number(p.mmk_to_usd_rate).toLocaleString()} MMK` : '—'));

    const receive = $('reloadPreviewReceive');
    if (receive) {
      if (!card) {
        receive.textContent = 'Select a target card to see your reload summary.';
        receive.className = 'reload-preview-receive';
      } else if (preview?.below_min) {
        const minLabel = isUsdt
          ? `$${preview.min_usdt.toFixed(2)} USDT`
          : `${preview.min_mmk.toLocaleString()} MMK`;
        receive.textContent = `Minimum top-up is ${minLabel}.`;
        receive.className = 'reload-preview-receive';
        receive.style.background = 'var(--warning-bg)';
        receive.style.borderColor = 'var(--warning-border)';
        receive.style.color = '#fcd34d';
      } else if (preview) {
        receive.textContent = `Pending admin approval — $${preview.top_up_usd.toFixed(2)} USD will be added to ${this.cardReloadLabel(card)} once approved.`;
        receive.className = 'reload-preview-receive';
        receive.style.background = '';
        receive.style.borderColor = '';
        receive.style.color = '';
      } else {
        receive.textContent = 'Enter a top-up amount to preview your reload summary.';
      }
    }

    const submitBtn = $('btnSubmitReload');
    if (submitBtn) {
      submitBtn.disabled = !card || !preview || preview.below_min;
    }
    this.updateReloadWalletHint();
  },

  toggleReloadAmountFields() {
    const method = $('reloadPaymentMethod')?.value || 'wallet_mmk';
    const isUsdt = method === 'wallet_usdt' || method === 'USDT';
    const mmkField = $('reloadAmountMmk')?.closest('.field');
    const usdtField = $('reloadAmountUsdtField');
    if (mmkField) mmkField.classList.toggle('hidden', isUsdt);
    if (usdtField) usdtField.classList.toggle('hidden', !isUsdt);
    if ($('reloadAmountMmk')) $('reloadAmountMmk').required = !isUsdt;
    if ($('reloadAmountUsdt')) $('reloadAmountUsdt').required = isUsdt;
    this.updateReloadPreview();
  },

  openReloadModal(preselectedCardId) {
    this.populateReloadCardSelect(preselectedCardId);
    $('reloadCardForm')?.classList.remove('hidden');
    $('reloadRefBox')?.classList.add('hidden');
    $('reloadProofForm')?.classList.add('hidden');
    if ($('reloadOutput')) $('reloadOutput').textContent = '';
    $('reloadCardModal')?.classList.remove('hidden');
    this.updateReloadPreview();
  },

  closeReloadModal() {
    $('reloadCardModal')?.classList.add('hidden');
  },

  closeReloadModalAndReset() {
    this.closeReloadModal();
    this.resetReloadModalForm();
  },

  async loadWithdrawalFees() {
    if (!Auth.isLoggedIn()) return;
    try {
      const data = await Auth.api('GET', '/api/withdrawal/fees');
      this.withdrawalFees = data.fees || data;
      if (data.mmk_to_usd_rate != null) {
        this.withdrawalFees.mmk_to_usd_rate = data.mmk_to_usd_rate;
      }
      const min = Number(data.minimum_usdt_withdrawal || this.withdrawalFees.minimum_usdt_withdrawal || 10);
      const minInput = $('withdrawAmountUsdt');
      if (minInput) minInput.min = min;
      const minHint = $('withdrawMinHint');
      if (minHint) minHint.textContent = `Minimum withdrawal: $${min.toFixed(2)} USDT`;

      const minMmk = Number(data.minimum_mmk_withdrawal || this.withdrawalFees.minimum_mmk_withdrawal || 10000);
      const minMmkInput = $('withdrawAmountMmk');
      if (minMmkInput) minMmkInput.min = minMmk;
      const minMmkHint = $('withdrawMmkMinHint');
      if (minMmkHint) minMmkHint.textContent = `Minimum withdrawal: ${Math.round(minMmk).toLocaleString()} MMK`;

      this.updateWithdrawPreview();
      this.updateWithdrawMmkPreview();
    } catch (err) {
      console.warn('[Dashboard] withdrawal fees:', err.message);
    }
  },

  getWithdrawPayoutMethod() {
    return ($('withdrawPayoutMethod')?.value || 'crypto') === 'bank' ? 'bank' : 'crypto';
  },

  syncWithdrawPayoutFields() {
    const method = this.getWithdrawPayoutMethod();
    const cryptoFields = $('withdrawCryptoFields');
    const bankFields = $('withdrawBankFields');
    const walletInput = $('withdrawWalletAddress');
    const networkSelect = $('withdrawNetwork');
    if (cryptoFields) cryptoFields.classList.toggle('hidden', method !== 'crypto');
    if (bankFields) bankFields.classList.toggle('hidden', method !== 'bank');
    if (walletInput) walletInput.required = method === 'crypto';
    if (networkSelect) networkSelect.required = method === 'crypto';
    ['withdrawUsdtBankName', 'withdrawUsdtAccountName', 'withdrawUsdtAccountNumber'].forEach((id) => {
      const el = $(id);
      if (el) el.required = method === 'bank';
    });
    this.updateWithdrawPreview();
  },

  calculateWithdrawPreviewClient(amountUsdt) {
    const fees = this.withdrawalFees;
    if (!fees || !Number.isFinite(amountUsdt) || amountUsdt <= 0) return null;

    const method = this.getWithdrawPayoutMethod();
    const network = method === 'bank' ? 'BANK' : ($('withdrawNetwork')?.value || 'TRC20');
    const isBank = network === 'BANK';

    const feePercent = Number(fees.payment_service_fee_percent ?? 2);
    const minimumFee = Number(fees.payment_service_fee_minimum_usdt ?? 1);
    const percentFee = Math.round(amountUsdt * feePercent) / 100;
    let feeUsdt = Math.max(percentFee, minimumFee);
    feeUsdt = Math.round(feeUsdt * 100) / 100;
    const netUsdt = Math.round((amountUsdt - feeUsdt) * 100) / 100;
    const min = Number(fees.minimum_usdt_withdrawal || 10);
    const rate = Number(fees.mmk_to_usd_rate || 4500);
    const amountMmk = isBank ? Math.round(netUsdt * rate) : null;
    const usedMinimum = percentFee < minimumFee;

    const feeLabel = usedMinimum
      ? `min $${minimumFee.toFixed(2)} (2% = $${percentFee.toFixed(2)})`
      : `${feePercent}% ($${feeUsdt.toFixed(2)})`;

    return {
      payout_method: method,
      network,
      amount_usdt: Math.round(amountUsdt * 100) / 100,
      fee_usdt: feeUsdt,
      net_usdt: netUsdt,
      fee_label: feeLabel,
      fee_percent: feePercent,
      minimum_fee_usdt: minimumFee,
      used_minimum_fee: usedMinimum,
      exchange_rate: isBank ? rate : null,
      amount_mmk: amountMmk,
      minimum_usdt_withdrawal: min,
      below_minimum: amountUsdt < min,
      invalid_net: netUsdt <= 0 || (isBank && (!amountMmk || amountMmk <= 0)),
    };
  },

  updateWithdrawPreview() {
    const amount = parseFloat($('withdrawAmountUsdt')?.value);
    const preview = this.calculateWithdrawPreviewClient(amount);
    const method = this.getWithdrawPayoutMethod();
    const network = method === 'bank' ? 'BANK' : ($('withdrawNetwork')?.value || 'TRC20');

    if ($('withdrawPreviewNetwork')) {
      $('withdrawPreviewNetwork').textContent = method === 'bank'
        ? 'Bank (USDT → MMK)'
        : (network === 'BEP20' ? 'BEP20 (BSC)' : 'TRC20 (TRON)');
    }

    const mmkRow = $('withdrawPreviewMmkRow');
    if (mmkRow) mmkRow.classList.toggle('hidden', method !== 'bank');

    if (!preview) {
      if ($('withdrawPreviewFee')) $('withdrawPreviewFee').textContent = '—';
      if ($('withdrawPreviewNet')) $('withdrawPreviewNet').textContent = '—';
      if ($('withdrawPreviewMmk')) $('withdrawPreviewMmk').textContent = '—';
      if ($('withdrawPreviewSummary')) $('withdrawPreviewSummary').textContent = 'Enter an amount to preview fees.';
      return;
    }

    if ($('withdrawPreviewFee')) $('withdrawPreviewFee').textContent = preview.fee_label;
    if ($('withdrawPreviewNet')) $('withdrawPreviewNet').textContent = `$${preview.net_usdt.toFixed(2)} USDT`;
    if ($('withdrawPreviewMmk') && preview.amount_mmk != null) {
      $('withdrawPreviewMmk').textContent = `${Math.round(preview.amount_mmk).toLocaleString()} MMK`;
    }

    let summary = method === 'bank'
      ? `Requested $${preview.amount_usdt.toFixed(2)} − ${preview.fee_label} = $${preview.net_usdt.toFixed(2)} USDT → ${Math.round(preview.amount_mmk || 0).toLocaleString()} MMK (rate ${Number(preview.exchange_rate || 0).toLocaleString()}).`
      : `Requested $${preview.amount_usdt.toFixed(2)} − ${preview.fee_label} fee = $${preview.net_usdt.toFixed(2)} sent to your wallet.`;
    if (preview.below_minimum) summary = `Minimum withdrawal is $${preview.minimum_usdt_withdrawal.toFixed(2)} USDT.`;
    if (preview.invalid_net) summary = 'Amount too small after fee.';
    if ($('withdrawPreviewSummary')) $('withdrawPreviewSummary').textContent = summary;
  },

  openWithdrawModal() {
    $('withdrawUsdtForm')?.classList.remove('hidden');
    $('withdrawSuccessBox')?.classList.add('hidden');
    if ($('withdrawOutput')) $('withdrawOutput').textContent = '';
    if ($('withdrawWalletAddress')) $('withdrawWalletAddress').value = '';
    if ($('withdrawUsdtBankName')) $('withdrawUsdtBankName').value = '';
    if ($('withdrawUsdtAccountName')) $('withdrawUsdtAccountName').value = '';
    if ($('withdrawUsdtAccountNumber')) $('withdrawUsdtAccountNumber').value = '';
    if ($('withdrawPayoutMethod')) $('withdrawPayoutMethod').value = 'crypto';
    if ($('withdrawAmountUsdt')) {
      const min = Number(this.withdrawalFees?.minimum_usdt_withdrawal || 10);
      $('withdrawAmountUsdt').value = min > 0 ? min.toFixed(2) : '';
    }
    const balHint = $('withdrawBalanceHint');
    if (balHint) {
      balHint.textContent = `Available: $${Number(this.walletUsdt ?? 0).toFixed(2)} USDT`;
    }
    this.syncWithdrawPayoutFields();
    $('withdrawUsdtModal')?.classList.remove('hidden');
    this.updateWithdrawPreview();
  },

  closeWithdrawModal() {
    $('withdrawUsdtModal')?.classList.add('hidden');
  },

  calculateWithdrawMmkPreviewClient(amountMmk) {
    const fees = this.withdrawalFees || {};
    const amount = Math.round(Number(amountMmk) || 0);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    const feePercent = Number(fees.payment_service_fee_percent ?? fees.mmk_withdraw_fee_percent ?? 2);
    const rate = Number(fees.mmk_to_usd_rate || 4500);
    const minimumFee = Math.round(Number(fees.payment_service_fee_minimum_usdt ?? 1) * rate);
    const percentFee = Math.round(amount * feePercent / 100);
    const feeMmk = Math.max(percentFee, minimumFee);
    const netMmk = amount - feeMmk;
    const min = Number(fees.minimum_mmk_withdrawal || 10000);
    const usedMinimum = percentFee < minimumFee;
    return {
      amount_mmk: amount,
      fee_mmk: feeMmk,
      net_mmk: netMmk,
      fee_percent: feePercent,
      fee_label: usedMinimum
        ? `min ${minimumFee.toLocaleString()} MMK (${feePercent}% = ${percentFee.toLocaleString()} MMK)`
        : `${feePercent}% (${feeMmk.toLocaleString()} MMK)`,
      minimum_mmk_withdrawal: min,
      below_minimum: amount < min,
      invalid_net: netMmk <= 0,
    };
  },

  updateWithdrawMmkPreview() {
    const amount = parseFloat($('withdrawAmountMmk')?.value);
    const preview = this.calculateWithdrawMmkPreviewClient(amount);
    if (!preview) {
      if ($('withdrawMmkPreviewFee')) $('withdrawMmkPreviewFee').textContent = '—';
      if ($('withdrawMmkPreviewNet')) $('withdrawMmkPreviewNet').textContent = '—';
      if ($('withdrawMmkPreviewSummary')) $('withdrawMmkPreviewSummary').textContent = 'Enter an amount to preview.';
      return;
    }
    if ($('withdrawMmkPreviewFee')) $('withdrawMmkPreviewFee').textContent = preview.fee_label;
    if ($('withdrawMmkPreviewNet')) $('withdrawMmkPreviewNet').textContent = `${preview.net_mmk.toLocaleString()} MMK`;
    let summary = `Requested ${preview.amount_mmk.toLocaleString()} MMK − fee = ${preview.net_mmk.toLocaleString()} MMK to your bank.`;
    if (preview.below_minimum) summary = `Minimum withdrawal is ${Math.round(preview.minimum_mmk_withdrawal).toLocaleString()} MMK.`;
    if (preview.invalid_net) summary = 'Amount too small after fee.';
    if ($('withdrawMmkPreviewSummary')) $('withdrawMmkPreviewSummary').textContent = summary;
  },

  openWithdrawMmkModal() {
    $('withdrawMmkForm')?.classList.remove('hidden');
    $('withdrawMmkSuccessBox')?.classList.add('hidden');
    if ($('withdrawMmkBankName')) $('withdrawMmkBankName').value = '';
    if ($('withdrawMmkAccountName')) $('withdrawMmkAccountName').value = '';
    if ($('withdrawMmkAccountNumber')) $('withdrawMmkAccountNumber').value = '';
    if ($('withdrawAmountMmk')) {
      const min = Number(this.withdrawalFees?.minimum_mmk_withdrawal || 10000);
      $('withdrawAmountMmk').value = String(Math.round(min));
    }
    const balHint = $('withdrawMmkBalanceHint');
    if (balHint) {
      balHint.textContent = `Available: ${Math.round(Number(this.walletMmk ?? 0)).toLocaleString()} MMK`;
    }
    $('withdrawMmkModal')?.classList.remove('hidden');
    this.updateWithdrawMmkPreview();
  },

  closeWithdrawMmkModal() {
    $('withdrawMmkModal')?.classList.add('hidden');
  },

  bindWithdrawUsdt() {
    $('withdrawUsdtModalClose')?.addEventListener('click', () => this.closeWithdrawModal());
    $('withdrawUsdtModal')?.addEventListener('click', (e) => {
      if (e.target.id === 'withdrawUsdtModal') this.closeWithdrawModal();
    });
    $('btnOpenWithdrawUsdt')?.addEventListener('click', () => {
      if (!Auth.isLoggedIn()) {
        this.toast('Sign in to withdraw USDT', 'error');
        return;
      }
      this.openWithdrawModal();
    });

    $('withdrawPayoutMethod')?.addEventListener('change', () => this.syncWithdrawPayoutFields());
    $('withdrawNetwork')?.addEventListener('change', () => this.updateWithdrawPreview());
    $('withdrawAmountUsdt')?.addEventListener('input', () => this.updateWithdrawPreview());

    $('withdrawUsdtForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const method = this.getWithdrawPayoutMethod();
      const network = $('withdrawNetwork')?.value;
      const walletAddress = $('withdrawWalletAddress')?.value?.trim();
      const amount = parseFloat($('withdrawAmountUsdt')?.value);
      const preview = this.calculateWithdrawPreviewClient(amount);

      if (!preview || preview.below_minimum || preview.invalid_net) {
        this.toast('Enter a valid withdrawal amount', 'error');
        return;
      }

      if (method === 'crypto' && !walletAddress) {
        this.toast('Enter a valid crypto wallet address', 'error');
        return;
      }

      const bankName = $('withdrawUsdtBankName')?.value?.trim();
      const accountName = $('withdrawUsdtAccountName')?.value?.trim();
      const accountNumber = $('withdrawUsdtAccountNumber')?.value?.trim();
      if (method === 'bank' && (!bankName || !accountName || !accountNumber)) {
        this.toast('Enter bank name, account name, and account number', 'error');
        return;
      }

      if (Number(this.walletUsdt ?? 0) < preview.amount_usdt) {
        this.toast(`Insufficient USDT balance. Need $${preview.amount_usdt.toFixed(2)} USDT.`, 'error');
        return;
      }

      const btn = $('btnSubmitWithdrawUsdt');
      const prevLabel = btn?.textContent;
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Submitting…';
      }

      try {
        const payload = method === 'bank'
          ? {
            payout_method: 'bank',
            amount_usdt: preview.amount_usdt,
            bank_name: bankName,
            account_name: accountName,
            account_number: accountNumber,
          }
          : {
            payout_method: 'crypto',
            network,
            wallet_address: walletAddress,
            amount_usdt: preview.amount_usdt,
          };

        const data = await Auth.api('POST', '/api/withdrawal/usdt', payload, { sensitive: true });

        if (data.wallet) {
          this.walletUsdt = data.wallet.balance_usdt;
          this.walletMmk = data.wallet.balance_mmk ?? this.walletMmk;
          if ($('sumBalanceUsdt')) $('sumBalanceUsdt').textContent = data.wallet.usdt_formatted || `$ ${Number(data.wallet.balance_usdt).toFixed(2)} USDT`;
          if ($('sumBalanceMmk') && data.wallet.mmk_formatted) $('sumBalanceMmk').textContent = data.wallet.mmk_formatted;
        }

        $('withdrawUsdtForm')?.classList.add('hidden');
        $('withdrawSuccessBox')?.classList.remove('hidden');
        if ($('withdrawRefCode')) $('withdrawRefCode').textContent = data.ref_code || data.withdrawal?.ref_code || '—';
        if ($('withdrawSuccessMessage')) {
          $('withdrawSuccessMessage').textContent = data.message
            || (method === 'bank'
              ? `Withdrawal submitted. ${Math.round(preview.amount_mmk || 0).toLocaleString()} MMK will be sent to your bank after processing.`
              : `Withdrawal submitted. Net $${Number(data.withdrawal?.net_usdt || preview.net_usdt).toFixed(2)} USDT will be sent after processing.`);
        }
        this.toast('Withdrawal request submitted', 'ok');
        this.log(
          method === 'bank'
            ? `Withdrawal ${data.ref_code}: ${Math.round(preview.amount_mmk || 0).toLocaleString()} MMK to bank`
            : `Withdrawal ${data.ref_code}: $${preview.net_usdt.toFixed(2)} net (${network})`,
          'ok'
        );
        this._usdtWalletCache = null;
        this.loadUsdtWalletPage(true);
      } catch (err) {
        if (err.code === 'SENSITIVE_AUTH_REQUIRED') $('pinUnlockModal')?.classList.remove('hidden');
        this.toast(err.message || 'Withdrawal failed', 'error');
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = prevLabel || 'Submit Withdrawal Request';
        }
      }
    });
  },

  bindWithdrawMmk() {
    $('withdrawMmkModalClose')?.addEventListener('click', () => this.closeWithdrawMmkModal());
    $('withdrawMmkModal')?.addEventListener('click', (e) => {
      if (e.target.id === 'withdrawMmkModal') this.closeWithdrawMmkModal();
    });
    $('btnOpenWithdrawMmk')?.addEventListener('click', () => {
      if (!Auth.isLoggedIn()) {
        this.toast('Sign in to withdraw MMK', 'error');
        return;
      }
      this.openWithdrawMmkModal();
    });
    $('withdrawAmountMmk')?.addEventListener('input', () => this.updateWithdrawMmkPreview());

    $('withdrawMmkForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const bankName = $('withdrawMmkBankName')?.value?.trim();
      const accountName = $('withdrawMmkAccountName')?.value?.trim();
      const accountNumber = $('withdrawMmkAccountNumber')?.value?.trim();
      const amount = Math.round(parseFloat($('withdrawAmountMmk')?.value) || 0);
      const preview = this.calculateWithdrawMmkPreviewClient(amount);

      if (!bankName || !accountName || !accountNumber) {
        this.toast('Enter bank name, account name, and account number', 'error');
        return;
      }
      if (!preview || preview.below_minimum || preview.invalid_net) {
        this.toast('Enter a valid MMK withdrawal amount', 'error');
        return;
      }
      if (Number(this.walletMmk ?? 0) < preview.amount_mmk) {
        this.toast(`Insufficient MMK balance. Need ${preview.amount_mmk.toLocaleString()} MMK.`, 'error');
        return;
      }

      const btn = $('btnSubmitWithdrawMmk');
      const prevLabel = btn?.textContent;
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Submitting…';
      }

      try {
        const data = await Auth.api('POST', '/api/withdrawal/mmk', {
          amount_mmk: preview.amount_mmk,
          bank_name: bankName,
          account_name: accountName,
          account_number: accountNumber,
        }, { sensitive: true });

        if (data.wallet) {
          this.walletMmk = data.wallet.balance_mmk;
          if ($('sumBalanceMmk')) {
            $('sumBalanceMmk').textContent = data.wallet.mmk_formatted
              || `Ks ${Math.round(Number(data.wallet.balance_mmk)).toLocaleString()} MMK`;
          }
        }

        $('withdrawMmkForm')?.classList.add('hidden');
        $('withdrawMmkSuccessBox')?.classList.remove('hidden');
        if ($('withdrawMmkRefCode')) $('withdrawMmkRefCode').textContent = data.ref_code || '—';
        if ($('withdrawMmkSuccessMessage')) {
          $('withdrawMmkSuccessMessage').textContent = data.message
            || `Withdrawal submitted. ${preview.net_mmk.toLocaleString()} MMK will be sent to your bank after processing.`;
        }
        this.toast('MMK withdrawal submitted', 'ok');
        this.log(`MMK withdrawal ${data.ref_code}: ${preview.net_mmk.toLocaleString()} MMK to ${bankName}`, 'ok');
      } catch (err) {
        if (err.code === 'SENSITIVE_AUTH_REQUIRED') $('pinUnlockModal')?.classList.remove('hidden');
        this.toast(err.message || 'MMK withdrawal failed', 'error');
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = prevLabel || 'Submit Withdrawal Request';
        }
      }
    });
  },

  bindReloadCard() {
    $('reloadCardModalClose')?.addEventListener('click', () => this.closeReloadModal());
    $('reloadCardModal')?.addEventListener('click', (e) => {
      if (e.target.id === 'reloadCardModal') this.closeReloadModal();
    });

    document.querySelectorAll('[data-open-reload], #btnOpenReloadModal').forEach((btn) => {
      btn.addEventListener('click', () => this.openReloadModal());
    });

    $('btnReloadSelectedCard')?.addEventListener('click', () => {
      const card = this.allCards[this.activeCardIndex];
      if (!card || !this.isCardActive(card)) {
        this.toast('Select an active card to reload', 'error');
        return;
      }
      this.openReloadModal(card.id);
    });

    $('reloadCardSelect')?.addEventListener('change', () => this.updateReloadPreview());
    $('reloadAmountMmk')?.addEventListener('input', () => this.updateReloadPreview());
    $('reloadAmountUsdt')?.addEventListener('input', () => this.updateReloadPreview());
    $('reloadPaymentMethod')?.addEventListener('change', () => {
      this.toggleReloadAmountFields();
      this.updateReloadWalletHint();
    });

    $('reloadCardForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const cardId = parseInt($('reloadCardSelect').value, 10);
      const method = $('reloadPaymentMethod').value;
      const payFromWallet = this.isWalletPaymentMethod(method);
      const walletType = this.getWalletTypeFromMethod(method);
      const isUsdt = walletType === 'usdt';
      const preview = isUsdt
        ? this.calculateReloadPreviewUsdtClient(parseFloat($('reloadAmountUsdt')?.value))
        : this.calculateReloadPreviewClient(parseFloat($('reloadAmountMmk')?.value));

      if (!cardId || !preview || preview.below_min) {
        this.toast('Please select a card and enter a valid top-up amount', 'error');
        return;
      }

      if (payFromWallet && walletType === 'mmk' && Number(this.walletMmk ?? 0) < preview.deposit_mmk) {
        this.toast(`Insufficient MMK wallet. Need ${this.formatMmk(preview.deposit_mmk)}. Top up first.`, 'error');
        this.closeReloadModal();
        if (typeof AppNav !== 'undefined') AppNav.navigate('deposits', { pushHash: true });
        return;
      }
      if (payFromWallet && walletType === 'usdt' && Number(this.walletUsdt ?? 0) < preview.deposit_usdt) {
        this.toast(`Insufficient USDT wallet. Need ${this.formatUsdt(preview.deposit_usdt)}. Top up first.`, 'error');
        this.closeReloadModal();
        if (typeof AppNav !== 'undefined') AppNav.navigate('deposits', { pushHash: true, depositTab: 'usdt' });
        return;
      }

      try {
        const body = {
          card_id: cardId,
          pay_from_wallet: payFromWallet,
        };
        if (payFromWallet) {
          body.wallet_type = walletType;
          if (isUsdt) body.amount_usdt = preview.top_up_usd;
          else body.amount_mmk = preview.top_up_mmk;
        } else {
          body.amount_mmk = preview.top_up_mmk;
          body.payment_method = method;
        }

        const data = await Auth.api('POST', '/api/user/card/reload', body, { sensitive: true });

        if (data.paid_from_wallet || data.pending) {
          const msg = data.message || 'Reload request submitted! Pending admin approval.';
          this.toast(msg, 'ok');
          this.log(msg, 'ok');
          this.closeReloadModalAndReset();
          this.loadWallet();
          this.loadReloadHistory();
          this.loadDepositHistory();
          this.loadTransactions();
          return;
        }

        $('reloadRefBox')?.classList.remove('hidden');
        $('reloadRefCode').textContent = data.deposit.ref_code;
        $('reloadActiveDepositId').value = data.deposit.id;
        $('reloadProofForm')?.classList.remove('hidden');
        $('reloadStatus').textContent = 'Reload request submitted — send payment, then submit proof below. Pending admin approval.';
        $('reloadStatus').className = 'status-line warn';
        this.toast(data.message || 'Reload request submitted! Pending admin approval.', 'ok');
        this.startReloadPolling(data.deposit.ref_code);
        this.log(`Card reload requested: ${data.deposit.ref_code}`, 'ok');
        this.loadDepositHistory();
      } catch (err) {
        if (err.code === 'SENSITIVE_AUTH_REQUIRED') $('pinUnlockModal').classList.remove('hidden');
        if (err.code === 'INSUFFICIENT_MMK_BALANCE' || err.code === 'INSUFFICIENT_USDT_BALANCE') {
          this.toast(err.message, 'error');
          if (typeof AppNav !== 'undefined') AppNav.navigate('deposits', { pushHash: true, depositTab: err.code === 'INSUFFICIENT_USDT_BALANCE' ? 'usdt' : 'mmk' });
          return;
        }
        this.toast(err.message || 'Reload request failed', 'error');
        this.log(err.message, 'error');
      }
    });

    $('reloadProofForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await this.submitDepositProof({
          depositId: $('reloadActiveDepositId').value,
          txnId: $('reloadTxnId').value.trim(),
          userNote: $('reloadNote').value.trim(),
          fileInput: $('reloadScreenshot'),
          base64: this._reloadReceiptBase64,
          filename: this._reloadReceiptFile?.name || 'receipt.jpg',
          requireReceipt: true,
        });
        this.closeReloadModalAndReset();
        await this.onPaymentProofSubmitted('Payment Proof Submitted Successfully!');
      } catch (err) {
        if (err.code === 'SENSITIVE_AUTH_REQUIRED') $('pinUnlockModal').classList.remove('hidden');
        this.toast(err.message || 'Failed to submit payment proof', 'error');
        this.log(err.message, 'error');
      }
    });

    $('btnCopyReloadRef')?.addEventListener('click', () => {
      navigator.clipboard.writeText($('reloadRefCode').textContent);
      this.copyToast('Ref code copied!');
    });

    const reloadScreenshot = $('reloadScreenshot');
    if (reloadScreenshot) {
      reloadScreenshot.onchange = () => this.previewReloadScreenshot();
    }
    const btnClearReloadScreenshot = $('btnClearReloadScreenshot');
    if (btnClearReloadScreenshot) {
      btnClearReloadScreenshot.onclick = () => this.clearReloadScreenshotPreview();
    }
  },

  previewReloadScreenshot() {
    const file = $('reloadScreenshot').files?.[0];
    if (!file) { this.clearReloadScreenshotPreview(); return; }

    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');
    if (!isImage && !isVideo) {
      this.toast('Please select an image or video file', 'error');
      $('reloadScreenshot').value = '';
      return;
    }

    this.clearReloadScreenshotPreview(false);
    this._reloadReceiptFile = file;

    this.readReceiptFileAsDataUrl(file, {
      onLoad: (dataUrl) => {
        this._reloadReceiptBase64 = dataUrl;
        this._reloadReceiptUrl = dataUrl;
        this._reloadProofUrl = dataUrl;
        const img = $('reloadScreenshotImg');
        const video = $('reloadProofVideo');
        if (isVideo) {
          if (video) {
            video.src = dataUrl;
            video.classList.remove('hidden');
          }
          img?.classList.add('hidden');
        } else {
          if (img) {
            img.src = dataUrl;
            img.classList.remove('hidden');
          }
          video?.classList.add('hidden');
        }
        $('reloadScreenshotPreview')?.classList.remove('hidden');
      },
    });
  },

  clearReloadScreenshotPreview(revoke = true) {
    if (revoke && this._reloadProofUrl && String(this._reloadProofUrl).startsWith('blob:')) {
      URL.revokeObjectURL(this._reloadProofUrl);
    }
    this._reloadProofUrl = null;
    this._reloadReceiptBase64 = null;
    this._reloadReceiptUrl = null;
    this._reloadReceiptFile = null;
    if ($('reloadScreenshot')) $('reloadScreenshot').value = '';
    const img = $('reloadScreenshotImg');
    if (img) {
      if (img.src?.startsWith('blob:')) URL.revokeObjectURL(img.src);
      img.src = '';
      img.classList.add('hidden');
    }
    const video = $('reloadProofVideo');
    if (video) {
      video.pause();
      if (video.src?.startsWith('blob:')) URL.revokeObjectURL(video.src);
      video.removeAttribute('src');
      video.load();
      video.classList.add('hidden');
    }
    $('reloadScreenshotPreview')?.classList.add('hidden');
  },

  startReloadPolling(ref) {
    if (this.reloadPollTimer) clearInterval(this.reloadPollTimer);
    this.reloadPollTimer = setInterval(async () => {
      try {
        const { deposit } = await Auth.api('GET', `/api/deposit/status/${ref}`);
        if (deposit.status === 'VERIFIED') {
          clearInterval(this.reloadPollTimer);
          $('reloadStatus').textContent = 'Reload approved — card balance updated!';
          $('reloadStatus').className = 'status-line ok';
          this.loadAllCards({ preserveSelection: true, silent: true });
          this.loadDepositHistory();
        }
      } catch (_) {}
    }, 3000);
  },

  updateHomeRateSummary() {
    const p = this.cardPricing;
    const el = $('homeRateSummary');
    if (!el) return;
    if (!p) {
      el.textContent = 'Loading rate…';
      return;
    }
    const eff = p.rate_effective_date ? ` (Effective: ${p.rate_effective_date})` : '';
    el.textContent = `1 USD = ${Number(p.mmk_to_usd_rate || 4500).toLocaleString()} MMK${eff} · Card fee $${Number(p.card_issuance_fee_usd || 0).toFixed(2)} · Min deposit $${Number(p.minimum_initial_deposit_usd || 0).toFixed(2)}`;
  },

  renderRatesPage() {
    const p = this.cardPricing;
    if (!p) return;

    const rate = p.mmk_to_usd_rate || 4500;
    const fee = p.card_issuance_fee_usd || 0;
    const min = p.minimum_initial_deposit_usd || 10;
    const eff = p.rate_effective_date || '';

    if ($('ratesExchangeValue')) {
      $('ratesExchangeValue').textContent = `1 USD = ${rate.toLocaleString()} MMK`;
    }
    if ($('ratesEffectiveDate')) {
      $('ratesEffectiveDate').textContent = eff ? `Effective: ${eff}` : '';
    }
    if ($('ratesCardFee')) $('ratesCardFee').textContent = `$${fee.toFixed(2)}`;
    if ($('ratesMinDeposit')) $('ratesMinDeposit').textContent = `$${min.toFixed(2)}`;

    const reloadFeeEl = $('ratesReloadFee');
    if (reloadFeeEl) reloadFeeEl.textContent = '$3.50 fixed (+ $2.00 platform profit per reload)';

    const wf = p.withdrawal_fees || this.withdrawalFees || {};
    const pct = Number(wf.payment_service_fee_percent ?? 2);
    const minFee = Number(wf.payment_service_fee_minimum_usdt ?? 1);
    const unifiedLabel = `${pct}% (min $${minFee.toFixed(2)})`;
    if ($('ratesWithdrawFeeTrc20')) {
      $('ratesWithdrawFeeTrc20').textContent = unifiedLabel;
    }
    if ($('ratesWithdrawFeeBep20')) {
      $('ratesWithdrawFeeBep20').textContent = unifiedLabel;
    }
    if ($('ratesMinWithdrawal')) {
      $('ratesMinWithdrawal').textContent = `$${Number(wf.minimum_usdt_withdrawal || 10).toFixed(2)}`;
    }

    const totalUsd = min + fee;
    const totalMmk = Math.ceil(totalUsd * rate);
    const sample = $('ratesSampleBreakdown');
    if (sample) {
      sample.innerHTML = `
        <div class="pricing-row"><span>Initial Card Load (min)</span><strong>$${min.toFixed(2)}</strong></div>
        <div class="pricing-row"><span>+ Card Issuance Fee</span><strong>$${fee.toFixed(2)}</strong></div>
        <div class="pricing-row pricing-total"><span>= Total USD Required</span><strong>$${totalUsd.toFixed(2)}</strong></div>
        <div class="pricing-row pricing-mmk"><span>Total Payable (MMK)</span><strong>${totalMmk.toLocaleString()} MMK</strong></div>
        <p class="hint pricing-rate">At today's rate: 1 USD = ${rate.toLocaleString()} MMK</p>
      `;
    }
  },

  userStatusBadge(status) {
    const s = String(status || '').toUpperCase();
    const labels = {
      VERIFIED: typeof t === 'function' ? t('verified') : 'Approved',
      APPROVED: typeof t === 'function' ? t('verified') : 'Approved',
      ACTIVE: typeof t === 'function' ? t('verified') : 'Approved',
      SUBMITTED: typeof t === 'function' ? t('pending_approval') : 'Pending Approval',
      UNDER_REVIEW: typeof t === 'function' ? t('pending_approval') : 'Pending Approval',
      PENDING: typeof t === 'function' ? t('pending_approval') : 'Pending Approval',
      REJECTED: typeof t === 'function' ? t('rejected') : 'Rejected',
      FAILED: typeof t === 'function' ? t('rejected') : 'Rejected',
    };
    const cls = {
      VERIFIED: 'ok', ACTIVE: 'ok', APPROVED: 'ok',
      SUBMITTED: 'warn', UNDER_REVIEW: 'warn', PENDING: 'warn',
      REJECTED: 'err', FAILED: 'err',
    }[s] || 'muted';
    const label = labels[s] || status || 'Unknown';
    const esc = (t) => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    return `<span class="badge badge-${cls}">${esc(label)}</span>`;
  },

  reloadStatusBadge(status) {
    const s = String(status || '').toLowerCase();
    const labels = {
      pending: 'PENDING',
      approved: 'COMPLETED',
      completed: 'COMPLETED',
      rejected: 'REJECTED',
      cancelled: 'REJECTED',
    };
    const cls = {
      pending: 'warn',
      approved: 'ok',
      completed: 'ok',
      rejected: 'err',
      cancelled: 'err',
    }[s] || 'muted';
    const esc = (t) => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    return `<span class="badge badge-${cls}">${esc(labels[s] || String(status || 'UNKNOWN').toUpperCase())}</span>`;
  },

  isPendingReloadStatus(status) {
    return String(status || '').toLowerCase() === 'pending';
  },

  renderReloadHistoryRow(r) {
    const pending = this.isPendingReloadStatus(r.status);
    const usd = r.net_usd_to_card != null ? `$${Number(r.net_usd_to_card).toFixed(2)}` : '—';
    const mmk = r.amount_mmk != null ? `${Number(r.amount_mmk).toLocaleString()} MMK` : null;
    const usdt = r.wallet_type === 'usdt' && r.amount_usdt != null
      ? `$${Number(r.amount_usdt).toFixed(2)} USDT`
      : null;
    const amountParts = [usd !== '—' ? `${usd} USD` : null, mmk, usdt].filter(Boolean);
    const esc = (t) => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    return `
      <tr class="${pending ? 'deposit-history-row-pending' : ''}">
        <td><small>${esc(this.formatDepositDate(r.created_at))}</small></td>
        <td class="deposit-amount-cell"><strong>${esc(amountParts.join(' · ') || '—')}</strong></td>
        <td>${this.reloadStatusBadge(r.status)}</td>
      </tr>`;
  },

  renderReloadHistoryTable(reloads) {
    if (!reloads?.length) {
      return '<p class="hint">No card reload requests yet.</p>';
    }
    return `
      <table class="data-table">
        <thead><tr>
          <th>Date &amp; Time</th><th>Reload Amount</th><th>Status</th>
        </tr></thead>
        <tbody>${reloads.map((r) => this.renderReloadHistoryRow(r)).join('')}</tbody>
      </table>`;
  },

  async loadReloadHistory(preloadedReloads = null) {
    if (!Auth.isLoggedIn()) return;
    const targets = [$('cardsReloadHistoryTable')].filter(Boolean);
    if (!targets.length) return;
    try {
      let reloads = preloadedReloads;
      if (!reloads) {
        if (window.SupabaseBridge?.isReady() && Auth.user?.id) {
          reloads = await window.SupabaseBridge.fetchUserReloads(Auth.user.id);
        }
        if (reloads == null) {
          const data = await Auth.api('GET', '/api/user/reloads');
          reloads = data.reloads || [];
        }
      }
      const html = this.renderReloadHistoryTable(reloads);
      targets.forEach((el) => { el.innerHTML = html; });
    } catch (err) {
      const msg = `<p class="hint">${err.message || 'Failed to load reload history'}</p>`;
      targets.forEach((el) => { el.innerHTML = msg; });
    }
  },

  renderDepositHistoryRow(d) {
    const isP2p = d.is_p2p || d.deposit_channel === 'p2p' || d.metadata?.deposit_channel === 'p2p';
    const purpose = isP2p && d.purpose === 'usdt_topup'
      ? { text: 'P2P USDT Deposit', cls: 'usdt' }
      : this.depositPurposeMeta(d.purpose);
    const pending = this.isPendingDepositStatus(d.status)
      || (isP2p && d.p2p_status === 'pending_verification');
    const txn = d.kpay_transaction_id || d.txn_id;
    const ref = d.ref_code || '—';
    const isUsdt = d.purpose === 'usdt_topup';
    const amountPrimary = isUsdt
      ? (d.amount_usd != null ? `$${Number(d.amount_usd).toFixed(2)} USDT` : '—')
      : (d.amount_mmk != null ? `${Number(d.amount_mmk).toLocaleString()} MMK` : '—');
    const amountSecondary = !isUsdt && d.amount_usd != null ? `$${Number(d.amount_usd).toFixed(2)} USD` : '';
    const esc = (t) => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    return `
      <tr class="${pending ? 'deposit-history-row-pending' : ''}">
        <td><small>${esc(this.formatDepositDate(d.submitted_at || d.created_at))}</small></td>
        <td><span class="deposit-purpose-badge ${purpose.cls}">${esc(purpose.text)}</span></td>
        <td class="deposit-amount-cell"><strong>${esc(amountPrimary)}</strong>${amountSecondary ? `<small>${esc(amountSecondary)}</small>` : ''}</td>
        <td class="deposit-ref-cell">
          <code>${esc(ref)}</code>
          ${txn ? `<div class="deposit-txn-cell">Txn: ${esc(txn)}</div>` : ''}
        </td>
        <td>${this.depositStatusBadge(d)}</td>
      </tr>`;
  },

  depositStatusBadge(d) {
    const isP2p = d.is_p2p || d.deposit_channel === 'p2p';
    if (isP2p && d.p2p_status === 'pending_verification') {
      return '<span class="badge badge-warn">Pending P2P Verification</span>';
    }
    if (isP2p && d.status === 'UNDER_REVIEW') {
      return '<span class="badge badge-warn">Pending P2P Verification</span>';
    }
    return this.userStatusBadge(d.status);
  },

  renderPendingRequestsList(deposits, reloads) {
    const el = $('pendingRequestsList');
    if (!el) return;
    const pendingDeposits = (deposits || []).filter((d) => this.isPendingDepositStatus(d.status));
    const pendingReloads = (reloads || []).filter((r) => this.isPendingReloadStatus(r.status));
    const depositRows = pendingDeposits.map((d) => this.renderDepositHistoryRow(d));
    const reloadRows = pendingReloads.map((r) => {
      const pending = true;
      const amount = r.wallet_type === 'usdt'
        ? (r.amount_usdt != null ? `$${Number(r.amount_usdt).toFixed(2)} USDT` : '—')
        : (r.amount_mmk != null ? `${Number(r.amount_mmk).toLocaleString()} MMK` : '—');
      const esc = (t) => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
      return `
        <tr class="${pending ? 'deposit-history-row-pending' : ''}">
          <td><small>${esc(this.formatDepositDate(r.created_at))}</small></td>
          <td><span class="deposit-purpose-badge reload">Card Reload</span></td>
          <td class="deposit-amount-cell"><strong>${esc(amount)}</strong><small>$${Number(r.net_usd_to_card || 0).toFixed(2)} USD</small></td>
          <td class="deposit-ref-cell"><code>Reload #${esc(r.id)}</code><div class="deposit-txn-cell">${esc(r.card_label || '')}</div></td>
          <td>${this.reloadStatusBadge(r.status)}</td>
        </tr>`;
    });
    const rows = [...depositRows, ...reloadRows];
    if (!rows.length) {
      el.innerHTML = '<p class="hint pending-requests-empty">No active pending requests — you\'re all caught up.</p>';
      return;
    }
    el.innerHTML = `
      <table class="data-table">
        <thead><tr>
          <th>Date &amp; Time</th><th>Request Type</th><th>Amount</th><th>Ref / Txn</th><th>Status</th>
        </tr></thead>
        <tbody>${rows.join('')}</tbody>
      </table>`;
  },

  async loadDepositHistory() {
    if (!Auth.isLoggedIn()) return;
    const el = $('depositHistoryTable');
    if (!el) return;
    try {
      let deposits = [];
      let reloads = [];

      if (window.SupabaseBridge?.isReady() && Auth.user?.id) {
        [deposits, reloads] = await Promise.all([
          window.SupabaseBridge.fetchUserDeposits(Auth.user.id),
          window.SupabaseBridge.fetchUserReloads(Auth.user.id),
        ]);
      } else {
        const [{ deposits: apiDeposits }, { reloads: apiReloads }] = await Promise.all([
          Auth.api('GET', '/api/user/deposits'),
          Auth.api('GET', '/api/user/reloads'),
        ]);
        deposits = apiDeposits || [];
        reloads = apiReloads || [];
      }

      this.renderPendingRequestsList(deposits, reloads);
      await this.loadReloadHistory(reloads);
      if (!deposits.length) {
        el.innerHTML = '<p class="hint">No deposit requests yet.</p>';
        return;
      }
      el.innerHTML = `
        <table class="data-table">
          <thead><tr>
            <th>Date &amp; Time</th>
            <th>Request Type</th>
            <th>Amount (MMK / USD)</th>
            <th>Ref / Txn ID</th>
            <th>Status</th>
          </tr></thead>
          <tbody>${deposits.map((d) => this.renderDepositHistoryRow(d)).join('')}</tbody>
        </table>`;
    } catch (err) {
      el.innerHTML = `<p class="hint">${err.message || 'Failed to load deposits'}</p>`;
      this.renderPendingRequestsList([], []);
    }
  },

  async loadTransactions() {
    if (!Auth.isLoggedIn()) return;
    try {
      const { transactions } = await Auth.api('GET', '/api/user/transactions');
      const el = $('txHistory');
      if (!el) return;
      el.innerHTML = transactions.length ? `
        <table class="data-table">
          <thead><tr><th>Time</th><th>Type</th><th>USD</th><th>Description</th></tr></thead>
          <tbody>${transactions.map((t) => `
            <tr>
              <td><small>${t.created_at}</small></td>
              <td><code>${t.type}</code></td>
              <td>${t.amount_usd != null ? '$' + Number(t.amount_usd).toFixed(2) : '—'}</td>
              <td><small>${t.description || ''}</small></td>
            </tr>
          `).join('')}</tbody>
        </table>` : '<p class="hint">No transactions yet.</p>';
    } catch (err) {
      console.warn('[tx history]', err.message);
    }
  },

  async loadSupportThreads() {
    if (!Auth.isLoggedIn()) return;
    try {
      const { threads } = await Auth.api('GET', '/api/support/threads');
      const el = $('supportThreadsUser');
      if (!el) return;
      el.innerHTML = threads.length
        ? threads.map((t) => `<div class="thread-item"><strong>${t.subject}</strong><small>${t.status} · ${t.updated_at}</small></div>`).join('')
        : '<p class="hint">No support tickets yet.</p>';
    } catch (_) {}
  },

  async loadWallet() {
    try {
      if (window.SupabaseBridge?.isReady() && Auth.user?.id) {
        const row = await window.SupabaseBridge.fetchUserWallet(Auth.user.id);
        if (row) {
          this.renderWalletBalances(window.SupabaseBridge.walletToApiShape(row));
          if ($('sumName')) $('sumName').textContent = Auth.user?.name || row.name || '—';
          if ($('sumPhone')) $('sumPhone').textContent = Auth.user?.phone || '—';
          if ($('sumEmail')) $('sumEmail').textContent = Auth.user?.email || row.email || '—';
          return;
        }
      }
      const data = await Auth.api('GET', '/api/user/wallet', null, { sensitive: true });
      this.renderWalletBalances(data);
      if ($('sumName')) $('sumName').textContent = Auth.user?.name || '—';
      if ($('sumPhone')) $('sumPhone').textContent = Auth.user?.phone || '—';
      if ($('sumEmail')) $('sumEmail').textContent = Auth.user?.email || '—';
    } catch (err) {
      if (err.code === 'SENSITIVE_AUTH_REQUIRED') {
        if ($('sumBalanceMmk')) $('sumBalanceMmk').textContent = '🔒 Locked';
        $('headerWalletCard')?.classList.add('hidden');
      }
    }
  },

  async loadAllCards({ preserveSelection = false, silent = false, forceRefresh = false } = {}) {
    if (!Auth.isLoggedIn()) return;

    if (Auth.needsPinUnlock()) {
      if (!this.allCards.length) this.applyCachedCardsIfAvailable();
      if (!silent) $('pinUnlockModal')?.classList.remove('hidden');
      return;
    }

    // Never drop refreshes while a request is in flight — queue and replay
    if (this._cardsLoading) {
      const queued = this._cardsLoadQueued || {
        preserveSelection: false,
        silent: true,
        forceRefresh: false,
      };
      this._cardsLoadQueued = {
        preserveSelection: queued.preserveSelection || preserveSelection,
        silent: queued.silent && silent,
        forceRefresh: queued.forceRefresh || forceRefresh,
      };
      return;
    }

    this._cardsLoading = true;

    if (!forceRefresh && !this.allCards.length) {
      this.applyCachedCardsIfAvailable();
    }

    try {
      const prevCards = this.allCards || [];
      const prevSignature = this.cardsSignature(prevCards);
      const prevCardId = preserveSelection && prevCards[this.activeCardIndex]
        ? prevCards[this.activeCardIndex].id
        : null;

      let data;
      try {
        data = await Auth.api('GET', '/api/user/cards', null, { sensitive: true });
      } catch (err) {
        // Back-compat: older servers returned 404 for empty card lists
        if (err.status === 404 && Array.isArray(err.response?.cards)) {
          data = { cards: err.response.cards, active_index: err.response.active_index || 0 };
        } else {
          throw err;
        }
      }

      const newCards = (data.cards || []).map((c) => this.normalizeCard(c));
      const nextSignature = this.cardsSignature(newCards);
      const unchanged = prevSignature === nextSignature && prevCards.length === newCards.length;

      newCards.forEach((c) => {
        const prev = prevCards.find((p) => p.id === c.id);
        if (prev && this.isCardPending(prev) && this.isCardActive(c)) {
          console.log('[Dashboard] Card approved — id=', c.id, 'now active');
          // Always notify — silent polls must still surface approval
          this.toast(`Your card •••• ${c.last4 || '????'} is now active!`, 'ok');
          this.log(`Card ending •••• ${c.last4 || '????'} is now active`, 'ok');
        }
      });

      this.allCards = newCards;
      this.saveCardsCache(this.allCards);

      if (prevCardId != null) {
        const idx = this.allCards.findIndex((c) => c.id === prevCardId);
        this.activeCardIndex = idx >= 0 ? idx : (data.active_index || 0);
      } else if (!preserveSelection) {
        this.activeCardIndex = typeof data.active_index === 'number' ? data.active_index : 0;
      }

      if (!this.allCards.length) {
        this.currentCard = null;
        this.cardDetailsRevealed = false;
        $('cardSelectorSection')?.classList.add('hidden');
        $('cardVisual')?.classList.add('hidden');
        $('cardPendingNotice')?.classList.add('hidden');
        if ($('cardBalanceDisplay')) $('cardBalanceDisplay').textContent = '—';
        if ($('sumCard')) $('sumCard').textContent = 'No card';
        this.updateCardStatusSummary(null);
        if (!silent) {
          showOutput('viewCardOutput', { message: 'No cards yet — request a virtual card below.' });
        }
        if (this._scheduleCardsPoll) this._scheduleCardsPoll();
        return;
      }

      if (this.activeCardIndex >= this.allCards.length) this.activeCardIndex = 0;

      // Avoid tearing down the Cards UI on silent polls when nothing changed
      if (!unchanged || forceRefresh || !silent) {
        this.renderCardSelector();
        this.renderActiveCard(this.allCards[this.activeCardIndex]);
        this.populateReloadCardSelect();
      }

      if (this._scheduleCardsPoll) this._scheduleCardsPoll();

      if (!silent) {
        showOutput('viewCardOutput', { cards: this.allCards.length, active: this.allCards[this.activeCardIndex] });
      }
    } catch (err) {
      if (err.code === 'SENSITIVE_AUTH_REQUIRED') {
        if (!this.allCards.length) this.applyCachedCardsIfAvailable();
        $('pinUnlockModal')?.classList.remove('hidden');
        if ($('sumCard') && !this.allCards.length) $('sumCard').textContent = '🔒 Locked';
        if (!this.allCards.length) this.updateCardStatusSummary(null);
      } else if (!silent) {
        // Soft errors: keep existing cards on screen so the page doesn't blank out
        if (err.message?.includes('404') || err.message?.includes('No cards')) {
          this.allCards = [];
          this.currentCard = null;
          this.clearCardsCache();
          $('cardSelectorSection')?.classList.add('hidden');
          $('cardVisual')?.classList.add('hidden');
          if ($('sumCard')) $('sumCard').textContent = 'No card';
          this.updateCardStatusSummary(null);
        }
        showOutput('viewCardOutput', err.message, true);
      } else {
        console.warn('[Dashboard] silent loadAllCards failed:', err.message);
      }
    } finally {
      this._cardsLoading = false;
      const queued = this._cardsLoadQueued;
      this._cardsLoadQueued = null;
      if (queued) {
        // Replay any refresh that arrived while we were loading
        await this.loadAllCards(queued);
      }
    }
  },

  /** @deprecated use loadAllCards */
  async loadCard() {
    return this.loadAllCards();
  },

  clearStaleDepositDrafts() {
    ['eisy_pending_deposit', 'eisy_deposit_drafts', 'eisy_test_deposits', 'eisy_deposit_receipt'].forEach((key) => {
      try { localStorage.removeItem(key); } catch (_) { /* ignore */ }
    });
  },

  readReceiptFileAsDataUrl(file, {
    onLoad,
    onError,
  } = {}) {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof onLoad === 'function') onLoad(reader.result);
    };
    reader.onerror = () => {
      const msg = 'Could not read the selected receipt file';
      if (typeof onError === 'function') onError(msg);
      else this.toast(msg, 'error');
    };
    reader.readAsDataURL(file);
  },

  async submitDepositProof({
    depositId,
    txnId,
    userNote,
    fileInput,
    base64,
    filename,
    requireReceipt = false,
  } = {}) {
    if (!depositId) throw new Error('Deposit ID is missing');
    if (!txnId) throw new Error('Transaction ID is required');

    const file = fileInput?.files?.[0] || null;
    const receiptBase64 = base64 || null;

    if (requireReceipt && !file && !receiptBase64) {
      throw new Error('Please upload a payment receipt screenshot before submitting');
    }

    if (file) {
      const formData = new FormData();
      formData.append('deposit_id', depositId);
      formData.append('kpay_transaction_id', txnId);
      if (userNote) formData.append('user_note', userNote);
      formData.append('screenshot', file, file.name || filename || 'receipt.jpg');
      return Auth.apiForm('/api/deposit/submit', formData, { sensitive: true });
    }

    const body = {
      deposit_id: parseInt(depositId, 10),
      kpay_transaction_id: txnId,
    };
    if (userNote) body.user_note = userNote;
    if (receiptBase64) {
      body.screenshot_base64 = receiptBase64;
      body.receipt_base64 = receiptBase64;
      body.screenshot_filename = filename || 'receipt.jpg';
    }

    return Auth.api('POST', '/api/deposit/submit', body, { sensitive: true });
  },

  previewDepositScreenshot() {
    const fileInput = $('depositScreenshot');
    const file = fileInput.files?.[0];
    if (!file) {
      this.clearDepositScreenshotPreview();
      return;
    }

    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');
    if (!isImage && !isVideo) {
      this.toast('Please select an image or video file', 'error');
      fileInput.value = '';
      return;
    }

    this.clearDepositScreenshotPreview(false);
    this._depositReceiptFile = file;

    this.readReceiptFileAsDataUrl(file, {
      onLoad: (dataUrl) => {
        this._depositReceiptBase64 = dataUrl;
        this._depositReceiptUrl = dataUrl;
        this._proofPreviewUrl = dataUrl;
        this._proofPreviewName = file.name;
        this._proofPreviewType = isVideo ? 'video' : 'image';

        const img = $('depositScreenshotImg');
        const video = $('depositProofVideo');

        if (isImage) {
          if (img) {
            img.src = dataUrl;
            img.classList.remove('hidden');
          }
          video?.classList.add('hidden');
        } else {
          if (video) {
            video.src = dataUrl;
            video.classList.remove('hidden');
          }
          img?.classList.add('hidden');
        }

        $('depositScreenshotPreview')?.classList.remove('hidden');
        $('btnExpandProofPreview')?.classList.toggle('hidden', !isImage);
      },
    });
  },

  clearDepositScreenshotPreview(revoke = true) {
    const img = $('depositScreenshotImg');
    const video = $('depositProofVideo');

    if (revoke && this._proofPreviewUrl && String(this._proofPreviewUrl).startsWith('blob:')) {
      URL.revokeObjectURL(this._proofPreviewUrl);
    }
    this._proofPreviewUrl = null;
    this._proofPreviewName = null;
    this._proofPreviewType = null;
    this._depositReceiptBase64 = null;
    this._depositReceiptUrl = null;
    this._depositReceiptFile = null;

    if (img) {
      if (img.src?.startsWith('blob:')) URL.revokeObjectURL(img.src);
      img.src = '';
      img.classList.add('hidden');
    }

    if (video) {
      video.pause();
      if (video.src?.startsWith('blob:')) URL.revokeObjectURL(video.src);
      video.removeAttribute('src');
      video.load();
      video.classList.add('hidden');
    }

    if ($('depositScreenshot')) $('depositScreenshot').value = '';
    $('btnExpandProofPreview')?.classList.add('hidden');
    $('depositScreenshotPreview')?.classList.add('hidden');
  },

  openProofLightbox(src, caption, type = 'image') {
    const img = $('proofLightboxImg');
    const video = $('proofLightboxVideo');

    if (type === 'video') {
      img.classList.add('hidden');
      img.removeAttribute('src');
      video.src = src;
      video.classList.remove('hidden');
      video.play().catch(() => {});
    } else {
      video.pause();
      video.classList.add('hidden');
      video.removeAttribute('src');
      video.load();
      img.src = src;
      img.classList.remove('hidden');
    }

    $('proofLightboxCaption').textContent = caption || '';
    $('proofLightbox').classList.remove('hidden');
  },

  closeProofLightbox() {
    const video = $('proofLightboxVideo');
    video.pause();
    video.classList.add('hidden');
    video.removeAttribute('src');
    video.load();
    $('proofLightboxImg').classList.add('hidden');
    $('proofLightboxImg').src = '';
    $('proofLightbox').classList.add('hidden');
  },

  startPolling(ref) {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = setInterval(async () => {
      try {
        const { deposit } = await Auth.api('GET', `/api/deposit/status/${ref}`);
        if (deposit.status === 'VERIFIED') {
          clearInterval(this.pollTimer);
          $('depositStatus').textContent = 'Payment Verified!';
          $('depositStatus').className = 'status-line ok';
          this.loadWallet();
          this.loadTransactions();
          this.loadDepositHistory();
        } else if (deposit.status === 'SUBMITTED' || deposit.status === 'UNDER_REVIEW') {
          $('depositStatus').textContent = 'Under admin review…';
          this.loadDepositHistory();
        }
      } catch (_) {}
    }, 3000);
  },

  log(msg, type) {
    const logEl = $('activityLog');
    if (!logEl) {
      console.log(`[Activity] ${msg}`);
      return;
    }
    const el = document.createElement('div');
    el.className = 'log-entry';
    el.innerHTML = `<span class="log-time">${new Date().toLocaleTimeString()}</span><span class="${type === 'error' ? 'log-err' : 'log-ok'}">${msg}</span>`;
    logEl.prepend(el);
  },
};

function showOutput(id, data, err) {
  const el = $(id);
  if (!el || el.classList.contains('hidden')) return;
  el.textContent = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  el.style.color = err ? '#ef4444' : '#8b9cb3';
}

document.addEventListener('DOMContentLoaded', () => {
  try {
    Dashboard.init();
  } catch (err) {
    console.error('[Dashboard] Fatal startup error:', err);
  }
});
