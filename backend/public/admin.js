/* Eisy Myanmar — Admin dashboard (dev: no login gate) */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const DEFAULT_DEV_KEY = 'eisy-admin-dev-key';

  const Admin = {
    key: DEFAULT_DEV_KEY,
    activeThreadId: null,
    depositsById: {},
    pendingCardsById: {},
    issuedCardsById: {},
    cardFormEditMode: false,
    pendingReloadsById: {},
    pricingSettings: null,
    kycDocsBySubmissionId: {},

    init() {
      try {
        this.ensureVisible();
        this.key = localStorage.getItem('eisy_admin_key') || DEFAULT_DEV_KEY;
        try {
          localStorage.setItem('eisy_admin_key', this.key);
        } catch (_) {
          /* localStorage blocked — continue with in-memory key */
        }
        this.bindEvents();
        this.bindNavigation();
        this.bindI18n();
        this.initSupabase().catch((err) => console.warn('[Admin] Supabase init:', err.message));
        this.loadAll();
      } catch (err) {
        console.error('[Admin] init failed:', err);
        this.showBootError(err);
      }
    },

    ensureVisible() {
      const app = $('adminApp');
      const login = $('adminLogin');
      if (app) {
        app.classList.remove('hidden');
        app.style.display = 'block';
      }
      if (login) login.classList.add('hidden');
    },

    showBootError(err) {
      this.ensureVisible();
      const box = $('adminBootError');
      const message = err && err.message ? err.message : String(err);
      if (box) {
        box.textContent = 'Admin dashboard failed to start: ' + message;
        box.classList.add('visible');
      }
      const table = $('depositsTable');
      if (table) {
        table.innerHTML = '<p class="hint" style="color:#ef4444">Dashboard error: ' + this.esc(message) + '</p>';
      }
    },

    headers() {
      return {
        'Content-Type': 'application/json',
        'X-Admin-Key': this.key || DEFAULT_DEV_KEY,
      };
    },

    async api(method, path, body) {
      const res = await fetch(path, {
        method,
        headers: this.headers(),
        body: body != null ? JSON.stringify(body) : undefined,
      });
      let data = {};
      try {
        data = await res.json();
      } catch (_) {
        data = {};
      }
      if (!res.ok) {
        throw new Error(data.error || res.statusText || ('HTTP ' + res.status));
      }
      return data;
    },

    switchTab(name) {
      if (typeof AppNav !== 'undefined' && AppNav.navigate) {
        AppNav.navigate(name, { pushHash: true });
        return;
      }
      this._showTabPanel(name);
    },

    _showTabPanel(name) {
      if (name === 'deposits') {
        this.loadDeposits();
        this.loadP2pBuyOrders();
        this.loadP2pDisputes();
        this.loadP2pSellOrders();
        this.loadUsdtWithdrawals();
        this.loadMmkWithdrawals();
      }
      if (name === 'support') this.loadSupportThreads();
      if (name === 'cards') {
        this.loadPendingCards();
        this.loadIssuedCards();
        this.loadPendingReloads();
      }
      if (name === 'settings') {
        this.loadSettings();
        this.loadExchangeRateHistory();
      }
      if (name === 'kyc-requests') {
        this.loadKycRequests();
      }
      if (name === 'revenue') {
        this.loadRevenueDashboard();
      }
      if (name === 'transactions') {
        this.loadTransactions();
      }
    },

    bindNavigation() {
      if (typeof AppNav === 'undefined') return;
      AppNav.init({
        root: $('adminAppShell') || document,
        navSelector: '.sidebar-nav [data-page]',
        pageSelector: '.app-page[data-page]',
        defaultPage: 'deposits',
        hashPrefix: 'admin-',
        onChange: (page) => this._showTabPanel(page),
      });
    },

    bindEvents() {
      const refreshBtn = $('adminRefreshBtn');
      if (refreshBtn) refreshBtn.addEventListener('click', () => this.loadAll());

      $('btnRefreshRevenue')?.addEventListener('click', () => this.loadRevenueDashboard());

      const depositFilter = $('depositFilter');
      if (depositFilter) depositFilter.addEventListener('change', () => this.loadDeposits());

      $('usdtWithdrawalFilter')?.addEventListener('change', () => this.loadUsdtWithdrawals());
      $('mmkWithdrawalFilter')?.addEventListener('change', () => this.loadMmkWithdrawals());

      const usdtWdTable = $('usdtWithdrawalsTable');
      if (usdtWdTable) {
        usdtWdTable.addEventListener('click', (e) => {
          const complete = e.target.closest('[data-action="complete-usdt-wd"]');
          const reject = e.target.closest('[data-action="reject-usdt-wd"]');
          if (complete) {
            this.reviewUsdtWithdrawal(complete.getAttribute('data-id'), 'complete', { triggerBtn: complete });
            return;
          }
          if (reject) {
            this.reviewUsdtWithdrawal(reject.getAttribute('data-id'), 'reject', { triggerBtn: reject });
          }
        });
      }

      const mmkWdTable = $('mmkWithdrawalsTable');
      if (mmkWdTable) {
        mmkWdTable.addEventListener('click', (e) => {
          const complete = e.target.closest('[data-action="complete-mmk-wd"]');
          const reject = e.target.closest('[data-action="reject-mmk-wd"]');
          if (complete) {
            this.reviewMmkWithdrawal(complete.getAttribute('data-id'), 'complete', { triggerBtn: complete });
            return;
          }
          if (reject) {
            this.reviewMmkWithdrawal(reject.getAttribute('data-id'), 'reject', { triggerBtn: reject });
          }
        });
      }

      const depositsTable = $('depositsTable');
      if (depositsTable) {
        depositsTable.addEventListener('click', (e) => {
          const approve = e.target.closest('[data-action="approve-deposit"]');
          const reject = e.target.closest('[data-action="reject-deposit"]');
          const viewReceipt = e.target.closest('[data-action="view-deposit-receipt"]');
          const proof = e.target.closest('.proof-thumb-btn');

          if (viewReceipt) {
            e.preventDefault();
            this.openDepositReceiptModal(viewReceipt.dataset.id);
          } else if (approve) {
            e.preventDefault();
            e.stopPropagation();
            if (approve.disabled) return;
            this.reviewDeposit(approve.dataset.id, 'approve', { triggerBtn: approve });
          } else if (reject) {
            e.preventDefault();
            e.stopPropagation();
            if (reject.disabled) return;
            this.reviewDeposit(reject.dataset.id, 'reject', { triggerBtn: reject });
          } else if (proof) {
            e.preventDefault();
            this.openProofLightbox(proof.dataset.src, proof.dataset.caption, proof.dataset.type || 'image');
          }
        });
      }

      $('depositReceiptReviewClose')?.addEventListener('click', () => this.closeDepositReceiptModal());
      $('depositReceiptReviewModal')?.querySelector('.deposit-receipt-review-backdrop')
        ?.addEventListener('click', () => this.closeDepositReceiptModal());
      $('depositReceiptApprove')?.addEventListener('click', () => {
        if (this.activeDepositReceiptId) {
          const btn = $('depositReceiptApprove');
          this.reviewDeposit(this.activeDepositReceiptId, 'approve', {
            closeReceiptModal: true,
            triggerBtn: btn,
          });
        }
      });
      $('depositReceiptReject')?.addEventListener('click', () => {
        if (this.activeDepositReceiptId) {
          const btn = $('depositReceiptReject');
          this.reviewDeposit(this.activeDepositReceiptId, 'reject', {
            closeReceiptModal: true,
            triggerBtn: btn,
          });
        }
      });
      const depositReceiptImg = $('depositReceiptImg');
      if (depositReceiptImg) {
        depositReceiptImg.addEventListener('error', () => this.showDepositReceiptPlaceholder());
      }

      const issueForm = $('issueCardAdminForm');
      if (issueForm) {
        issueForm.addEventListener('submit', (e) => {
          e.preventDefault();
          this.submitIssueCardAdminForm();
        });
      }
      $('issueCardAdminReset')?.addEventListener('click', () => this.resetIssueCardAdminForm());

      const balanceForm = $('balanceAdjustForm');
      if (balanceForm) {
        balanceForm.addEventListener('submit', async (e) => {
          e.preventDefault();
          const out = $('balanceAdjustOut');
          try {
            const data = await this.api('POST', '/api/admin/balance/adjust', {
              user_id: parseInt($('adjUserId').value, 10),
              amount_mmk: parseFloat($('adjAmountMmk').value),
              wallet_type: 'mmk',
              reason: $('adjReason').value.trim() || 'Admin MMK adjustment',
            });
            if (out) out.textContent = JSON.stringify(data, null, 2);
            this.loadUsers();
            this.loadTransactions();
          } catch (err) {
            if (out) out.textContent = err.message;
          }
        });
      }

      const balanceUsdtForm = $('balanceAdjustUsdtForm');
      if (balanceUsdtForm) {
        balanceUsdtForm.addEventListener('submit', async (e) => {
          e.preventDefault();
          const out = $('balanceAdjustOut');
          try {
            const data = await this.api('POST', '/api/admin/balance/adjust', {
              user_id: parseInt($('adjUsdtUserId').value, 10),
              amount_usdt: parseFloat($('adjAmountUsdt').value),
              wallet_type: 'usdt',
              reason: $('adjUsdtReason').value.trim() || 'Admin USDT adjustment',
            });
            if (out) out.textContent = JSON.stringify(data, null, 2);
            this.loadUsers();
            this.loadTransactions();
          } catch (err) {
            if (out) out.textContent = err.message;
          }
        });
      }

      const balanceUsdForm = $('balanceAdjustUsdForm');
      if (balanceUsdForm) {
        balanceUsdForm.addEventListener('submit', async (e) => {
          e.preventDefault();
          const out = $('balanceAdjustOut');
          try {
            const data = await this.api('POST', '/api/admin/balance/adjust', {
              user_id: parseInt($('adjUsdUserId').value, 10),
              amount_usd: parseFloat($('adjAmount').value),
              wallet_type: 'usd',
              reason: $('adjReason')?.value.trim() || 'Admin USD adjustment',
            });
            if (out) out.textContent = JSON.stringify(data, null, 2);
            this.loadUsers();
          } catch (err) {
            if (out) out.textContent = err.message;
          }
        });
      }

      const txFilterBtn = $('txFilterBtn');
      if (txFilterBtn) txFilterBtn.addEventListener('click', () => this.loadTransactions());

      const txCategoryTabs = $('txCategoryTabs');
      if (txCategoryTabs) {
        this.txCategory = this.txCategory || 'p2p';
        txCategoryTabs.querySelectorAll('[data-tx-category]').forEach((btn) => {
          btn.addEventListener('click', () => {
            this.txCategory = btn.dataset.txCategory || 'p2p';
            txCategoryTabs.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
            btn.classList.add('active');
            this.loadTransactions();
          });
        });
      }

      const pendingCardsTable = $('pendingCardsTable');
      if (pendingCardsTable) {
        pendingCardsTable.addEventListener('click', (e) => {
          const issue = e.target.closest('[data-action="issue-card"]');
          const reject = e.target.closest('[data-action="reject-card"]');
          const proof = e.target.closest('.proof-thumb-btn');

          if (issue) {
            e.preventDefault();
            this.openIssueCardModal(parseInt(issue.dataset.id, 10));
          } else if (reject) {
            e.preventDefault();
            this.rejectPendingCard(parseInt(reject.dataset.id, 10));
          } else if (proof) {
            e.preventDefault();
            this.openProofLightbox(proof.dataset.src, proof.dataset.caption, proof.dataset.type || 'image');
          }
        });
      }

      $('issueCardModalClose')?.addEventListener('click', () => this.closeIssueCardModal());
      $('issueCardModalCancel')?.addEventListener('click', () => this.closeIssueCardModal());
      $('issueCardModal')?.querySelector('.issue-card-modal-backdrop')
        ?.addEventListener('click', () => this.closeIssueCardModal());
      $('issueCardModalForm')?.addEventListener('submit', (e) => {
        e.preventDefault();
        this.submitIssueCardModal();
      });

      const pendingReloadsTable = $('pendingReloadsTable');
      if (pendingReloadsTable) {
        pendingReloadsTable.addEventListener('click', (e) => {
          const approve = e.target.closest('[data-action="approve-reload"]');
          const reject = e.target.closest('[data-action="reject-reload"]');
          if (approve) {
            e.preventDefault();
            this.approvePendingReload(parseInt(approve.dataset.id, 10));
          } else if (reject) {
            e.preventDefault();
            this.rejectPendingReload(parseInt(reject.dataset.id, 10));
          }
        });
      }

      const issuedCardsTable = $('issuedCardsTable');
      if (issuedCardsTable) {
        issuedCardsTable.addEventListener('click', (e) => {
          const editBtn = e.target.closest('[data-action="edit-card"]');
          const statusBtn = e.target.closest('[data-action="update-card-status"]');
          if (editBtn) {
            e.preventDefault();
            const cardId = parseInt(editBtn.dataset.id, 10);
            const card = this.issuedCardsById[cardId];
            if (card) this.openEditCardForm(card);
            return;
          }
          if (statusBtn) {
            e.preventDefault();
            const cardId = parseInt(statusBtn.dataset.id, 10);
            const row = statusBtn.closest('tr');
            const select = row?.querySelector('[data-card-status-select]');
            const reasonInput = row?.querySelector('[data-card-status-reason]');
            if (!select) return;
            this.updateIssuedCardStatus(cardId, select.value, reasonInput?.value?.trim() || '');
          }
        });
      }

      const usersTable = $('usersTable');
      if (usersTable) {
        usersTable.addEventListener('click', (e) => {
          const btn = e.target.closest('.view-card-requests');
          if (!btn) return;
          this.switchTab('cards');
        });
      }

      const supportReplyForm = $('supportReplyForm');
      if (supportReplyForm) {
        supportReplyForm.addEventListener('submit', async (e) => {
          e.preventDefault();
          if (!this.activeThreadId) return;
          try {
            await this.api('POST', '/api/admin/support/threads/' + this.activeThreadId + '/reply', {
              message: $('supportReplyText').value.trim(),
            });
            $('supportReplyText').value = '';
            this.openThread(this.activeThreadId);
          } catch (err) {
            alert(err.message);
          }
        });
      }

      const supportCloseBtn = $('supportCloseBtn');
      if (supportCloseBtn) {
        supportCloseBtn.addEventListener('click', async () => {
          if (!this.activeThreadId) return;
          try {
            await this.api('POST', '/api/admin/support/threads/' + this.activeThreadId + '/close', {});
            this.activeThreadId = null;
            const replyForm = $('supportReplyForm');
            if (replyForm) replyForm.classList.add('hidden');
            this.loadSupportThreads();
          } catch (err) {
            alert(err.message);
          }
        });
      }

      const kycViewerClose = $('kycDocumentViewerClose');
      if (kycViewerClose) kycViewerClose.addEventListener('click', () => this.closeKycDocumentViewer());

      const kycViewerModal = $('kycDocumentViewerModal');
      if (kycViewerModal) {
        const kycBackdrop = kycViewerModal.querySelector('.kyc-doc-viewer-backdrop');
        if (kycBackdrop) kycBackdrop.addEventListener('click', () => this.closeKycDocumentViewer());
        const kycImg = $('kycDocumentViewerImg');
        if (kycImg) {
          kycImg.addEventListener('error', () => this.showKycDocumentPlaceholder('Unable to load document image'));
        }
      }

      const proofClose = $('adminProofLightboxClose');
      if (proofClose) proofClose.addEventListener('click', () => this.closeProofLightbox());

      const lightbox = $('adminProofLightbox');
      if (lightbox) {
        const backdrop = lightbox.querySelector('.admin-proof-backdrop');
        if (backdrop) backdrop.addEventListener('click', () => this.closeProofLightbox());
      }

      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          this.closeIssueCardModal();
          this.closeDepositReceiptModal();
          this.closeKycDocumentViewer();
          this.closeP2pDisputeReviewModal();
          this.closeProofLightbox();
        }
      });

      $('p2pDisputeReviewClose')?.addEventListener('click', () => this.closeP2pDisputeReviewModal());
      $('p2pDisputeReviewModal')?.querySelector('.p2p-dispute-review-backdrop')
        ?.addEventListener('click', () => this.closeP2pDisputeReviewModal());

      const settingsForm = $('adminSettingsForm');
      if (settingsForm) {
        settingsForm.addEventListener('submit', async (e) => {
          e.preventDefault();
          const out = $('adminSettingsOut');
          try {
            const data = await this.api('PUT', '/api/admin/settings', {
              mmk_to_usd_rate: parseFloat($('settingExchangeRate').value),
              effective_date: $('settingEffectiveDate').value,
              card_issuance_fee_usd: parseFloat($('settingCardFee').value),
              minimum_initial_deposit_usd: parseFloat($('settingMinDeposit').value),
              card_reload_fee_usd: parseFloat($('settingReloadFee')?.value || '1'),
              minimum_card_reload_mmk: parseFloat($('settingMinReloadMmk')?.value || '10000'),
              minimum_usdt_deposit: parseFloat($('settingMinUsdtDeposit')?.value || '5'),
              minimum_usdt_reload: parseFloat($('settingMinUsdtReload')?.value || '5'),
              p2p_seller_fee_percent: parseFloat($('settingP2pSellerFee')?.value || '1'),
              usdt_trc20_address: $('settingUsdtTrc20')?.value?.trim(),
              usdt_bep20_address: $('settingUsdtBep20')?.value?.trim(),
              usdt_withdraw_fee_trc20: parseFloat($('settingWithdrawFeeTrc20')?.value || '2'),
              usdt_withdraw_fee_bep20: parseFloat($('settingWithdrawFeeBep20')?.value || '2'),
              usdt_withdraw_fee_trc20_type: $('settingWithdrawFeeTrc20Type')?.value || 'percent',
              usdt_withdraw_fee_bep20_type: $('settingWithdrawFeeBep20Type')?.value || 'percent',
              usdt_withdraw_fee_bank: parseFloat($('settingWithdrawFeeBank')?.value || '2'),
              usdt_withdraw_fee_bank_type: $('settingWithdrawFeeBankType')?.value || 'percent',
              minimum_usdt_withdrawal: parseFloat($('settingMinUsdtWithdrawal')?.value || '10'),
              minimum_mmk_withdrawal: parseFloat($('settingMinMmkWithdrawal')?.value || '10000'),
              mmk_withdraw_fee_percent: parseFloat($('settingPaymentFeePercent')?.value || $('settingMmkWithdrawFeePercent')?.value || '2'),
              payment_service_fee_percent: parseFloat($('settingPaymentFeePercent')?.value || '2'),
              payment_service_fee_minimum_usdt: parseFloat($('settingPaymentFeeMinUsdt')?.value || '1'),
              notes: $('settingNotes')?.value?.trim() || undefined,
              updated_by: $('settingUpdatedBy')?.value?.trim() || 'admin',
            });
            if (out) out.textContent = JSON.stringify(data, null, 2);
            this.pricingSettings = data.pricing;
            this.updateRateBadge(data.current_rate);
            this.loadExchangeRateHistory();
            await this.loadSettings();
          } catch (err) {
            if (out) out.textContent = err.message;
          }
        });
      }

      $('kycStatusFilter')?.addEventListener('change', () => this.loadKycRequests());
      $('btnRefreshKycRequests')?.addEventListener('click', () => this.loadKycRequests());
      $('kycRequestsTable')?.addEventListener('click', (e) => {
        const approve = e.target.closest('[data-kyc-approve]');
        const reject = e.target.closest('[data-kyc-reject]');
        const viewDoc = e.target.closest('[data-kyc-view]');
        if (approve) this.approveKycRequest(parseInt(approve.dataset.id, 10));
        if (reject) this.rejectKycRequest(parseInt(reject.dataset.id, 10));
        if (viewDoc) {
          e.preventDefault();
          e.stopPropagation();
          const submissionId = parseInt(viewDoc.dataset.submissionId, 10);
          const docType = viewDoc.dataset.doc;
          this.openKycDocumentFromTable(submissionId, docType);
        }
      });

      const p2pDisputesTable = $('p2pDisputesTable');
      if (p2pDisputesTable) {
        p2pDisputesTable.addEventListener('click', (e) => {
          const review = e.target.closest('[data-action="review-p2p-dispute"]');
          if (review) {
            e.preventDefault();
            e.stopPropagation();
            const key = review.dataset.disputeKey;
            const dispute = this._p2pDisputeByKey?.[key];
            if (dispute) this.openP2pDisputeReviewModal(dispute);
            return;
          }
          const release = e.target.closest('[data-action="resolve-p2p-dispute-release"]');
          const refund = e.target.closest('[data-action="resolve-p2p-dispute-refund"]');
          if (!release && !refund) return;
          e.preventDefault();
          e.stopPropagation();
          const btn = release || refund;
          if (btn.disabled) return;
          const orderType = btn.dataset.orderType;
          const orderId = parseInt(btn.dataset.id, 10);
          const resolution = release ? 'force_release' : 'refund';
          this.resolveP2pDispute(orderType, orderId, resolution, btn);
        });
      }

      const p2pBuyOrdersTable = $('p2pBuyOrdersTable');
      if (p2pBuyOrdersTable) {
        p2pBuyOrdersTable.addEventListener('click', (e) => {
          const proofBtn = e.target.closest('[data-action="view-p2p-payment-proof"]');
          if (proofBtn) {
            e.preventDefault();
            const src = proofBtn.dataset.proofSrc;
            const type = proofBtn.dataset.proofType || 'image';
            if (src) this.openProofLightbox(src, 'Buyer payment proof', type);
            return;
          }
          const release = e.target.closest('[data-action="release-p2p-buy"]');
          const reject = e.target.closest('[data-action="reject-p2p-buy"]');
          if (release) this.releaseP2pBuyOrder(parseInt(release.dataset.id, 10));
          if (reject) this.rejectP2pBuyOrder(parseInt(reject.dataset.id, 10));
        });
      }

      const p2pSellOrdersTable = $('p2pSellOrdersTable');
      if (p2pSellOrdersTable) {
        p2pSellOrdersTable.addEventListener('click', (e) => {
          const reject = e.target.closest('[data-action="reject-p2p-sell"]');
          if (reject) this.rejectP2pSellOrder(parseInt(reject.dataset.id, 10));
        });
      }
    },

    bindI18n() {
      document.addEventListener('eisy:langchange', () => this.onLanguageChange());
    },

    async initSupabase() {
      if (typeof window.SupabaseBridge === 'undefined') {
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      if (!window.SupabaseBridge) return;
      await window.SupabaseBridge.init();
      if (!window.SupabaseBridge.isReady()) return;
      window.SupabaseBridge.subscribeAdmin({
        onDeposits: () => this.scheduleDepositsRefresh(),
        onCards: () => this.loadPendingCards(),
        onReloads: () => this.loadPendingReloads(),
        onWallets: () => {},
      });
    },

    scheduleDepositsRefresh() {
      clearTimeout(this._depositsRefreshTimer);
      this._depositsRefreshTimer = setTimeout(() => {
        // Prefer API after realtime events so status changes stick
        this.loadDeposits({ forceApi: true });
      }, 350);
    },

    onLanguageChange() {
      if (typeof I18n !== 'undefined') I18n.apply(document);
      if (typeof AppNav !== 'undefined' && AppNav.currentPage) {
        const titleEl = document.querySelector(`[data-page-title="${AppNav.currentPage}"]`);
        const heading = document.querySelector('.page-heading');
        if (titleEl && heading) {
          const key = titleEl.getAttribute('data-i18n');
          if (key && typeof t === 'function') heading.textContent = t(key);
        }
      }
      this.setIssueCardFormEditMode(this.cardFormEditMode);
      if (this.pricingSettings) this.updateRateBadge(this.pricingSettings);
      this.loadPendingCards();
      this.loadIssuedCards();
      this.loadPendingReloads();
      this.loadDeposits();
    },

    loadAll() {
      return Promise.allSettled([
        this.loadPricingSettings(),
        this.loadDeposits(),
        this.loadP2pDisputes(),
        this.loadP2pBuyOrders(),
        this.loadP2pSellOrders(),
        this.loadUsdtWithdrawals(),
        this.loadMmkWithdrawals(),
        this.loadPendingCards(),
        this.loadIssuedCards(),
        this.loadPendingReloads(),
        this.loadUsers(),
        this.loadTransactions(),
      ]);
    },

    async loadPricingSettings() {
      try {
        const data = await this.api('GET', '/api/admin/settings');
        this.pricingSettings = data.pricing || null;
        this.updateRateBadge(data.current_rate);
      } catch (_) {
        this.pricingSettings = {
          card_issuance_fee_usd: 5,
          minimum_initial_deposit_usd: 10,
          mmk_to_usd_rate: 4500,
        };
      }
    },

    updateRateBadge(currentRate) {
      const badge = $('adminCurrentRateBadge');
      if (!badge) return;

      const rate = currentRate || {};
      const mmk = Number(rate.mmk_to_usd_rate || this.pricingSettings?.mmk_to_usd_rate || 0);
      const effDate = rate.effective_date
        || rate.effective_at?.slice(0, 10)
        || this.pricingSettings?.rate_effective_date
        || 'today';

      if (!mmk) {
        badge.textContent = typeof t === 'function' ? `${t('current_rate')}: not set` : 'Current Rate: not set';
        return;
      }

      const prefix = typeof t === 'function' ? t('current_rate') : 'Current Rate';
      badge.textContent = `${prefix}: 1 USD = ${mmk.toLocaleString()} MMK (Effective: ${effDate})`;
    },

    todayDateInputValue() {
      return new Date().toISOString().slice(0, 10);
    },

    statusBadge(status) {
      const s = String(status || '').toUpperCase();
      const cls = {
        VERIFIED: 'ok', ACTIVE: 'ok', APPROVED: 'ok', COMPLETED: 'ok',
        SUBMITTED: 'warn', UNDER_REVIEW: 'warn', PENDING: 'warn', AWAITING_SCREENSHOT: 'warn',
        SUSPENDED: 'warn',
        FROZEN: 'muted',
        REJECTED: 'err', FAILED: 'err', CANCELLED: 'err', EXPIRED: 'err', TERMINATED: 'err',
      }[s] || 'muted';
      return '<span class="badge badge-' + cls + '">' + this.esc(status) + '</span>';
    },

    cardStatusBadge(status) {
      const label = String(status || 'UNKNOWN').toUpperCase();
      const cls = {
        ACTIVE: 'ok',
        SUSPENDED: 'warn',
        FROZEN: 'muted',
        TERMINATED: 'err',
        PENDING_ISSUANCE: 'warn',
      }[label] || 'muted';
      return '<span class="badge badge-' + cls + '">' + this.esc(label) + '</span>';
    },

    isValidKycDocumentSrc(src) {
      if (src == null) return false;
      const trimmed = String(src).trim();
      if (!trimmed) return false;
      const lower = trimmed.toLowerCase();
      const dummyValues = new Set([
        'null', 'undefined', 'none', 'n/a', 'na', 'dummy', 'mock',
        'placeholder', 'no image', 'no document', 'sample', 'test',
      ]);
      if (dummyValues.has(lower)) return false;
      if (lower.startsWith('data:image/')) return true;
      if (/^https?:\/\//i.test(trimmed)) return true;
      if (trimmed.startsWith('/uploads/')) return true;
      if (trimmed.startsWith('uploads/')) return true;
      return false;
    },

    normalizeKycDocumentUrl(src) {
      if (!this.isValidKycDocumentSrc(src)) return null;
      const trimmed = String(src).trim();
      if (trimmed.startsWith('data:') || /^https?:\/\//i.test(trimmed)) return trimmed;
      return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
    },

    openKycDocumentFromTable(submissionId, docType) {
      const cached = this.kycDocsBySubmissionId?.[submissionId];
      if (!cached) return;
      const docKey = docType === 'front' ? 'front' : docType === 'back' ? 'back' : 'selfie';
      const labelMap = { front: 'Front of ID', back: 'Back of ID', selfie: 'Selfie with ID' };
      this.openKycDocumentViewer({
        src: cached[docKey],
        label: labelMap[docKey] || 'KYC Document',
        userName: cached.userName,
      });
    },

    openKycDocumentViewer({ src, label, userName } = {}) {
      const modal = $('kycDocumentViewerModal');
      const titleEl = $('kycDocumentViewerTitle');
      const captionEl = $('kycDocumentViewerCaption');
      const imgEl = $('kycDocumentViewerImg');
      if (!modal || !imgEl) return;

      const resolvedUrl = this.normalizeKycDocumentUrl(src);
      const title = label || 'KYC Document';
      if (titleEl) {
        titleEl.textContent = userName ? `${title} — ${userName}` : title;
      }
      if (captionEl) {
        captionEl.textContent = resolvedUrl
          ? (resolvedUrl.startsWith('data:') ? `${title} (uploaded image)` : resolvedUrl)
          : '';
      }

      if (!resolvedUrl) {
        this.showKycDocumentPlaceholder('No document image attached');
      } else {
        this.hideKycDocumentPlaceholder();
        imgEl.alt = title;
        imgEl.src = resolvedUrl;
        imgEl.classList.remove('hidden');
      }

      modal.classList.remove('hidden');
      document.body.classList.add('sidebar-scroll-lock');
    },

    showKycDocumentPlaceholder(message) {
      const imgEl = $('kycDocumentViewerImg');
      const placeholder = $('kycDocumentViewerPlaceholder');
      const placeholderText = $('kycDocumentViewerPlaceholderText');
      if (imgEl) {
        imgEl.classList.add('hidden');
        imgEl.removeAttribute('src');
      }
      if (placeholderText) placeholderText.textContent = message || 'No document image attached';
      placeholder?.classList.remove('hidden');
    },

    hideKycDocumentPlaceholder() {
      $('kycDocumentViewerPlaceholder')?.classList.add('hidden');
    },

    closeKycDocumentViewer() {
      const modal = $('kycDocumentViewerModal');
      const imgEl = $('kycDocumentViewerImg');
      if (imgEl) {
        imgEl.classList.add('hidden');
        imgEl.removeAttribute('src');
      }
      this.hideKycDocumentPlaceholder();
      modal?.classList.add('hidden');
      document.body.classList.remove('sidebar-scroll-lock');
    },

    esc(text) {
      return String(text == null ? '' : text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/"/g, '&quot;');
    },

    renderProofCell(d) {
      const proofUrl = this.getDepositProofUrl(d);
      if (!proofUrl) return '';

      const src = this.esc(proofUrl);
      const caption = this.esc((d.ref_code || d.deposit_ref || 'Deposit') + ' · ' + (d.screenshot_original_name || 'Payment proof'));
      const type = this.getDepositProofType(d);

      if (type === 'video') {
        return '<button type="button" class="proof-thumb-btn" title="Preview video proof" data-src="' + src + '" data-caption="' + caption + '" data-type="video">' +
          '<video class="proof-thumb-video" src="' + src + '" muted preload="metadata" playsinline></video>' +
          '</button>';
      }

      return '<button type="button" class="proof-thumb-btn" title="Preview image proof" data-src="' + src + '" data-caption="' + caption + '" data-type="image">' +
        '<img src="' + src + '" alt="Proof" class="proof-thumb" />' +
        '</button>';
    },

    getDepositProofUrl(deposit) {
      if (!deposit) return null;
      const meta = deposit.metadata || {};
      return deposit.receiptUrl
        || deposit.receipt_url
        || deposit.proofUrl
        || deposit.proof_url
        || deposit.screenshot_url
        || deposit.screenshot_path
        || meta.receiptUrl
        || meta.receipt_url
        || meta.proofUrl
        || meta.proof_url
        || null;
    },

    getDepositProofType(deposit) {
      if (!deposit) return 'image';
      const url = this.getDepositProofUrl(deposit) || '';
      if (String(url).startsWith('data:video/')) return 'video';
      if (String(url).startsWith('data:image/')) return 'image';
      const mime = deposit.proof_mime_type || deposit.screenshot_mime_type || '';
      if (deposit.proof_type) return deposit.proof_type;
      if (String(mime).indexOf('video/') === 0) return 'video';
      if (/\.(mp4|webm|mov|avi)(\?|$)/i.test(url)) return 'video';
      return 'image';
    },

    isDepositPending(deposit) {
      return deposit && ['SUBMITTED', 'UNDER_REVIEW', 'PENDING'].indexOf(deposit.status) !== -1;
    },

    showDepositReceiptPlaceholder() {
      $('depositReceiptImg')?.classList.add('hidden');
      $('depositReceiptVideo')?.classList.add('hidden');
      const video = $('depositReceiptVideo');
      if (video) {
        video.pause();
        video.removeAttribute('src');
        video.load();
      }
      $('depositReceiptPlaceholder')?.classList.remove('hidden');
    },

    hideDepositReceiptPlaceholder() {
      $('depositReceiptPlaceholder')?.classList.add('hidden');
    },

    openDepositReceiptModal(depositId) {
      const deposit = this.depositsById[depositId] || this.depositsById[parseInt(depositId, 10)];
      if (!deposit) return;

      console.log('Selected Deposit:', deposit);

      this.activeDepositReceiptId = deposit.id;
      const modal = $('depositReceiptReviewModal');
      const metaEl = $('depositReceiptMeta');
      const captionEl = $('depositReceiptCaption');
      const actionsEl = $('depositReceiptActions');
      const imgEl = $('depositReceiptImg');
      const videoEl = $('depositReceiptVideo');
      const titleEl = $('depositReceiptReviewTitle');
      const placeholderEl = $('depositReceiptPlaceholder');

      if (titleEl) {
        titleEl.textContent = 'Deposit Receipt — ' + (deposit.ref_code || ('#' + deposit.id));
      }

      if (metaEl) {
        const mmk = Number(deposit.amount_mmk || 0).toLocaleString();
        const usd = Number(deposit.amount_usd || 0).toFixed(2);
        const method = deposit.payment_method || 'KBZPay';
        metaEl.innerHTML =
          '<div><dt>User ID</dt><dd>#' + this.esc(deposit.user_id) + '</dd></div>' +
          '<div><dt>User</dt><dd>' + this.esc(deposit.name || deposit.email || '—') + '</dd></div>' +
          '<div><dt>Amount (MMK)</dt><dd>' + mmk + ' MMK</dd></div>' +
          '<div><dt>Amount (USD)</dt><dd>$' + usd + '</dd></div>' +
          '<div><dt>Payment Method</dt><dd>' + this.esc(method) + '</dd></div>' +
          '<div><dt>Status</dt><dd>' + this.esc(deposit.status || '—') + '</dd></div>';
      }

      const receiptUrl = this.getDepositProofUrl(deposit);
      const proofType = this.getDepositProofType(deposit);

      if (imgEl) {
        imgEl.classList.add('hidden');
        imgEl.removeAttribute('src');
      }
      if (videoEl) {
        videoEl.pause();
        videoEl.classList.add('hidden');
        videoEl.removeAttribute('src');
        videoEl.load();
      }

      if (receiptUrl && proofType === 'video') {
        this.hideDepositReceiptPlaceholder();
        if (videoEl) {
          videoEl.src = receiptUrl;
          videoEl.classList.remove('hidden');
        }
      } else if (receiptUrl) {
        this.hideDepositReceiptPlaceholder();
        if (imgEl) {
          imgEl.src = receiptUrl;
          imgEl.alt = 'Deposit Receipt';
          imgEl.style.maxWidth = '100%';
          imgEl.style.maxHeight = '400px';
          imgEl.style.objectFit = 'contain';
          imgEl.classList.remove('hidden');
        }
      } else {
        if (imgEl) {
          imgEl.classList.add('hidden');
          imgEl.removeAttribute('src');
        }
        if (videoEl) {
          videoEl.classList.add('hidden');
        }
        if (placeholderEl) {
          placeholderEl.classList.remove('hidden');
          const msg = placeholderEl.querySelector('p');
          if (msg) msg.textContent = 'No Receipt Attached';
        }
      }

      if (captionEl) {
        const fileName = deposit.screenshot_original_name || deposit.proof_original_name;
        captionEl.textContent = fileName
          ? 'Uploaded file: ' + fileName
          : (receiptUrl ? 'Transfer receipt' : '');
      }

      if (actionsEl) {
        if (this.isDepositPending(deposit)) {
          actionsEl.classList.remove('hidden');
        } else {
          actionsEl.classList.add('hidden');
        }
      }

      modal?.classList.remove('hidden');
      document.body.classList.add('sidebar-scroll-lock');
    },

    closeDepositReceiptModal() {
      this.activeDepositReceiptId = null;
      const modal = $('depositReceiptReviewModal');
      const imgEl = $('depositReceiptImg');
      const videoEl = $('depositReceiptVideo');
      if (imgEl) {
        imgEl.classList.add('hidden');
        imgEl.removeAttribute('src');
      }
      if (videoEl) {
        videoEl.pause();
        videoEl.classList.add('hidden');
        videoEl.removeAttribute('src');
        videoEl.load();
      }
      this.hideDepositReceiptPlaceholder();
      modal?.classList.add('hidden');
      document.body.classList.remove('sidebar-scroll-lock');
    },

    resolvePricing(record) {
      if (!record) return null;

      const p = record.pricing_breakdown || record.pricing;
      if (p && (p.total_usd_required != null || p.net_usd_to_card != null)) {
        const rate = p.mmk_to_usd_rate
          || (record.amount_usd > 0 ? Math.round(record.amount_mmk / record.amount_usd) : null)
          || (this.pricingSettings && this.pricingSettings.mmk_to_usd_rate)
          || 4500;
        if (p.net_usd_to_card != null || record.purpose === 'card_reload') {
          return {
            deposit_mmk: Number(p.deposit_mmk) || Number(record.amount_mmk) || 0,
            gross_usd: Number(p.gross_usd) || 0,
            reload_fee_usd: Number(p.reload_fee_usd) || 0,
            net_usd_to_card: Number(p.net_usd_to_card) || Number(record.amount_usd) || 0,
            mmk_to_usd_rate: rate,
            card_id: p.card_id || record.metadata?.card_id || null,
            card_label: p.card_label || record.metadata?.card_label || null,
          };
        }
        return {
          initial_load_usd: Number(p.initial_load_usd) || 0,
          issuance_fee_usd: Number(p.issuance_fee_usd) || 0,
          total_usd_required: Number(p.total_usd_required) || Number(record.amount_usd) || 0,
          total_mmk: Number(p.total_mmk) || Number(record.amount_mmk) || 0,
          mmk_to_usd_rate: rate,
          card_request_id: p.card_request_id || record.metadata?.card_request_id || null,
          is_wallet_topup: record.purpose !== 'card_issuance' && !p.issuance_fee_usd,
        };
      }

      const amountUsd = Number(record.amount_usd) || 0;
      const amountMmk = Number(record.amount_mmk) || 0;
      if (amountUsd <= 0 && amountMmk <= 0) return null;

      const rate = amountUsd > 0
        ? Math.round(amountMmk / amountUsd)
        : ((this.pricingSettings && this.pricingSettings.mmk_to_usd_rate) || 4500);
      const purpose = record.purpose || 'topup';
      const fee = (this.pricingSettings && this.pricingSettings.card_issuance_fee_usd) || 5;

      if (purpose === 'card_issuance') {
        return {
          initial_load_usd: Math.max(0, Math.round((amountUsd - fee) * 100) / 100),
          issuance_fee_usd: fee,
          total_usd_required: amountUsd,
          total_mmk: amountMmk,
          mmk_to_usd_rate: rate,
          card_request_id: record.metadata?.card_request_id || null,
          is_wallet_topup: false,
        };
      }

      return {
        initial_load_usd: amountUsd,
        issuance_fee_usd: 0,
        total_usd_required: amountUsd,
        total_mmk: amountMmk,
        mmk_to_usd_rate: rate,
        is_wallet_topup: true,
      };
    },

    renderPricingBreakdown(record) {
      const p = this.resolvePricing(record);
      if (!p) {
        return '<span class="hint">Amount pending</span>';
      }

      const rateStr = Number(p.mmk_to_usd_rate).toLocaleString();
      const purpose = record.purpose || 'topup';

      if (purpose === 'card_reload' || p.net_usd_to_card != null) {
        const cardLabel = p.card_label || record.metadata?.card_label || ('Card #' + (p.card_id || record.metadata?.card_id || '?'));
        const topUp = Number(p.top_up_usd || p.net_usd_to_card || record.amount_usd || 0).toFixed(2);
        const fee = Number(p.reload_fee_usd || 3.5).toFixed(2);
        const totalWallet = Number(p.total_wallet_usd || (parseFloat(topUp) + parseFloat(fee))).toFixed(2);
        const profit = Number(p.net_profit_usd || 2).toFixed(2);
        const walletMmk = Number(p.deposit_mmk || p.total_mmk || record.amount_mmk || 0).toLocaleString();
        return '<small class="pricing-breakdown-cell">Reload → ' + this.esc(cardLabel) +
          ': <strong>$' + topUp + '</strong> top-up + $' + fee + ' fee = $' + totalWallet +
          ' wallet (' + walletMmk + ' MMK) · $' + profit + ' net profit</small>';
      }

      const mmkStr = Number(p.total_mmk).toLocaleString();

      if (p.is_wallet_topup || (purpose !== 'card_issuance' && !p.issuance_fee_usd)) {
        return '<small class="pricing-breakdown-cell">Wallet top-up: $' +
          p.total_usd_required.toFixed(2) + ' (' + mmkStr + ' MMK @ ' + rateStr + ' rate)</small>';
      }

      return '<small class="pricing-breakdown-cell">Card Fee: $' +
        p.issuance_fee_usd.toFixed(2) + ' + Deposit: $' +
        p.initial_load_usd.toFixed(2) + ' = Total: $' +
        p.total_usd_required.toFixed(2) + ' (' + mmkStr + ' MMK @ ' + rateStr + ' rate)</small>';
    },

    renderDepositRefCell(record) {
      const ref = record.ref_code || record.deposit_ref;
      const proofUrl = record.proof_url || record.screenshot_url || record.screenshot_path
        || (record.deposit && (record.deposit.proof_url || record.deposit.screenshot_path));
      const proofRecord = proofUrl ? (record.deposit || record) : null;
      const txn = record.kpay_transaction_id || record.txn_id
        || (record.deposit && (record.deposit.kpay_transaction_id || record.deposit.txn_id));

      let html = '';

      if (ref) {
        html += '<code class="deposit-ref-code">' + this.esc(ref) + '</code>';
      } else if (txn) {
        html += '<small>Txn: ' + this.esc(txn) + '</small>';
      }

      if (proofRecord && proofUrl) {
        html += '<div class="deposit-ref-proof">' + this.renderProofCell(proofRecord) + '</div>';
      } else if (!ref && !txn) {
        return '<span class="hint">Awaiting payment</span>';
      }

      return html || '<span class="hint">Awaiting payment</span>';
    },

    fillIssueCardForm(payload) {
      if (!payload?.card_id) return;
      const card = this.issuedCardsById[payload.card_id] || this.pendingCardsById[payload.card_id];
      if (card && !this.isPendingCardRecord(card)) {
        this.openEditCardForm(card);
        return;
      }
      this.openIssueCardModal(payload.card_id, payload);
    },

    isPendingCardRecord(card) {
      if (!card) return false;
      const status = String(card.status || '').toLowerCase();
      const num = String(card.card_number || '').trim();
      return status === 'pending' || num.startsWith('PENDING-');
    },

    showAdminToast(message, type = 'ok') {
      const el = $('adminToast');
      if (!el) return;
      el.className = `auth-toast ${type === 'error' ? 'err' : 'ok'}`;
      el.textContent = message;
      el.classList.remove('hidden');
      clearTimeout(this._adminToastTimer);
      this._adminToastTimer = setTimeout(() => el.classList.add('hidden'), 4500);
    },

    setIssueCardFormEditMode(isEdit) {
      this.cardFormEditMode = Boolean(isEdit);
      const submitBtn = $('issueCardAdminSubmit');
      const title = $('issueCardFormTitle');
      const cardIdField = $('acCardId');
      if (submitBtn) {
        submitBtn.textContent = isEdit
          ? (typeof t === 'function' ? t('save_changes_update') : 'Save Changes / Update Card')
          : (typeof t === 'function' ? t('btn_issue_card') : 'Issue Card');
      }
      if (title) {
        title.textContent = isEdit
          ? (typeof t === 'function' ? t('save_changes_update') : 'Update Virtual Card')
          : (typeof t === 'function' ? t('issue_update_card') : 'Issue / Update Card');
      }
      if (cardIdField) cardIdField.readOnly = isEdit;
    },

    openEditCardForm(card) {
      if (!card) return;
      if ($('acUserId')) $('acUserId').value = card.user_id || '';
      if ($('acCardId')) $('acCardId').value = card.id || '';
      if ($('acCardNumber')) $('acCardNumber').value = card.card_number || '';
      if ($('acExp')) $('acExp').value = card.exp_date || '';
      if ($('acCvv')) $('acCvv').value = card.cvv || '';
      if ($('acHolder')) $('acHolder').value = card.card_holder_name || '';
      if ($('acNotes')) $('acNotes').value = card.admin_notes || '';
      this.setIssueCardFormEditMode(true);
      $('issueCardAdminForm')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      $('acCardNumber')?.focus();
    },

    resetIssueCardAdminForm() {
      const form = $('issueCardAdminForm');
      if (form) form.reset();
      if ($('acCardId')) $('acCardId').readOnly = false;
      this.setIssueCardFormEditMode(false);
      const out = $('issueCardAdminOut');
      if (out) {
        out.textContent = '';
        out.classList.add('hidden');
      }
    },

    async submitIssueCardAdminForm() {
      const cardIdRaw = $('acCardId')?.value?.trim();
      const cardId = cardIdRaw ? parseInt(cardIdRaw, 10) : null;
      const isUpdate = this.cardFormEditMode && cardId;

      const payload = {
        user_id: parseInt($('acUserId').value, 10),
        card_id: cardId || undefined,
        card_number: ($('acCardNumber').value || '').trim(),
        exp_date: ($('acExp').value || '').trim(),
        cvv: ($('acCvv').value || '').trim(),
        card_holder_name: ($('acHolder').value || '').trim() || undefined,
        admin_notes: ($('acNotes').value || '').trim() || undefined,
      };

      try {
        const data = await this.api('POST', '/api/admin/cards/issue', payload);
        if (isUpdate) {
          this.showAdminToast(data.message || 'Card details updated successfully.');
        } else {
          this.showAdminToast(data.message || 'Card issued successfully.');
        }
        this.resetIssueCardAdminForm();
        await Promise.all([
          this.loadPendingCards(),
          this.loadIssuedCards(),
          this.loadUsers(),
        ]);
      } catch (err) {
        this.showAdminToast(err.message || 'Failed to save card', 'error');
      }
    },

    fillIssueCardFormFromDeposit(deposit) {
      const p = this.resolvePricing(deposit);
      const cardId = (p && p.card_request_id)
        || deposit.metadata?.card_request_id
        || deposit.pricing_breakdown?.card_request_id;

      if (!cardId) {
        this.switchTab('cards');
        return;
      }

      this.openIssueCardModal(cardId, {
        user_id: deposit.user_id,
        holder: deposit.name || deposit.card_holder_name || '',
        balance_usd: p ? p.initial_load_usd : deposit.amount_usd,
        note: 'Approved deposit ' + (deposit.ref_code || deposit.id),
      });
      this.switchTab('cards');
    },

    fillIssueCardFormFromCard(card) {
      const p = card.pricing || (card.deposit && this.resolvePricing(card.deposit));
      this.openIssueCardModal(card.id, {
        user_id: card.user_id,
        holder: card.card_holder_name || card.name || '',
        balance_usd: p ? p.initial_load_usd : null,
        note: card.deposit_ref
          ? 'Card request — deposit ' + card.deposit_ref
          : 'Pending card request #' + card.id,
      });
    },

    openIssueCardModal(cardId, preset) {
      const card = this.pendingCardsById[cardId];
      if (!card && !preset) return;

      const c = card || {};
      const p = c.pricing || preset?.pricing;
      const initialBalance = preset?.balance_usd ?? p?.initial_load_usd ?? c.pricing?.initial_load_usd ?? 0;

      if ($('issueModalCardId')) $('issueModalCardId').value = cardId;
      if ($('issueModalUserId')) $('issueModalUserId').value = c.user_id || preset?.user_id || '';
      if ($('issueModalCardNumber')) $('issueModalCardNumber').value = '';
      if ($('issueModalExp')) $('issueModalExp').value = '';
      if ($('issueModalCvv')) $('issueModalCvv').value = '';
      if ($('issueModalBalance')) $('issueModalBalance').value = Number(initialBalance || 0).toFixed(2);
      if ($('issueModalHolder')) {
        $('issueModalHolder').value = preset?.holder || c.card_holder_name || c.name || '';
      }
      if ($('issueModalNotes')) {
        $('issueModalNotes').value = preset?.note || '';
      }

      const meta = $('issueCardModalMeta');
      if (meta) {
        meta.innerHTML =
          '<strong>Request #' + cardId + '</strong> · User #' + this.esc(c.user_id || preset?.user_id) +
          '<br>' + this.esc(c.name || c.email || preset?.holder || '—') +
          (c.deposit_ref ? '<br>Deposit ref: <code>' + this.esc(c.deposit_ref) + '</code>' : '');
      }

      const title = $('issueCardModalTitle');
      if (title) title.textContent = 'Issue Virtual Card — Request #' + cardId;

      $('issueCardModal')?.classList.remove('hidden');
      document.body.classList.add('sidebar-scroll-lock');
      $('issueModalCardNumber')?.focus();
    },

    closeIssueCardModal() {
      $('issueCardModal')?.classList.add('hidden');
      document.body.classList.remove('sidebar-scroll-lock');
    },

    normalizeCardNumberInput(raw) {
      return String(raw || '').replace(/\D/g, '').slice(0, 16);
    },

    formatCardNumberDisplay(digits) {
      return digits.replace(/(\d{4})(?=\d)/g, '$1 ').trim();
    },

    async submitIssueCardModal() {
      const cardId = parseInt($('issueModalCardId')?.value, 10);
      if (!cardId) return;

      const digits = this.normalizeCardNumberInput($('issueModalCardNumber')?.value);
      if (digits.length !== 16) {
        alert('Card number must be exactly 16 digits');
        return;
      }

      const exp = ($('issueModalExp')?.value || '').trim();
      if (!/^\d{2}\/\d{2}$/.test(exp)) {
        alert('Expiry must be in MM/YY format');
        return;
      }

      const cvv = ($('issueModalCvv')?.value || '').trim();
      if (!/^\d{3,4}$/.test(cvv)) {
        alert('CVV must be 3 or 4 digits');
        return;
      }

      const balance = parseFloat($('issueModalBalance')?.value);
      if (!Number.isFinite(balance) || balance < 0) {
        alert('Enter a valid initial balance');
        return;
      }

      try {
        const data = await this.api('POST', '/api/admin/cards/' + cardId + '/approve', {
          card_number: this.formatCardNumberDisplay(digits),
          exp_date: exp,
          cvv,
          balance_usd: balance,
          card_holder_name: $('issueModalHolder')?.value.trim() || undefined,
          admin_notes: $('issueModalNotes')?.value.trim() || 'Card issued manually by admin',
        });

        this.closeIssueCardModal();
        await Promise.all([
          this.loadPendingCards(),
          this.loadIssuedCards(),
          this.loadDeposits(),
          this.loadTransactions(),
          this.loadUsers(),
        ]);

        alert(data.message || ('Card activated — ending ' + (data.card?.last4 || digits.slice(-4))));
      } catch (err) {
        alert(err.message || 'Failed to issue card');
      }
    },

    async approvePendingCard(cardId) {
      const card = this.pendingCardsById[cardId];
      if (!card) {
        console.warn('[Admin] approvePendingCard: unknown card id', cardId);
        return;
      }

      const note = prompt('Admin note (optional):', 'Card approved by admin');
      if (note === null) return;

      try {
        console.log('[Admin] Approving pending card request', cardId, {
          user_id: card.user_id,
          deposit_id: card.deposit_id,
          deposit_status: card.deposit_status,
        });

        const data = await this.api('POST', '/api/admin/cards/' + cardId + '/approve', {
          admin_notes: note || 'Card approved by admin',
        });

        console.log('[Admin] Card approval success:', data.card?.id, 'status=', data.card?.status);

        await Promise.all([
          this.loadPendingCards(),
          this.loadIssuedCards(),
          this.loadPendingReloads(),
          this.loadDeposits(),
          this.loadTransactions(),
          this.loadUsers(),
        ]);

        alert('Card activated successfully' + (data.card?.last4 ? ' — ending ' + data.card.last4 : ''));
      } catch (err) {
        console.error('[Admin] approvePendingCard error:', err);
        alert(err.message || 'Failed to approve card');
      }
    },

    async rejectPendingCard(cardId) {
      const card = this.pendingCardsById[cardId];
      if (!card) return;

      const note = prompt('Rejection reason (optional):') || 'Card request rejected by admin';
      try {
        if (card.deposit_id) {
          await this.api('POST', '/api/admin/deposits/' + card.deposit_id + '/review', {
            action: 'reject',
            admin_note: note,
            rejection_reason: note,
          });
        }
        await this.loadPendingCards();
        await this.loadDeposits();
        alert('Card request rejected' + (card.deposit_id ? ' and linked deposit rejected' : ''));
      } catch (err) {
        alert(err.message);
      }
    },

    async approvePendingReload(reloadId) {
      const reload = this.pendingReloadsById[reloadId];
      if (!reload) return;

      const note = prompt('Admin note (optional):', 'Card reload approved by admin');
      if (note === null) return;

      try {
        const data = await this.api('POST', '/api/admin/reloads/' + reloadId + '/approve', {
          admin_note: note || 'Card reload approved by admin',
        });

        await Promise.all([
          this.loadPendingReloads(),
          this.loadTransactions(),
          this.loadUsers(),
        ]);

        alert(data.message || 'Card reload completed — card balance updated and fee profit logged');
      } catch (err) {
        alert(err.message || 'Failed to approve reload');
      }
    },

    async rejectPendingReload(reloadId) {
      const reload = this.pendingReloadsById[reloadId];
      if (!reload) return;

      const note = prompt('Rejection reason (optional):') || 'Card reload rejected by admin';
      try {
        const data = await this.api('POST', '/api/admin/reloads/' + reloadId + '/reject', {
          rejection_reason: note,
          admin_note: note,
        });

        await Promise.all([
          this.loadPendingReloads(),
          this.loadTransactions(),
          this.loadUsers(),
        ]);

        alert(data.message || 'Card reload rejected — wallet refunded');
      } catch (err) {
        alert(err.message || 'Failed to reject reload');
      }
    },

    async loadPendingReloads() {
      const table = $('pendingReloadsTable');
      if (!table) return;

      try {
        let reloads = null;
        if (window.SupabaseBridge?.isReady()) {
          reloads = await window.SupabaseBridge.fetchAdminPendingReloads();
        }
        if (!reloads) {
          const data = await this.api('GET', '/api/admin/reloads/pending');
          reloads = Array.isArray(data.reloads) ? data.reloads : [];
        }
        this.pendingReloadsById = {};
        reloads.forEach((r) => { this.pendingReloadsById[r.id] = r; });

        if (!reloads.length) {
          table.innerHTML = '<p class="hint">No pending card reload requests.</p>';
          return;
        }

        table.innerHTML =
          '<table class="data-table">' +
            '<thead><tr>' +
              '<th>ID</th><th>User ID</th><th>Card Last 4</th><th>Top-Up (USD)</th><th>Fee Profit</th><th>Wallet Deducted</th><th>Requested</th><th>Actions</th>' +
            '</tr></thead>' +
            '<tbody>' +
            reloads.map((r) =>
              '<tr>' +
                '<td>' + r.id + '</td>' +
                '<td>#' + r.user_id + '<br><small>' + this.esc(r.user_name || r.user_email || '') + '</small></td>' +
                '<td><code>**** ' + this.esc(r.card_last4 || '????') + '</code></td>' +
                '<td><strong>$' + Number(r.top_up_amount_usd || r.net_usd_to_card || 0).toFixed(2) + '</strong></td>' +
                '<td>$' + Number(r.fee_profit_usd || r.reload_fee_usd || 0).toFixed(2) + '</td>' +
                '<td>' + this.esc(r.wallet_deducted_display || '—') + '</td>' +
                '<td>' + this.esc(r.created_at || '—') + '</td>' +
                '<td class="actions-cell">' +
                  '<button type="button" class="btn btn-sm btn-approve" data-action="approve-reload" data-id="' + r.id + '">Approve Reload</button>' +
                  '<button type="button" class="btn btn-sm btn-reject" data-action="reject-reload" data-id="' + r.id + '">Reject Reload</button>' +
                '</td>' +
              '</tr>'
            ).join('') +
            '</tbody>' +
          '</table>';
      } catch (err) {
        table.innerHTML = '<p class="hint" style="color:#ef4444">' + this.esc(err.message) + '</p>';
      }
    },

    async loadKycRequests() {
      const table = $('kycRequestsTable');
      if (!table) return;
      table.innerHTML = '<p class="hint">Loading KYC requests…</p>';
      try {
        const status = $('kycStatusFilter')?.value || 'PENDING_REVIEW';
        const qs = status ? `?status=${encodeURIComponent(status)}` : '';
        const data = await this.api('GET', '/api/admin/kyc-requests' + qs);
        const rows = data.submissions || [];
        this.kycDocsBySubmissionId = {};
        if (!rows.length) {
          table.innerHTML = '<p class="hint">No KYC submissions found.</p>';
          return;
        }
        rows.forEach((s) => {
          this.kycDocsBySubmissionId[s.id] = {
            front: s.front_photo_path || s.frontPhotoUrl,
            back: s.back_photo_path || s.backPhotoUrl,
            selfie: s.selfie_photo_path || s.selfieUrl,
            userName: s.full_name,
          };
        });
        table.innerHTML =
          '<table class="data-table">' +
          '<thead><tr><th>ID</th><th>User</th><th>Name</th><th>ID Type</th><th>ID Number</th><th>Documents</th><th>Status</th><th>Actions</th></tr></thead>' +
          '<tbody>' +
          rows.map((s) => {
            const docButtons = [
              ['front', 'Front'],
              ['back', 'Back'],
              ['selfie', 'Selfie'],
            ].map(([doc, label]) =>
              `<button type="button" class="btn btn-sm btn-secondary" data-kyc-view data-submission-id="${s.id}" data-doc="${doc}">${label}</button>`
            ).join(' ');
            const actions = s.status === 'PENDING_REVIEW'
              ? `<button type="button" class="btn btn-sm btn-approve" data-kyc-approve data-id="${s.id}">Approve</button> ` +
                `<button type="button" class="btn btn-sm btn-reject" data-kyc-reject data-id="${s.id}">Reject</button>`
              : '<small class="hint">' + this.esc(s.rejection_reason || s.reviewed_at || '—') + '</small>';
            return '<tr>' +
              '<td>' + s.id + '</td>' +
              '<td>' + this.esc(s.user_name || '') + '<br><small class="hint">' + this.esc(s.user_email || '') + '</small></td>' +
              '<td>' + this.esc(s.full_name) + '</td>' +
              '<td>' + this.esc(s.id_type) + '</td>' +
              '<td>' + this.esc(s.id_number) + '</td>' +
              '<td style="white-space:nowrap">' + docButtons + '</td>' +
              '<td><span class="badge ' + (s.status === 'VERIFIED' ? 'badge-ok' : s.status === 'REJECTED' ? 'badge-muted' : '') + '">' + this.esc(s.status) + '</span></td>' +
              '<td class="actions-cell">' + actions + '</td>' +
              '</tr>';
          }).join('') +
          '</tbody></table>';
      } catch (err) {
        table.innerHTML = '<p class="hint" style="color:#ef4444">' + this.esc(err.message) + '</p>';
      }
    },

    async approveKycRequest(id) {
      if (!confirm('Approve this KYC submission? User will be able to trade P2P.')) return;
      try {
        const data = await this.api('POST', '/api/admin/kyc-requests/' + id + '/approve', {});
        alert(data.message || 'KYC approved');
        await this.loadKycRequests();
      } catch (err) {
        alert(err.message || 'Failed to approve KYC');
      }
    },

    async rejectKycRequest(id) {
      const reason = prompt('Rejection reason (shown to user):');
      if (!reason?.trim()) return;
      try {
        const data = await this.api('POST', '/api/admin/kyc-requests/' + id + '/reject', {
          rejection_reason: reason.trim(),
        });
        alert(data.message || 'KYC rejected');
        await this.loadKycRequests();
      } catch (err) {
        alert(err.message || 'Failed to reject KYC');
      }
    },

    async loadP2pDisputes() {
      const table = $('p2pDisputesTable');
      if (!table) return;
      try {
        const data = await this.api('GET', '/api/admin/p2p-disputes');
        const disputes = data.disputes || [];
        this._p2pDisputeByKey = {};
        if (!disputes.length) {
          table.innerHTML = '<p class="hint">No open P2P disputes.</p>';
          return;
        }
        table.innerHTML =
          '<table class="data-table">' +
          '<thead><tr><th>Ref</th><th>Type</th><th>User</th><th>Amount</th><th>Reason</th><th>Proof</th><th>Actions</th></tr></thead>' +
          '<tbody>' +
          disputes.map((d) => {
            const disputeKey = `${d.order_type}-${d.id}`;
            this._p2pDisputeByKey[disputeKey] = d;
            const hasPaymentProof = Boolean(d.payment_proof_path);
            const hasDisputeProof = Boolean(d.dispute_proof_path);
            const proof = (hasPaymentProof || hasDisputeProof)
              ? '<button type="button" class="btn btn-sm btn-secondary" data-action="review-p2p-dispute" data-dispute-key="' + this.esc(disputeKey) + '">Review Proof</button>'
              : '—';
            return '<tr>' +
              '<td><code>' + this.esc(d.ref_code) + '</code></td>' +
              '<td>' + this.esc(d.order_type === 'sell' ? 'Sell USDT' : 'Buy USDT') + '</td>' +
              '<td>' + this.esc(d.user_name || d.user_email || 'User #' + d.user_id) + '</td>' +
              '<td>$' + Number(d.amount_usdt).toFixed(2) + ' / ' + Math.round(Number(d.amount_mmk)).toLocaleString() + ' MMK</td>' +
              '<td>' + this.esc(d.dispute_reason || '—') + '</td>' +
              '<td>' + proof + '</td>' +
              '<td class="actions-cell">' +
                '<button type="button" class="btn btn-sm btn-approve" data-action="resolve-p2p-dispute-release" data-order-type="' + d.order_type + '" data-id="' + d.id + '">Force Release</button> ' +
                '<button type="button" class="btn btn-sm btn-reject" data-action="resolve-p2p-dispute-refund" data-order-type="' + d.order_type + '" data-id="' + d.id + '">Refund / Reject</button>' +
              '</td>' +
            '</tr>';
          }).join('') +
          '</tbody></table>';
      } catch (err) {
        table.innerHTML = '<p class="hint" style="color:#ef4444">' + this.esc(err.message) + '</p>';
      }
    },

    renderAdminP2pProofSection(title, proofPath, txRef) {
      if (!proofPath && !txRef) return '';
      const esc = (t) => this.esc(t);
      const isVideo = /\.(mp4|webm|mov|avi)(\?|$)/i.test(proofPath || '');
      const media = proofPath
        ? (isVideo
          ? `<button type="button" class="btn btn-sm btn-secondary" data-admin-proof-src="${esc(proofPath)}" data-admin-proof-type="video">View video proof</button>`
          : `<img src="${esc(proofPath)}" alt="${esc(title)}" style="max-width:100%;max-height:280px;cursor:pointer;border-radius:8px" data-admin-proof-src="${esc(proofPath)}" data-admin-proof-type="image">`)
        : '<p class="hint">No image attached</p>';
      const tx = txRef ? `<p class="hint" style="margin:0.35rem 0 0"><strong>TxRef:</strong> ${esc(txRef)}</p>` : '';
      return `<div class="p2p-dispute-proof-section"><h4>${esc(title)}</h4>${media}${tx}</div>`;
    },

    openP2pDisputeReviewModal(dispute) {
      const modal = $('p2pDisputeReviewModal');
      if (!modal || !dispute) return;
      $('p2pDisputeReviewTitle').textContent = `Dispute Review — ${dispute.ref_code}`;
      $('p2pDisputeReviewMeta').textContent =
        `${dispute.order_type === 'sell' ? 'Sell USDT' : 'Buy USDT'} · ${dispute.user_name || dispute.user_email || ('User #' + dispute.user_id)} · $${Number(dispute.amount_usdt).toFixed(2)} USDT / ${Math.round(Number(dispute.amount_mmk)).toLocaleString()} MMK · ${dispute.dispute_reason || 'No reason provided'}`;

      const sections = [];
      if (dispute.payment_proof_path || dispute.payment_tx_ref) {
        sections.push(this.renderAdminP2pProofSection('Buyer Transfer Payment Proof', dispute.payment_proof_path, dispute.payment_tx_ref));
      }
      if (dispute.dispute_proof_path) {
        sections.push(this.renderAdminP2pProofSection('Dispute Evidence Upload', dispute.dispute_proof_path, null));
      }
      const container = $('p2pDisputeReviewProofSections');
      if (container) {
        container.innerHTML = sections.length
          ? sections.join('')
          : '<p class="hint">No proof images attached to this dispute.</p>';
        container.querySelectorAll('[data-admin-proof-src]').forEach((el) => {
          el.addEventListener('click', () => {
            this.openProofLightbox(el.dataset.adminProofSrc, 'P2P dispute proof', el.dataset.adminProofType || 'image');
          });
        });
      }
      modal.classList.remove('hidden');
    },

    closeP2pDisputeReviewModal() {
      $('p2pDisputeReviewModal')?.classList.add('hidden');
    },

    async resolveP2pDispute(orderType, id, resolution, triggerBtn) {
      const note = prompt('Admin note (optional):') || '';
      if (resolution === 'force_release' && !confirm('Force-release USDT to the buyer for this disputed order?')) return;
      if (resolution === 'refund' && !confirm('Refund escrow to the seller and reject this dispute?')) return;

      const prevLabel = triggerBtn?.textContent;
      if (triggerBtn) {
        triggerBtn.disabled = true;
        triggerBtn.textContent = 'Processing…';
      }

      try {
        const data = await this.api('POST', '/api/admin/p2p-disputes/' + orderType + '/' + id + '/resolve', {
          resolution,
          admin_note: note,
        });
        alert(data.message || (resolution === 'force_release'
          ? 'USDT Force Released to Buyer'
          : 'Dispute Rejected - Escrow Refunded to Seller'));
        await Promise.all([
          this.loadP2pDisputes(),
          this.loadP2pBuyOrders(),
          this.loadP2pSellOrders(),
          this.loadUsers(),
          this.loadSettings(),
        ]);
      } catch (err) {
        alert(err.message || 'Failed to resolve dispute');
        if (triggerBtn) {
          triggerBtn.disabled = false;
          triggerBtn.textContent = prevLabel || (resolution === 'force_release' ? 'Force Release' : 'Refund / Reject');
        }
      }
    },

    async loadP2pBuyOrders() {
      const table = $('p2pBuyOrdersTable');
      if (!table) return;
      try {
        const data = await this.api('GET', '/api/admin/p2p-buy-orders?status=pending_seller_release');
        const orders = Array.isArray(data.orders) ? data.orders : [];
        if (!orders.length) {
          table.innerHTML = '<p class="hint">No P2P buy orders pending seller release.</p>';
          return;
        }
        table.innerHTML =
          '<table class="data-table">' +
          '<thead><tr>' +
          '<th>ID</th><th>Ref</th><th>User</th><th>Seller</th><th>Buyer Receives</th><th>Seller Fee</th><th>Seller Total</th><th>MMK</th><th>Payment</th><th>Proof</th><th>Status</th><th>Actions</th>' +
          '</tr></thead><tbody>' +
          orders.map((o) => {
            const fee = o.fee || {};
            const feePct = o.fee_percent_applied ?? fee.fee_percent ?? o.metadata?.fee_percent_applied ?? this.pricingSettings?.p2p_seller_fee_percent ?? 1;
            const buyerReceives = Number(o.amount_usdt);
            const feeAmt = o.platform_fee_usdt != null
              ? Number(o.platform_fee_usdt)
              : (fee.platform_fee_usdt ?? Math.round(buyerReceives * feePct) / 100);
            const sellerTotal = fee.seller_total_usdt ?? Math.round((buyerReceives + feeAmt) * 100) / 100;
            const proofPath = o.payment_proof_path || o.payment_proof_url || o.paymentProofUrl;
            const proofCell = proofPath
              ? '<button type="button" class="btn btn-sm btn-secondary" data-action="view-p2p-payment-proof" data-proof-src="' + this.esc(proofPath) + '" data-proof-type="image">View Proof</button>'
                + (o.payment_tx_ref ? '<div><small>Tx: ' + this.esc(o.payment_tx_ref) + '</small></div>' : '')
              : '—';
            return (
            '<tr>' +
            '<td>' + o.id + '</td>' +
            '<td><code>' + this.esc(o.ref_code) + '</code></td>' +
            '<td>' + this.esc(o.user_name || o.user_email || ('User #' + o.user_id)) + '</td>' +
            '<td>' + this.esc(o.seller_name || ('#' + o.seller_id)) + '</td>' +
            '<td>$' + buyerReceives.toFixed(2) + '</td>' +
            '<td>$' + feeAmt.toFixed(2) + ' <small>(' + feePct + '%)</small></td>' +
            '<td>$' + sellerTotal.toFixed(2) + '</td>' +
            '<td>' + Math.round(Number(o.amount_mmk)).toLocaleString() + '</td>' +
            '<td>' + this.esc(o.payment_method) + '</td>' +
            '<td>' + proofCell + '</td>' +
            '<td><span class="badge badge-warn">Pending Release</span></td>' +
            '<td class="actions-cell">' +
              '<button type="button" class="btn btn-sm btn-approve" data-action="release-p2p-buy" data-id="' + o.id + '" title="Release ' + buyerReceives.toFixed(2) + ' USDT to buyer">Release USDT</button> ' +
              '<button type="button" class="btn btn-sm btn-reject" data-action="reject-p2p-buy" data-id="' + o.id + '">Reject</button>' +
            '</td>' +
            '</tr>'
            );
          }).join('') +
          '</tbody></table>';
      } catch (err) {
        table.innerHTML = '<p class="hint" style="color:#ef4444">' + this.esc(err.message) + '</p>';
      }
    },

    async releaseP2pBuyOrder(id) {
      if (!confirm('Confirm MMK receipt and release full USDT amount to buyer? Platform fee will be charged separately to the seller.')) return;
      try {
        const data = await this.api('POST', '/api/admin/p2p-buy-orders/' + id + '/release', {
          admin_note: 'MMK receipt confirmed — USDT released',
        });
        alert(data.message || 'USDT released to user wallet');
        await this.loadP2pBuyOrders();
        await this.loadUsers();
        await this.loadSettings();
      } catch (err) {
        alert(err.message || 'Failed to release order');
      }
    },

    async rejectP2pBuyOrder(id) {
      const reason = prompt('Rejection reason (optional):') || 'MMK transfer not verified';
      try {
        await this.api('POST', '/api/admin/p2p-buy-orders/' + id + '/reject', {
          rejection_reason: reason,
        });
        alert('P2P buy order rejected');
        await this.loadP2pBuyOrders();
      } catch (err) {
        alert(err.message || 'Failed to reject order');
      }
    },

    async loadP2pSellOrders() {
      const table = $('p2pSellOrdersTable');
      if (!table) return;
      try {
        const data = await this.api('GET', '/api/admin/p2p-sell-orders?status=pending_merchant_mmk');
        const orders = Array.isArray(data.orders) ? data.orders : [];
        if (!orders.length) {
          table.innerHTML = '<p class="hint">No P2P sell orders with USDT in escrow.</p>';
          return;
        }
        table.innerHTML =
          '<table class="data-table">' +
          '<thead><tr>' +
          '<th>ID</th><th>Ref</th><th>User</th><th>Buyer</th><th>Escrow USDT</th><th>MMK Due</th><th>User Account</th><th>Status</th><th>Actions</th>' +
          '</tr></thead><tbody>' +
          orders.map((o) => {
            const acct = o.user_payment_account || {};
            const acctLabel = (acct.account_name || '') + ' / ' + (acct.account_number || '');
            return (
            '<tr>' +
            '<td>' + o.id + '</td>' +
            '<td><code>' + this.esc(o.ref_code) + '</code></td>' +
            '<td>' + this.esc(o.user_name || o.user_email || ('User #' + o.user_id)) + '</td>' +
            '<td>' + this.esc(o.seller_name || ('#' + o.seller_id)) + '</td>' +
            '<td>$' + Number(o.amount_usdt).toFixed(2) + '</td>' +
            '<td>' + Math.round(Number(o.amount_mmk)).toLocaleString() + '</td>' +
            '<td><small>' + this.esc(acct.method || o.payment_method) + ': ' + this.esc(acctLabel) + '</small></td>' +
            '<td><span class="badge badge-warn">Escrowed</span></td>' +
            '<td class="actions-cell">' +
              '<button type="button" class="btn btn-sm btn-reject" data-action="reject-p2p-sell" data-id="' + o.id + '">Reject &amp; Refund</button>' +
            '</td>' +
            '</tr>'
            );
          }).join('') +
          '</tbody></table>';
      } catch (err) {
        table.innerHTML = '<p class="hint" style="color:#ef4444">' + this.esc(err.message) + '</p>';
      }
    },

    async rejectP2pSellOrder(id) {
      const reason = prompt('Rejection reason (optional):') || 'Dispute — refunding escrow to user';
      if (!confirm('Reject this sell order and refund escrowed USDT to the user?')) return;
      try {
        await this.api('POST', '/api/admin/p2p-sell-orders/' + id + '/reject', {
          rejection_reason: reason,
        });
        alert('P2P sell order rejected — USDT escrow refunded');
        await this.loadP2pSellOrders();
        await this.loadUsers();
      } catch (err) {
        alert(err.message || 'Failed to reject sell order');
      }
    },

    async loadUsdtWithdrawals() {
      const table = $('usdtWithdrawalsTable');
      if (!table) return;
      const filter = ($('usdtWithdrawalFilter') && $('usdtWithdrawalFilter').value) || 'pending';
      try {
        const qs = filter === 'all' ? '?status=all' : ('?status=' + encodeURIComponent(filter));
        const data = await this.api('GET', '/api/admin/withdrawals/usdt' + qs);
        const rows = Array.isArray(data.withdrawals) ? data.withdrawals : [];
        if (!rows.length) {
          table.innerHTML = '<p class="hint">No USDT withdrawals found.</p>';
          return;
        }
        table.innerHTML =
          '<table class="data-table"><thead><tr>' +
            '<th>ID</th><th>User</th><th>Ref</th><th>Method</th><th>Destination</th><th>Amount</th><th>Fee</th><th>Payout</th><th>Status</th><th>Actions</th>' +
          '</tr></thead><tbody>' +
          rows.map((w) => {
            const pending = ['pending', 'processing'].indexOf(String(w.status || '').toLowerCase()) !== -1;
            const method = w.payout_method === 'bank' ? 'Bank (USDT→MMK)' : (w.network || 'Crypto');
            const dest = w.payout_method === 'bank'
              ? this.esc((w.bank_name || '') + ' · ' + (w.account_name || '') + ' · ' + (w.account_number || ''))
              : this.esc((w.network || '') + ' · ' + (w.wallet_address || ''));
            const payout = w.payout_method === 'bank'
              ? (Math.round(Number(w.amount_mmk || 0)).toLocaleString() + ' MMK @ ' + Number(w.exchange_rate || 0).toLocaleString())
              : ('$' + Number(w.net_usdt || 0).toFixed(2) + ' USDT');
            return '<tr>' +
              '<td>' + w.id + '</td>' +
              '<td>' + this.esc(w.user_name || w.user_email || ('#' + w.user_id)) + '<br><small>#' + w.user_id + '</small></td>' +
              '<td>' + this.esc(w.ref_code || '') + '</td>' +
              '<td>' + this.esc(method) + '</td>' +
              '<td style="max-width:220px;word-break:break-all">' + dest + '</td>' +
              '<td>$' + Number(w.amount_usdt || 0).toFixed(2) + '</td>' +
              '<td>$' + Number(w.fee_usdt || 0).toFixed(2) + '</td>' +
              '<td>' + payout + '</td>' +
              '<td>' + this.statusBadge(w.status) + '</td>' +
              '<td class="actions-cell">' +
                (pending
                  ? '<button type="button" class="btn btn-sm btn-approve" data-action="complete-usdt-wd" data-id="' + w.id + '">Complete</button>' +
                    '<button type="button" class="btn btn-sm btn-reject" data-action="reject-usdt-wd" data-id="' + w.id + '">Reject</button>'
                  : '') +
              '</td></tr>';
          }).join('') +
          '</tbody></table>';
      } catch (err) {
        table.innerHTML = '<p class="hint" style="color:#ef4444">Failed to load USDT withdrawals: ' + this.esc(err.message) + '</p>';
      }
    },

    async loadMmkWithdrawals() {
      const table = $('mmkWithdrawalsTable');
      if (!table) return;
      const filter = ($('mmkWithdrawalFilter') && $('mmkWithdrawalFilter').value) || 'pending';
      try {
        const qs = filter === 'all' ? '?status=all' : ('?status=' + encodeURIComponent(filter));
        const data = await this.api('GET', '/api/admin/withdrawals/mmk' + qs);
        const rows = Array.isArray(data.withdrawals) ? data.withdrawals : [];
        if (!rows.length) {
          table.innerHTML = '<p class="hint">No MMK withdrawals found.</p>';
          return;
        }
        table.innerHTML =
          '<table class="data-table"><thead><tr>' +
            '<th>ID</th><th>User</th><th>Ref</th><th>Bank</th><th>Amount</th><th>Fee</th><th>Net</th><th>Status</th><th>Actions</th>' +
          '</tr></thead><tbody>' +
          rows.map((w) => {
            const pending = ['pending', 'processing'].indexOf(String(w.status || '').toLowerCase()) !== -1;
            const bank = this.esc((w.bank_name || '') + ' · ' + (w.account_name || '') + ' · ' + (w.account_number || ''));
            return '<tr>' +
              '<td>' + w.id + '</td>' +
              '<td>' + this.esc(w.user_name || w.user_email || ('#' + w.user_id)) + '<br><small>#' + w.user_id + '</small></td>' +
              '<td>' + this.esc(w.ref_code || '') + '</td>' +
              '<td style="max-width:220px;word-break:break-all">' + bank + '</td>' +
              '<td>' + Math.round(Number(w.amount_mmk || 0)).toLocaleString() + '</td>' +
              '<td>' + Math.round(Number(w.fee_mmk || 0)).toLocaleString() + '</td>' +
              '<td>' + Math.round(Number(w.net_mmk || 0)).toLocaleString() + '</td>' +
              '<td>' + this.statusBadge(w.status) + '</td>' +
              '<td class="actions-cell">' +
                (pending
                  ? '<button type="button" class="btn btn-sm btn-approve" data-action="complete-mmk-wd" data-id="' + w.id + '">Complete</button>' +
                    '<button type="button" class="btn btn-sm btn-reject" data-action="reject-mmk-wd" data-id="' + w.id + '">Reject</button>'
                  : '') +
              '</td></tr>';
          }).join('') +
          '</tbody></table>';
      } catch (err) {
        table.innerHTML = '<p class="hint" style="color:#ef4444">Failed to load MMK withdrawals: ' + this.esc(err.message) + '</p>';
      }
    },

    async reviewUsdtWithdrawal(id, action, options) {
      options = options || {};
      const wdId = id != null ? String(id) : '';
      if (!wdId) return;

      let note = action === 'reject' ? 'Rejected by admin' : 'Completed by admin';
      let txHash = '';
      try {
        if (action === 'complete') {
          const entered = window.prompt('Admin note / TX hash (optional):', 'Completed');
          if (entered === null) return;
          note = String(entered).trim() || 'Completed by admin';
          if (/^(0x)?[a-fA-F0-9]{16,}$/.test(note) || /^[A-Za-z0-9]{20,}$/.test(note)) {
            txHash = note;
          }
        } else {
          const entered = window.prompt('Rejection reason (optional):', 'Rejected by admin');
          if (entered === null) return;
          note = String(entered).trim() || 'Rejected by admin';
        }
      } catch (_) {}

      const btn = options.triggerBtn || null;
      const prevLabel = btn ? btn.textContent : '';
      if (btn) {
        btn.disabled = true;
        btn.textContent = action === 'complete' ? 'Completing…' : 'Rejecting…';
      }

      try {
        const path = '/api/admin/withdrawals/usdt/' + encodeURIComponent(wdId) + '/' + (action === 'complete' ? 'complete' : 'reject');
        const body = { admin_note: note };
        if (txHash) body.tx_hash = txHash;
        const data = await this.api('POST', path, body);
        alert(data.message || 'USDT withdrawal updated');
        await Promise.all([this.loadUsdtWithdrawals(), this.loadUsers(), this.loadTransactions()]);
      } catch (err) {
        alert(err.message || 'Failed to update USDT withdrawal');
        if (btn) {
          btn.disabled = false;
          btn.textContent = prevLabel || (action === 'complete' ? 'Complete' : 'Reject');
        }
      }
    },

    async reviewMmkWithdrawal(id, action, options) {
      options = options || {};
      const wdId = id != null ? String(id) : '';
      if (!wdId) return;

      let note = action === 'reject' ? 'Rejected by admin' : 'Bank transfer completed';
      try {
        const promptMsg = action === 'reject' ? 'Rejection reason (optional):' : 'Admin note (optional):';
        const entered = window.prompt(promptMsg, note);
        if (entered === null) return;
        note = String(entered).trim() || note;
      } catch (_) {}

      const btn = options.triggerBtn || null;
      const prevLabel = btn ? btn.textContent : '';
      if (btn) {
        btn.disabled = true;
        btn.textContent = action === 'complete' ? 'Completing…' : 'Rejecting…';
      }

      try {
        const path = '/api/admin/withdrawals/mmk/' + encodeURIComponent(wdId) + '/' + (action === 'complete' ? 'complete' : 'reject');
        const data = await this.api('POST', path, { admin_note: note });
        alert(data.message || 'MMK withdrawal updated');
        await Promise.all([this.loadMmkWithdrawals(), this.loadUsers(), this.loadTransactions()]);
      } catch (err) {
        alert(err.message || 'Failed to update MMK withdrawal');
        if (btn) {
          btn.disabled = false;
          btn.textContent = prevLabel || (action === 'complete' ? 'Complete' : 'Reject');
        }
      }
    },

    renderPurposeBadge(d) {
      const purpose = d.purpose || 'topup';
      if (purpose === 'usdt_topup' && (d.is_p2p || d.deposit_channel === 'p2p' || d.metadata?.deposit_channel === 'p2p')) {
        return '<span class="deposit-purpose-badge usdt">P2P USDT</span>';
      }
      if (purpose === 'card_issuance') {
        return '<span class="deposit-purpose-badge">New Card</span>';
      }
      if (purpose === 'card_reload') {
        return '<span class="deposit-purpose-badge reload">Card Reload</span>';
      }
      if (purpose === 'usdt_topup') {
        return '<span class="deposit-purpose-badge usdt">USDT Top-Up</span>';
      }
      return '<span class="deposit-purpose-badge wallet">MMK Top-up</span>';
    },

    async loadSettings() {
      try {
        const data = await this.api('GET', '/api/admin/settings');
        const p = data.pricing || {};
        if ($('settingCardFee')) $('settingCardFee').value = p.card_issuance_fee_usd ?? 5;
        if ($('settingMinDeposit')) $('settingMinDeposit').value = p.minimum_initial_deposit_usd ?? 10;
        if ($('settingReloadFee')) $('settingReloadFee').value = p.card_reload_fee_usd ?? 3.5;
        if ($('settingMinReloadMmk')) $('settingMinReloadMmk').value = p.minimum_card_reload_mmk ?? 10000;
        if ($('settingMinUsdtDeposit')) $('settingMinUsdtDeposit').value = p.minimum_usdt_deposit ?? data.settings?.minimum_usdt_deposit ?? 5;
        if ($('settingMinUsdtReload')) $('settingMinUsdtReload').value = p.minimum_usdt_reload ?? data.settings?.minimum_usdt_reload ?? 5;
        if ($('settingP2pSellerFee')) $('settingP2pSellerFee').value = p.p2p_seller_fee_percent ?? 1;
        if ($('settingWithdrawFeeTrc20')) $('settingWithdrawFeeTrc20').value = p.usdt_withdraw_fee_trc20 ?? 2;
        if ($('settingWithdrawFeeBep20')) $('settingWithdrawFeeBep20').value = p.usdt_withdraw_fee_bep20 ?? 2;
        if ($('settingWithdrawFeeTrc20Type')) $('settingWithdrawFeeTrc20Type').value = p.usdt_withdraw_fee_trc20_type || 'percent';
        if ($('settingWithdrawFeeBep20Type')) $('settingWithdrawFeeBep20Type').value = p.usdt_withdraw_fee_bep20_type || 'percent';
        if ($('settingWithdrawFeeBank')) $('settingWithdrawFeeBank').value = p.usdt_withdraw_fee_bank ?? 2;
        if ($('settingWithdrawFeeBankType')) $('settingWithdrawFeeBankType').value = p.usdt_withdraw_fee_bank_type || 'percent';
        if ($('settingMinUsdtWithdrawal')) $('settingMinUsdtWithdrawal').value = p.minimum_usdt_withdrawal ?? 10;
        if ($('settingMinMmkWithdrawal')) $('settingMinMmkWithdrawal').value = p.minimum_mmk_withdrawal ?? 10000;
        if ($('settingMmkWithdrawFeePercent')) $('settingMmkWithdrawFeePercent').value = p.mmk_withdraw_fee_percent ?? p.payment_service_fee_percent ?? 2;
        if ($('settingPaymentFeePercent')) $('settingPaymentFeePercent').value = p.payment_service_fee_percent ?? 2;
        if ($('settingPaymentFeeMinUsdt')) $('settingPaymentFeeMinUsdt').value = p.payment_service_fee_minimum_usdt ?? 1;
        if ($('settingPlatformRevenueBalance')) {
          const rev = Number(p.platform_usdt_revenue_balance ?? 0);
          $('settingPlatformRevenueBalance').textContent = rev.toFixed(2) + ' USDT';
        }
        if ($('settingUsdtTrc20')) $('settingUsdtTrc20').value = data.settings?.usdt_trc20_address ?? p.usdt_trc20_address ?? '';
        if ($('settingUsdtBep20')) $('settingUsdtBep20').value = data.settings?.usdt_bep20_address ?? p.usdt_bep20_address ?? '';
        if ($('settingExchangeRate')) $('settingExchangeRate').value = p.mmk_to_usd_rate ?? 4500;
        if ($('settingEffectiveDate')) {
          $('settingEffectiveDate').value = p.rate_effective_date || this.todayDateInputValue();
        }
        if ($('settingNotes')) $('settingNotes').value = '';
        this.updateRateBadge(data.current_rate);
        this.pricingSettings = p;
        this.renderLedgerSummary(data.ledger_summary);
      } catch (err) {
        const out = $('adminSettingsOut');
        if (out) out.textContent = err.message;
      }
    },

    renderLedgerSummary(summary) {
      if (!summary) return;
      const fmtUsdt = (n) => '$' + Number(n || 0).toFixed(2) + ' USDT';
      const fmtMmk = (n) => 'Ks ' + Math.round(Number(n || 0)).toLocaleString() + ' MMK';

      if ($('ledgerTotalUsdt')) $('ledgerTotalUsdt').textContent = fmtUsdt(summary.total_usdt_ledger);
      if ($('ledgerUsdtBreakdown')) {
        const esc = summary.escrow_breakdown || {};
        $('ledgerUsdtBreakdown').textContent =
          `Available ${fmtUsdt(summary.available_usdt)} + Escrow ${fmtUsdt(summary.escrow_usdt)} (Ads ${fmtUsdt(esc.p2p_ads)}, Orders ${fmtUsdt(esc.p2p_sell_orders)})`;
      }
      if ($('ledgerTotalMmk')) $('ledgerTotalMmk').textContent = fmtMmk(summary.total_mmk);
      if ($('ledgerPlatformRevenue')) $('ledgerPlatformRevenue').textContent = fmtUsdt(summary.platform_revenue_usdt);
      if ($('ledgerPendingWithdrawals')) {
        const pending = summary.pending_withdrawals || {};
        $('ledgerPendingWithdrawals').textContent =
          `Pending withdrawals: ${fmtUsdt(pending.net_usdt)} net (${pending.count || 0} request${pending.count === 1 ? '' : 's'})`;
      }
    },

    async loadExchangeRateHistory() {
      const table = $('exchangeRateHistoryTable');
      if (!table) return;

      try {
        const data = await this.api('GET', '/api/admin/exchange-rate-history');
        const history = Array.isArray(data.history) ? data.history : [];

        if (data.current_rate) this.updateRateBadge(data.current_rate);

        if (!history.length) {
          table.innerHTML = '<p class="hint">No exchange rate history yet.</p>';
          return;
        }

        table.innerHTML =
          '<table class="data-table">' +
            '<thead><tr>' +
              '<th>Effective Date &amp; Time</th><th>USD/MMK Rate</th>' +
              '<th>Card Fee (USD)</th><th>Min Deposit</th><th>Updated By</th><th>Notes</th>' +
            '</tr></thead>' +
            '<tbody>' +
            history.map((row) =>
              '<tr>' +
                '<td><small>' + this.esc(row.effective_at || row.created_at) + '</small></td>' +
                '<td><strong>' + Number(row.mmk_to_usd_rate).toLocaleString() + '</strong></td>' +
                '<td>$' + Number(row.card_issuance_fee_usd).toFixed(2) + '</td>' +
                '<td>$' + Number(row.minimum_initial_deposit_usd || 0).toFixed(2) + '</td>' +
                '<td>' + this.esc(row.updated_by || 'admin') + '</td>' +
                '<td><small>' + this.esc(row.notes || '—') + '</small></td>' +
              '</tr>'
            ).join('') +
            '</tbody>' +
          '</table>';
      } catch (err) {
        table.innerHTML = '<p class="hint" style="color:#ef4444">' + this.esc(err.message) + '</p>';
      }
    },

    async loadDeposits(options) {
      options = options || {};
      const table = $('depositsTable');
      if (!table) return;

      const hasExistingRows = Boolean(table.querySelector('table.data-table'));
      if (!hasExistingRows) {
        table.innerHTML = '<p class="hint">Loading deposits…</p>';
      } else {
        table.classList.add('is-refreshing');
      }

      try {
        const filterEl = $('depositFilter');
        const filter = (filterEl && filterEl.value) || 'all';
        let deposits = null;

        // After approve/reject, force the API so we don't show a stale Supabase row
        if (!options.forceApi && window.SupabaseBridge?.isReady()) {
          deposits = await window.SupabaseBridge.fetchAdminDeposits({ status: filter });
        }
        if (!deposits) {
          const qs = filter === 'pending' ? '' : '?status=' + encodeURIComponent(filter);
          const data = await this.api('GET', '/api/admin/deposits' + qs);
          deposits = Array.isArray(data.deposits) ? data.deposits : [];
        }

        this.depositsById = {};
        deposits.forEach((d) => {
          this.depositsById[d.id] = d;
          this.depositsById[String(d.id)] = d;
        });

        if (!deposits.length) {
          table.innerHTML = '<p class="hint">No deposit requests found.</p>';
          return;
        }

        table.innerHTML =
          '<table class="data-table">' +
            '<thead><tr>' +
              '<th>ID</th><th>User</th><th>Purpose</th><th>Pricing Breakdown</th><th>Deposit Ref</th>' +
              '<th>MMK</th><th>USD</th><th>Method</th><th>Status</th><th>Actions</th>' +
            '</tr></thead>' +
            '<tbody>' +
            deposits.map((d) => {
              const pending = ['SUBMITTED', 'UNDER_REVIEW', 'PENDING'].indexOf(String(d.status || '').toUpperCase()) !== -1;
              return '<tr>' +
                '<td>' + d.id + '</td>' +
                '<td>' + this.esc(d.name || d.email || ('User #' + d.user_id)) + '<br><small>#' + d.user_id + '</small></td>' +
                '<td>' + this.renderPurposeBadge(d) + '</td>' +
                '<td>' + this.renderPricingBreakdown(d) + '</td>' +
                '<td>' + this.renderDepositRefCell(d) + '</td>' +
                '<td>' + Number(d.amount_mmk || 0).toLocaleString() + '</td>' +
                '<td>$' + Number(d.amount_usd || 0).toFixed(2) + '</td>' +
                '<td>' + this.esc(d.payment_method || 'KBZPay') + '</td>' +
                '<td>' + this.statusBadge(d.status) + '</td>' +
                '<td class="actions-cell">' +
                  '<button type="button" class="btn btn-sm btn-secondary" data-action="view-deposit-receipt" data-id="' + d.id + '">View Receipt</button>' +
                  (pending
                    ? '<button type="button" class="btn btn-sm btn-approve" data-action="approve-deposit" data-id="' + d.id + '">Approve</button>' +
                      '<button type="button" class="btn btn-sm btn-reject" data-action="reject-deposit" data-id="' + d.id + '">Reject</button>'
                    : '') +
                '</td>' +
              '</tr>';
            }).join('') +
            '</tbody>' +
          '</table>';
      } catch (err) {
        console.error('[Admin] loadDeposits:', err);
        table.innerHTML = '<p class="hint" style="color:#ef4444">Failed to load deposits: ' + this.esc(err.message) + '</p>';
      } finally {
        table.classList.remove('is-refreshing');
      }
    },

    openProofLightbox(src, caption, type) {
      const img = $('adminProofLightboxImg');
      const video = $('adminProofLightboxVideo');
      if (!img || !video || !src) return;

      if (type === 'video') {
        img.classList.add('hidden');
        img.removeAttribute('src');
        video.src = src;
        video.classList.remove('hidden');
        video.controls = true;
        video.play().catch(function () {});
      } else {
        video.pause();
        video.classList.add('hidden');
        video.removeAttribute('src');
        video.load();
        img.src = src;
        img.classList.remove('hidden');
      }

      const captionEl = $('adminProofLightboxCaption');
      if (captionEl) captionEl.textContent = caption || '';
      const lightbox = $('adminProofLightbox');
      if (lightbox) lightbox.classList.remove('hidden');
    },

    closeProofLightbox() {
      const video = $('adminProofLightboxVideo');
      if (video) {
        video.pause();
        video.classList.add('hidden');
        video.removeAttribute('src');
        video.load();
      }
      const img = $('adminProofLightboxImg');
      if (img) {
        img.classList.add('hidden');
        img.src = '';
      }
      const lightbox = $('adminProofLightbox');
      if (lightbox) lightbox.classList.add('hidden');
    },

    async reviewDeposit(id, action, options) {
      options = options || {};
      const depositId = id != null ? String(id) : '';
      if (!depositId) {
        alert('Missing deposit id');
        return;
      }

      const deposit = this.depositsById[depositId]
        || this.depositsById[parseInt(depositId, 10)]
        || null;

      let note = action === 'reject' ? 'Rejected by admin' : 'Approved';
      try {
        const promptMsg = action === 'reject'
          ? 'Rejection reason (optional):'
          : 'Admin note (optional):';
        const promptDefault = action === 'reject' ? 'Rejected by admin' : 'Approved';
        const entered = window.prompt(promptMsg, promptDefault);
        if (entered === null) return; // user cancelled
        note = String(entered).trim() || promptDefault;
      } catch (promptErr) {
        // Some WebViews block window.prompt — continue with default note
        console.warn('[Admin] prompt unavailable, using default note:', promptErr.message);
      }

      const btn = options.triggerBtn || null;
      const prevLabel = btn ? btn.textContent : '';
      if (btn) {
        btn.disabled = true;
        btn.textContent = action === 'approve' ? 'Approving…' : 'Rejecting…';
      }

      try {
        console.log('[Admin] reviewDeposit', action, 'id=', depositId, deposit?.purpose);

        const data = await this.api('POST', '/api/admin/deposits/' + encodeURIComponent(depositId) + '/review', {
          action: action,
          admin_note: note,
          rejection_reason: action === 'reject' ? note : undefined,
        });

        console.log('[Admin] reviewDeposit result:', data.message, data.card ? 'card=' + data.card.id : '');

        // Prefer API source of truth after mutation (avoids stale Supabase race)
        await Promise.all([
          this.loadDeposits({ forceApi: true }),
          this.loadTransactions(),
          this.loadUsers(),
          this.loadPendingCards(),
          this.loadPendingReloads(),
        ]);

        if (options.closeReceiptModal) {
          this.closeDepositReceiptModal();
        }

        if (action === 'approve') {
          if (data.card) {
            alert(data.message || 'Deposit approved and card activated automatically.');
          } else if (deposit && deposit.purpose === 'card_issuance' && !options.skipIssueForm) {
            alert(data.message || 'Deposit verified. Activate the pending card to complete issuance.');
            this.fillIssueCardFormFromDeposit(deposit);
            this.switchTab('cards');
          } else {
            alert(data.message || 'Deposit approved and wallet credited.');
          }
        } else {
          alert(data.message || 'Deposit rejected.');
        }
      } catch (err) {
        console.error('[Admin] reviewDeposit failed:', err);
        alert(err.message || 'Failed to update deposit');
        if (btn) {
          btn.disabled = false;
          btn.textContent = prevLabel || (action === 'approve' ? 'Approve' : 'Reject');
        }
      }
    },

    async loadPendingCards() {
      const table = $('pendingCardsTable');
      if (!table) return;

      try {
        let cards = null;
        if (window.SupabaseBridge?.isReady()) {
          cards = await window.SupabaseBridge.fetchAdminPendingCards();
        }
        if (!cards) {
          const data = await this.api('GET', '/api/admin/cards/pending');
          cards = Array.isArray(data.cards) ? data.cards : [];
        }
        this.pendingCardsById = {};
        cards.forEach((c) => { this.pendingCardsById[c.id] = c; });

        if (!cards.length) {
          table.innerHTML = '<p class="hint">' + this.esc(typeof t === 'function' ? t('no_pending_card_requests') : 'No pending card requests.') + '</p>';
          return;
        }

        const th = (key, fallback) => (typeof t === 'function' ? t(key) : fallback);

        table.innerHTML =
          '<table class="data-table">' +
            '<thead><tr>' +
              '<th>' + th('th_id', 'ID') + '</th><th>' + th('th_user', 'User') + '</th><th>' + th('th_status', 'Status') + '</th><th>' + th('th_holder', 'Holder') + '</th><th>' + th('th_pricing', 'Pricing') + '</th><th>' + th('th_deposit_ref', 'Deposit Ref') + '</th><th>' + th('th_requested', 'Requested') + '</th><th>' + th('th_actions', 'Actions') + '</th>' +
            '</tr></thead>' +
            '<tbody>' +
            cards.map((c) => {
              const depositPending = c.deposit_status
                && ['SUBMITTED', 'UNDER_REVIEW', 'PENDING'].indexOf(c.deposit_status) !== -1;
              const depositVerified = c.deposit_status === 'VERIFIED';
              const awaitingPayment = c.deposit_id && !depositPending && !depositVerified;
              const statusLabel = c.display_status || c.issuance_status || (typeof t === 'function' ? t('pending_issuance') : 'PENDING_ISSUANCE');
              const issueLabel = typeof t === 'function' ? t('btn_issue_card') : 'Issue Card';
              const rejectLabel = typeof t === 'function' ? t('btn_reject') : 'Reject';

              return '<tr>' +
                '<td>' + c.id + '</td>' +
                '<td>' + this.esc(c.name || c.email) + '<br><small>#' + c.user_id + '</small></td>' +
                '<td><span class="badge">' + this.esc(statusLabel) + '</span></td>' +
                '<td>' + this.esc(c.card_holder_name || c.name || '—') + '</td>' +
                '<td>' + this.renderPricingBreakdown({ purpose: 'card_issuance', pricing: c.pricing, pricing_breakdown: c.pricing, amount_usd: c.pricing?.total_usd_required, amount_mmk: c.pricing?.total_mmk, metadata: { card_request_id: c.id } }) + '</td>' +
                '<td>' + this.renderDepositRefCell(c) + '</td>' +
                '<td>' + this.esc(c.created_at || '—') + '</td>' +
                '<td class="actions-cell">' +
                  (awaitingPayment
                    ? '<span class="hint">' + this.esc(c.deposit_status || 'Awaiting payment') + '</span>'
                    : '<button type="button" class="btn btn-sm btn-approve" data-action="issue-card" data-id="' + c.id + '">' + issueLabel + '</button>' +
                      '<button type="button" class="btn btn-sm btn-reject" data-action="reject-card" data-id="' + c.id + '">' + rejectLabel + '</button>') +
                '</td>' +
              '</tr>';
            }).join('') +
            '</tbody>' +
          '</table>';
      } catch (err) {
        table.innerHTML = '<p class="hint" style="color:#ef4444">' + this.esc(err.message) + '</p>';
      }
    },

    cardStatusSelectOptions(currentStatus) {
      const current = String(currentStatus || 'active').toLowerCase();
      const options = [
        { value: 'active', label: 'ACTIVE' },
        { value: 'suspended', label: 'SUSPENDED' },
        { value: 'frozen', label: 'FROZEN' },
        { value: 'terminated', label: 'TERMINATED' },
      ];
      return options.map((o) =>
        '<option value="' + o.value + '"' + (current === o.value ? ' selected' : '') + '>' + o.label + '</option>'
      ).join('');
    },

    async loadIssuedCards() {
      const table = $('issuedCardsTable');
      if (!table) return;

      try {
        const data = await this.api('GET', '/api/admin/cards/issued');
        const cards = Array.isArray(data.cards) ? data.cards : [];
        this.issuedCardsById = {};
        cards.forEach((c) => { this.issuedCardsById[c.id] = c; });

        if (!cards.length) {
          table.innerHTML = '<p class="hint">No issued virtual cards yet.</p>';
          return;
        }

        table.innerHTML =
          '<table class="data-table">' +
            '<thead><tr>' +
              '<th>ID</th><th>User</th><th>Card</th><th>Current Status</th><th>New Status</th><th>Reason (optional)</th><th>Updated</th><th>Actions</th>' +
            '</tr></thead>' +
            '<tbody>' +
            cards.map((c) =>
              '<tr>' +
                '<td>' + c.id + '</td>' +
                '<td>' + this.esc(c.user_name || c.user_email || '—') + '<br><small>#' + c.user_id + '</small></td>' +
                '<td><code>' + this.esc(c.label) + '</code><br><small>' + this.esc(c.card_holder_name || '—') + '</small></td>' +
                '<td>' + this.cardStatusBadge(c.display_status || c.status) +
                  (c.status_reason ? '<br><small class="hint">' + this.esc(c.status_reason) + '</small>' : '') +
                '</td>' +
                '<td><select class="admin-card-status-select" data-card-status-select aria-label="New status for card ' + c.id + '">' +
                  this.cardStatusSelectOptions(c.status) +
                '</select></td>' +
                '<td><input type="text" class="admin-card-status-reason" data-card-status-reason placeholder="Reason shown to user" value="' + this.esc(c.status_reason || '') + '" /></td>' +
                '<td><small>' + this.esc(c.created_at || '—') + '</small></td>' +
                '<td class="actions-cell">' +
                  '<button type="button" class="btn btn-sm btn-secondary" data-action="edit-card" data-id="' + c.id + '">Edit</button> ' +
                  '<button type="button" class="btn btn-sm btn-primary" data-action="update-card-status" data-id="' + c.id + '">Update Status</button>' +
                '</td>' +
              '</tr>'
            ).join('') +
            '</tbody>' +
          '</table>';
      } catch (err) {
        table.innerHTML = '<p class="hint" style="color:#ef4444">' + this.esc(err.message) + '</p>';
      }
    },

    async updateIssuedCardStatus(cardId, status, statusReason) {
      if (!cardId || !status) return;
      try {
        const data = await this.api('POST', '/api/admin/cards/' + cardId + '/status', {
          status,
          status_reason: statusReason || undefined,
        });
        await this.loadIssuedCards();
        alert(data.message || 'Card status updated');
      } catch (err) {
        alert(err.message || 'Failed to update card status');
      }
    },

    async loadUsers() {
      const table = $('usersTable');
      if (!table) return;

      try {
        const data = await this.api('GET', '/api/admin/users');
        const users = Array.isArray(data.users) ? data.users : [];

        if (!users.length) {
          table.innerHTML = '<p class="hint">No users found.</p>';
          return;
        }

        table.innerHTML =
          '<table class="data-table">' +
            '<thead><tr><th>ID</th><th>Name</th><th>Email</th><th>MMK Wallet</th><th>USDT Wallet</th><th>Status</th><th>Actions</th></tr></thead>' +
            '<tbody>' +
            users.map((u) =>
              '<tr>' +
                '<td>' + u.id + '</td>' +
                '<td>' + this.esc(u.name || '—') + '</td>' +
                '<td>' + this.esc(u.email || '—') + '</td>' +
                '<td><strong>Ks ' + Number(u.balance_mmk || 0).toLocaleString() + '</strong></td>' +
                '<td><strong>$' + Number(u.balance_usdt || 0).toFixed(2) + ' USDT</strong></td>' +
                '<td>' + this.esc(u.auth_status || 'active') + '</td>' +
                '<td class="actions-cell">' +
                  '<button type="button" class="btn btn-sm btn-secondary view-card-requests">Card Requests</button>' +
                  '<button type="button" class="btn btn-sm btn-secondary adj-mmk-wallet" data-uid="' + u.id + '" data-mmk="' + Number(u.balance_mmk || 0) + '">Adjust MMK</button>' +
                  '<button type="button" class="btn btn-sm btn-secondary adj-usdt-wallet" data-uid="' + u.id + '" data-usdt="' + Number(u.balance_usdt || 0) + '">Adjust USDT</button>' +
                '</td>' +
              '</tr>'
            ).join('') +
            '</tbody>' +
          '</table>';

        table.querySelectorAll('.adj-mmk-wallet').forEach((btn) => {
          btn.addEventListener('click', () => {
            if ($('adjUserId')) $('adjUserId').value = btn.dataset.uid;
            if ($('adjAmountMmk')) $('adjAmountMmk').value = '';
            if ($('adjReason')) $('adjReason').value = 'Manual MMK wallet adjustment for user #' + btn.dataset.uid + ' (current: Ks ' + Number(btn.dataset.mmk).toLocaleString() + ')';
            $('balanceAdjustForm')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          });
        });

        table.querySelectorAll('.adj-usdt-wallet').forEach((btn) => {
          btn.addEventListener('click', () => {
            if ($('adjUsdtUserId')) $('adjUsdtUserId').value = btn.dataset.uid;
            if ($('adjAmountUsdt')) $('adjAmountUsdt').value = '';
            if ($('adjUsdtReason')) $('adjUsdtReason').value = 'Manual USDT wallet adjustment for user #' + btn.dataset.uid + ' (current: $' + Number(btn.dataset.usdt).toFixed(2) + ' USDT)';
            $('balanceAdjustUsdtForm')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          });
        });
      } catch (err) {
        table.innerHTML = '<p class="hint" style="color:#ef4444">' + this.esc(err.message) + '</p>';
      }
    },

    async loadTransactions() {
      const table = $('transactionsTable');
      if (!table) return;

      const category = this.txCategory || 'p2p';

      try {
        const userFilter = $('txUserFilter');
        const userId = userFilter && userFilter.value;
        let path = '/api/admin/transactions?category=' + encodeURIComponent(category);
        if (userId) path += '&user_id=' + encodeURIComponent(userId);
        const data = await this.api('GET', path);
        const transactions = Array.isArray(data.transactions) ? data.transactions : [];

        if (!transactions.length) {
          table.innerHTML = '<p class="hint">No ' + (category === 'p2p' ? 'P2P' : 'card reload') + ' transactions yet.</p>';
          return;
        }

        if (category === 'p2p') {
          table.innerHTML =
            '<table class="data-table">' +
              '<thead><tr>' +
              '<th>Time</th><th>Order</th><th>Side</th><th>Escrow (USDT)</th>' +
              '<th>Buyer</th><th>Seller</th><th>P2P Fee</th><th>Status</th>' +
              '</tr></thead><tbody>' +
              transactions.map((t) =>
                '<tr>' +
                  '<td><small>' + this.esc(t.released_at || t.created_at || '—') + '</small></td>' +
                  '<td><code>' + this.esc(t.ref_code) + '</code><br><small>#' + t.id + '</small></td>' +
                  '<td>' + this.esc(t.side || '—') + '</td>' +
                  '<td>' + Number(t.escrow_usdt || 0).toFixed(2) + '</td>' +
                  '<td><small>' + this.esc(t.buyer?.name || t.buyer?.email || t.buyer?.user_id || '—') + '</small></td>' +
                  '<td><small>' + this.esc(t.seller?.name || t.seller?.email || t.seller?.user_id || '—') + '</small></td>' +
                  '<td><strong>' + Number(t.platform_fee_usdt || 0).toFixed(2) + ' USDT</strong></td>' +
                  '<td><span class="badge">' + this.esc(t.status) + '</span></td>' +
                '</tr>'
              ).join('') +
              '</tbody></table>';
          return;
        }

        table.innerHTML =
          '<table class="data-table">' +
            '<thead><tr>' +
            '<th>Time</th><th>Reload ID</th><th>User</th><th>Reload Amount</th>' +
            '<th>Fee / Markup</th><th>Wallet</th><th>Provider Status</th>' +
            '</tr></thead><tbody>' +
            transactions.map((t) =>
              '<tr>' +
                '<td><small>' + this.esc(t.reviewed_at || t.created_at || '—') + '</small></td>' +
                '<td><code>' + this.esc(t.ref_code || ('RELOAD-' + t.id)) + '</code></td>' +
                '<td><small>' + this.esc(t.user_name || t.user_email || t.user_id) + '</small></td>' +
                '<td>$' + Number(t.reload_amount_usd || 0).toFixed(2) + '</td>' +
                '<td><strong>$' + Number(t.fee_profit_usd || 0).toFixed(2) + '</strong></td>' +
                '<td>' + this.esc((t.wallet_type || '—').toUpperCase()) + '</td>' +
                '<td><span class="badge">' + this.esc(t.provider_status || t.status) + '</span></td>' +
              '</tr>'
            ).join('') +
            '</tbody></table>';
      } catch (err) {
        table.innerHTML = '<p class="hint" style="color:#ef4444">' + this.esc(err.message) + '</p>';
      }
    },

    async loadSupportThreads() {
      const list = $('supportThreadsList');
      if (!list) return;

      try {
        const data = await this.api('GET', '/api/admin/support/threads');
        const threads = Array.isArray(data.threads) ? data.threads : [];

        if (!threads.length) {
          list.innerHTML = '<p class="hint">No support threads.</p>';
          return;
        }

        list.innerHTML = threads.map((t) =>
          '<div class="thread-item' + (t.id === this.activeThreadId ? ' active' : '') + '" data-id="' + t.id + '" role="button" tabindex="0">' +
            '<strong>' + this.esc(t.subject) + '</strong>' +
            '<small>' + this.esc(t.name || t.email) + ' · ' + this.esc(t.status) + '</small>' +
          '</div>'
        ).join('');

        list.querySelectorAll('.thread-item').forEach((el) => {
          el.addEventListener('click', () => this.openThread(parseInt(el.dataset.id, 10)));
        });
      } catch (err) {
        list.innerHTML = '<p class="hint" style="color:#ef4444">' + this.esc(err.message) + '</p>';
      }
    },

    async openThread(id) {
      this.activeThreadId = id;
      try {
        const data = await this.api('GET', '/api/admin/support/threads/' + id + '/messages');
        const thread = data.thread || {};
        const messages = Array.isArray(data.messages) ? data.messages : [];

        const title = $('supportThreadTitle');
        if (title) title.textContent = thread.subject || 'Thread';

        const replyForm = $('supportReplyForm');
        if (replyForm) replyForm.classList.remove('hidden');

        const messagesEl = $('supportMessages');
        if (messagesEl) {
          messagesEl.innerHTML = messages.map((m) =>
            '<div class="msg msg-' + this.esc(m.sender_type) + '">' +
              '<strong>' + this.esc(m.sender_type) + '</strong>' +
              '<p>' + this.esc(m.message) + '</p>' +
              '<small>' + this.esc(m.created_at) + '</small>' +
            '</div>'
          ).join('');
        }
      } catch (err) {
        alert(err.message);
      }
    },

    async loadRevenueDashboard() {
      const metricsEl = $('revenueMetricsGrid');
      const periodEl = $('revenuePeriodRow');
      const dailyEl = $('revenueDailyTable');
      const auditEl = $('revenueAuditTable');
      if (!metricsEl) return;

      metricsEl.innerHTML = '<p class="hint">Loading revenue metrics…</p>';
      if (dailyEl) dailyEl.innerHTML = '<p class="hint">Loading…</p>';
      if (auditEl) auditEl.innerHTML = '<p class="hint">Loading…</p>';

      try {
        const data = await this.api('GET', '/api/admin/revenue/dashboard');
        const s = data.summary || {};
        const rate = Number(s.mmk_to_usd_rate || 4500);

        metricsEl.innerHTML = `
          <div class="revenue-metric-card highlight">
            <div class="revenue-metric-label">Total Net Admin Profit (Today)</div>
            <div class="revenue-metric-value">$${Number(s.today_net_admin_profit_usd || s.today_profit_usd || 0).toFixed(2)}</div>
            <div class="revenue-metric-sub">P2P + Card Reload + Withdrawal · ${Math.round(Number(s.today_net_admin_profit_mmk || s.today_profit_mmk || 0)).toLocaleString()} MMK</div>
          </div>
          <div class="revenue-metric-card">
            <div class="revenue-metric-label">P2P Trading Profit</div>
            <div class="revenue-metric-value">${Number(s.today_p2p_profit_usdt || s.today_p2p_fees_usdt || 0).toFixed(2)} USDT</div>
            <div class="revenue-metric-sub">Today · All-time ${Number(s.all_time_p2p_profit_usdt || s.all_time_p2p_usdt || 0).toFixed(2)} USDT</div>
          </div>
          <div class="revenue-metric-card">
            <div class="revenue-metric-label">Card Reload Profit</div>
            <div class="revenue-metric-value">$${Number(s.today_card_reload_profit_usd || 0).toFixed(2)}</div>
            <div class="revenue-metric-sub">Today markup/fees · All-time $${Number(s.all_time_card_reload_profit_usd || 0).toFixed(2)}</div>
          </div>
          <div class="revenue-metric-card">
            <div class="revenue-metric-label">Withdrawal Fees</div>
            <div class="revenue-metric-value">${Number(s.today_withdrawal_profit_usdt || 0).toFixed(2)} USDT</div>
            <div class="revenue-metric-sub">Today · All-time ${Number(s.all_time_withdrawal_profit_usdt || 0).toFixed(2)} USDT · Platform balance ${Number(s.platform_usdt_revenue_balance || 0).toFixed(2)} USDT</div>
          </div>
          <div class="revenue-metric-card">
            <div class="revenue-metric-label">All-Time Net Admin Profit</div>
            <div class="revenue-metric-value">$${Number(s.all_time_net_admin_profit_usd || s.all_time_profit_usd || 0).toFixed(2)}</div>
            <div class="revenue-metric-sub">${Math.round(Number(s.all_time_net_admin_profit_mmk || s.all_time_profit_mmk || 0)).toLocaleString()} MMK · ${Number(data.counts?.total_fee_events || 0)} fee events</div>
          </div>
        `;

        if (periodEl) {
          const pt = data.period_totals || {};
          periodEl.classList.remove('hidden');
          periodEl.innerHTML = `
            <span class="revenue-period-chip">Today: <strong>$${Number(pt.today || 0).toFixed(2)}</strong></span>
            <span class="revenue-period-chip">Yesterday: <strong>$${Number(pt.yesterday || 0).toFixed(2)}</strong></span>
            <span class="revenue-period-chip">Last 7 Days: <strong>$${Number(pt.last_7_days || 0).toFixed(2)}</strong></span>
            <span class="revenue-period-chip">This Month: <strong>$${Number(pt.this_month || 0).toFixed(2)}</strong></span>
          `;
        }

        const daily = data.daily_breakdown || [];
        if (dailyEl) {
          if (!daily.length) {
            dailyEl.innerHTML = '<p class="hint">No fee collections recorded yet.</p>';
          } else {
            dailyEl.innerHTML =
              '<table class="data-table">' +
              '<thead><tr>' +
              '<th>Date</th><th>P2P Fees (USDT)</th><th>Card Reload ($)</th><th>Withdrawal (USDT)</th><th>Card Issue ($)</th><th>Total ($)</th><th>Total (MMK)</th><th>Txns</th>' +
              '</tr></thead><tbody>' +
              daily.map((row) =>
                '<tr>' +
                '<td><strong>' + this.esc(row.label || row.date) + '</strong><br><small>' + this.esc(row.date) + '</small></td>' +
                '<td>' + Number(row.p2p_fees_usdt || 0).toFixed(2) + '</td>' +
                '<td>$' + Number(row.card_reload_fees_usd || 0).toFixed(2) + '</td>' +
                '<td>' + Number(row.withdrawal_fees_usdt || 0).toFixed(2) + '</td>' +
                '<td>$' + Number(row.card_issue_fees_usd || 0).toFixed(2) + '</td>' +
                '<td><strong>$' + Number(row.total_usd_equivalent || 0).toFixed(2) + '</strong></td>' +
                '<td>' + Math.round(Number(row.total_mmk_equivalent || 0)).toLocaleString() + '</td>' +
                '<td>' + (row.transaction_count || 0) + '</td>' +
                '</tr>'
              ).join('') +
              '</tbody></table>';
          }
        }

        const audit = data.fee_audit_log || [];
        if (auditEl) {
          if (!audit.length) {
            auditEl.innerHTML = '<p class="hint">No fee audit records yet.</p>';
          } else {
            auditEl.innerHTML =
              '<table class="data-table">' +
              '<thead><tr>' +
              '<th>Date / Time</th><th>Category</th><th>Source</th><th>Order Ref</th><th>Amount</th><th>MMK Equiv.</th><th>Status</th>' +
              '</tr></thead><tbody>' +
              audit.map((row) =>
                '<tr>' +
                '<td>' + this.esc(row.collected_at || '—') + '</td>' +
                '<td><code>' + this.esc(row.fee_type || '—') + '</code></td>' +
                '<td>' + this.esc(row.source) + '</td>' +
                '<td><code>' + this.esc(row.order_ref) + '</code></td>' +
                '<td><strong>' + this.esc(row.amount_display) + '</strong></td>' +
                '<td>' + Math.round(Number(row.amount_mmk || 0)).toLocaleString() + ' MMK</td>' +
                '<td><span class="badge badge-ok">' + this.esc(row.status) + '</span></td>' +
                '</tr>'
              ).join('') +
              '</tbody></table>';
          }
        }
      } catch (err) {
        metricsEl.innerHTML = '<p class="hint" style="color:#ef4444">' + this.esc(err.message) + '</p>';
        if (dailyEl) dailyEl.innerHTML = '';
        if (auditEl) auditEl.innerHTML = '';
        if (periodEl) periodEl.classList.add('hidden');
      }
    },
  };

  function boot() {
    Admin.init();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.Admin = Admin;
})();
