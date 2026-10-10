/**
 * Admin user detail modal — modular tabbed pop-up for a single user directory row.
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  function install(Admin) {
    if (!Admin || Admin._userDetailInstalled) return;
    Admin._userDetailInstalled = true;

    Admin.userDetailState = {
      userId: null,
      tab: 'profile',
      financeKind: 'deposits',
      financeOffset: 0,
      financeLimit: 15,
      txOffset: 0,
      txLimit: 15,
      supportThreadId: null,
    };

    Admin.openUserDetailModal = function openUserDetailModal(userRow) {
      const id = userRow && (userRow.id || userRow.user_id);
      if (!id) return;
      this.userDetailState.userId = String(id);
      this.userDetailState.financeOffset = 0;
      this.userDetailState.txOffset = 0;
      this.userDetailState.tab = 'profile';
      const modal = $('userDetailModal');
      if (!modal) return;
      modal.classList.remove('hidden');
      modal.setAttribute('aria-hidden', 'false');
      document.body.classList.add('sidebar-scroll-lock');
      const title = $('userDetailModalTitle');
      if (title) title.textContent = userRow.name || userRow.email || ('User #' + id);
      const sub = $('userDetailModalSubtitle');
      if (sub) {
        sub.textContent = [
          userRow.email ? String(userRow.email) : '',
          userRow.id ? 'ID ' + userRow.id : '',
        ].filter(Boolean).join(' · ');
      }
      this.switchUserDetailTab('profile');
      this.loadUserDetailProfile().catch(() => {});
    };

    Admin.closeUserDetailModal = function closeUserDetailModal() {
      const modal = $('userDetailModal');
      if (modal) {
        modal.classList.add('hidden');
        modal.setAttribute('aria-hidden', 'true');
      }
      document.body.classList.remove('sidebar-scroll-lock');
      this.userDetailState.userId = null;
    };

    Admin.switchUserDetailTab = function switchUserDetailTab(tab) {
      this.userDetailState.tab = tab;
      document.querySelectorAll('[data-user-detail-tab]').forEach((btn) => {
        const active = btn.getAttribute('data-user-detail-tab') === tab;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      document.querySelectorAll('[data-user-detail-panel]').forEach((panel) => {
        panel.classList.toggle('hidden', panel.getAttribute('data-user-detail-panel') !== tab);
      });
      const uid = this.userDetailState.userId;
      if (!uid) return;
      if (tab === 'profile') this.loadUserDetailProfile().catch(() => {});
      if (tab === 'finance') this.loadUserDetailFinance().catch(() => {});
      if (tab === 'cards') this.loadUserDetailCards().catch(() => {});
      if (tab === 'transactions') this.loadUserDetailTransactions().catch(() => {});
      if (tab === 'support') this.loadUserDetailSupport().catch(() => {});
    };

    Admin.loadUserDetailProfile = async function loadUserDetailProfile() {
      const kv = $('userDetailProfileKv');
      const uid = this.userDetailState.userId;
      if (!kv || !uid) return;
      if (!this.hasPermission('users')) {
        kv.innerHTML = '<p class="hint">You do not have permission to view user profiles.</p>';
        return;
      }
      kv.innerHTML = '<p class="hint">Loading profile…</p>';
      try {
        const data = await this.api('GET', '/api/admin/users/' + uid + '/detail');
        const u = data.user || {};
        const rows = [
          ['Name', u.name || '—'],
          ['Email', u.email || '—'],
          ['Phone', u.phone || '—'],
          ['Account status', u.auth_status || '—'],
          ['Registered', this.formatUserCreated(u.created_at)],
          ['USDT wallet', '$' + Number(u.balance_usdt || 0).toFixed(2)],
          ['MMK wallet', Number(u.balance_mmk || 0).toLocaleString() + ' MMK'],
          ['Auth user id', u.auth_user_id || '—'],
        ];
        kv.innerHTML = rows.map(([label, value]) =>
          '<div><dt>' + this.esc(label) + '</dt><dd>' + this.esc(String(value)) + '</dd></div>'
        ).join('');
      } catch (err) {
        kv.innerHTML = '<p class="hint" style="color:#f87171">' + this.esc(err.message) + '</p>';
      }
    };

    Admin.renderUserDetailFinanceRows = function renderUserDetailFinanceRows(kind, rows) {
      if (!rows.length) return '<p class="hint">No records found.</p>';
      if (kind === 'deposits') {
        return (
          '<table class="data-table"><thead><tr>' +
          '<th>Ref</th><th>Amount</th><th>Network</th><th>Status</th><th>Tx hash</th><th>Date</th>' +
          '</tr></thead><tbody>' +
          rows.map((r) =>
            '<tr>' +
              '<td><code>' + this.esc(r.ref_code || r.id) + '</code></td>' +
              '<td><strong>$' + Number(r.amount_usdt || 0).toFixed(2) + '</strong></td>' +
              '<td>' + this.esc(r.network || '—') + '</td>' +
              '<td>' + this.esc(r.status || '—') + '</td>' +
              '<td><code>' + this.esc(r.tx_hash || '—') + '</code></td>' +
              '<td><small>' + this.esc(r.reviewed_at || r.created_at || '—') + '</small></td>' +
            '</tr>'
          ).join('') +
          '</tbody></table>'
        );
      }
      return (
        '<table class="data-table"><thead><tr>' +
        '<th>Ref</th><th>Amount</th><th>Net</th><th>Method</th><th>Status</th><th>Date</th>' +
        '</tr></thead><tbody>' +
        rows.map((r) =>
          '<tr>' +
            '<td><code>' + this.esc(r.ref_code || r.id) + '</code></td>' +
            '<td>$' + Number(r.amount_usdt || r.amount_mmk || 0).toFixed(2) + '</td>' +
            '<td>' + (r.net_usdt != null ? ('$' + Number(r.net_usdt).toFixed(2)) : (r.net_mmk != null ? Number(r.net_mmk).toLocaleString() + ' MMK' : '—')) + '</td>' +
            '<td>' + this.esc(r.payout_method || r.method || '—') + '</td>' +
            '<td>' + this.esc(r.status || '—') + '</td>' +
            '<td><small>' + this.esc(r.created_at || r.completed_at || '—') + '</small></td>' +
          '</tr>'
        ).join('') +
        '</tbody></table>'
      );
    };

    Admin.loadUserDetailFinance = async function loadUserDetailFinance() {
      const table = $('userDetailFinanceTable');
      const uid = this.userDetailState.userId;
      if (!table || !uid) return;
      if (!this.hasPermission('users')) {
        table.innerHTML = '<p class="hint">You do not have permission to view financial history.</p>';
        return;
      }
      const st = this.userDetailState;
      const kind = st.financeKind || 'deposits';
      table.innerHTML = '<p class="hint">Loading…</p>';
      try {
        const qs = new URLSearchParams({
          kind,
          limit: String(st.financeLimit),
          offset: String(st.financeOffset),
        });
        const data = await this.api('GET', '/api/admin/users/' + uid + '/detail/finance?' + qs.toString());
        table.innerHTML = this.renderUserDetailFinanceRows(kind, data.rows || []);
        const meta = $('userDetailFinanceMeta');
        const total = Number(data.total || 0);
        const from = total ? st.financeOffset + 1 : 0;
        const to = Math.min(st.financeOffset + st.financeLimit, total);
        if (meta) meta.textContent = total ? (from + '–' + to + ' of ' + total) : '';
        const prev = $('userDetailFinancePrev');
        const next = $('userDetailFinanceNext');
        if (prev) prev.disabled = st.financeOffset <= 0;
        if (next) next.disabled = !data.has_more;
      } catch (err) {
        table.innerHTML = '<p class="hint" style="color:#f87171">' + this.esc(err.message) + '</p>';
      }
    };

    Admin.loadUserDetailCards = async function loadUserDetailCards() {
      const table = $('userDetailCardsTable');
      const uid = this.userDetailState.userId;
      if (!table || !uid) return;
      if (!this.hasPermission('cards')) {
        table.innerHTML = '<p class="hint">You do not have permission to view cards.</p>';
        return;
      }
      table.innerHTML = '<p class="hint">Loading cards…</p>';
      try {
        const data = await this.api('GET', '/api/admin/users/' + uid + '/detail/cards');
        const cards = Array.isArray(data.cards) ? data.cards : [];
        if (!cards.length) {
          table.innerHTML = '<p class="hint">No virtual cards for this user.</p>';
          return;
        }
        table.innerHTML =
          '<table class="data-table"><thead><tr>' +
          '<th>Brand</th><th>Pago ID</th><th>Masked number</th><th>Balance</th><th>Status</th><th>Actions</th>' +
          '</tr></thead><tbody>' +
          cards.map((c) =>
            '<tr>' +
              '<td>' + this.esc(c.brand || c.product_code || '—') + '</td>' +
              '<td><code>' + this.esc(c.pago_card_id || '—') + '</code></td>' +
              '<td><code>' + this.esc(c.masked_number || c.label || '—') + '</code></td>' +
              '<td>$' + Number(c.balance_usd || 0).toFixed(2) + '</td>' +
              '<td>' + this.cardStatusBadge(c.display_status || c.status) + '</td>' +
              '<td class="actions-cell">' +
                '<button type="button" class="btn btn-sm btn-secondary user-detail-open-cards-tab" data-local-card-id="' + c.id + '">Manage</button>' +
              '</td>' +
            '</tr>'
          ).join('') +
          '</tbody></table>';
        table.querySelectorAll('.user-detail-open-cards-tab').forEach((btn) => {
          btn.addEventListener('click', () => {
            this.closeUserDetailModal();
            this.switchTab('cards');
            if (typeof this.loadIssuedCards === 'function') this.loadIssuedCards();
          });
        });
      } catch (err) {
        table.innerHTML = '<p class="hint" style="color:#f87171">' + this.esc(err.message) + '</p>';
      }
    };

    Admin.loadUserDetailTransactions = async function loadUserDetailTransactions() {
      const table = $('userDetailTxTable');
      const uid = this.userDetailState.userId;
      if (!table || !uid) return;
      if (!this.hasPermission('cards')) {
        table.innerHTML = '<p class="hint">You do not have permission to view card transactions.</p>';
        return;
      }
      const st = this.userDetailState;
      table.innerHTML = '<p class="hint">Loading transactions…</p>';
      try {
        const qs = new URLSearchParams({
          limit: String(st.txLimit),
          offset: String(st.txOffset),
        });
        const data = await this.api('GET', '/api/admin/users/' + uid + '/detail/card-transactions?' + qs.toString());
        const rows = Array.isArray(data.rows) ? data.rows : [];
        if (!rows.length) {
          table.innerHTML = '<p class="hint">No card transactions found.</p>';
        } else {
          table.innerHTML =
            '<table class="data-table"><thead><tr>' +
            '<th>When</th><th>Source</th><th>Merchant / detail</th><th>Amount</th><th>Status</th>' +
            '</tr></thead><tbody>' +
            rows.map((r) =>
              '<tr>' +
                '<td><small>' + this.esc(r.created_at || '—') + '</small></td>' +
                '<td>' + this.esc(r.source || r.type || '—') + '</td>' +
                '<td>' + this.esc(r.merchant || r.description || '—') + '</td>' +
                '<td>' + (r.amount_usd != null ? ('$' + Number(r.amount_usd).toFixed(2)) : '—') + '</td>' +
                '<td>' + this.esc(r.status || '—') + '</td>' +
              '</tr>'
            ).join('') +
            '</tbody></table>';
        }
        const total = Number(data.total || 0);
        const meta = $('userDetailTxMeta');
        const from = total ? st.txOffset + 1 : 0;
        const to = Math.min(st.txOffset + st.txLimit, total);
        if (meta) meta.textContent = total ? (from + '–' + to + ' of ' + total) : '';
        const prev = $('userDetailTxPrev');
        const next = $('userDetailTxNext');
        if (prev) prev.disabled = st.txOffset <= 0;
        if (next) next.disabled = !data.has_more;
      } catch (err) {
        table.innerHTML = '<p class="hint" style="color:#f87171">' + this.esc(err.message) + '</p>';
      }
    };

    Admin.renderUserDetailSupportMessages = function renderUserDetailSupportMessages(messages) {
      const box = $('userDetailSupportMessages');
      if (!box) return;
      const list = Array.isArray(messages) ? messages : [];
      if (!list.length) {
        box.innerHTML = '<p class="hint" style="margin:0">No messages yet.</p>';
        return;
      }
      box.innerHTML = list.map((m) => {
        const admin = String(m.sender_type || '').toLowerCase() === 'admin';
        return (
          '<div class="user-detail-msg ' + (admin ? 'is-admin' : 'is-user') + '">' +
            this.esc(m.message || '') +
            '<br><small class="hint">' + this.esc(m.created_at || '') + '</small>' +
          '</div>'
        );
      }).join('');
      box.scrollTop = box.scrollHeight;
    };

    Admin.loadUserDetailSupport = async function loadUserDetailSupport() {
      const uid = this.userDetailState.userId;
      if (!uid) return;
      const select = $('userDetailSupportThreadSelect');
      const errEl = $('userDetailSupportError');
      if (errEl) errEl.classList.add('hidden');
      if (!this.hasPermission('support')) {
        if ($('userDetailSupportMessages')) {
          $('userDetailSupportMessages').innerHTML = '<p class="hint">You do not have permission to reply to support.</p>';
        }
        return;
      }
      try {
        const threadId = this.userDetailState.supportThreadId;
        const qs = threadId ? ('?thread_id=' + encodeURIComponent(threadId)) : '';
        const data = await this.api('GET', '/api/admin/users/' + uid + '/detail/support' + qs);
        const threads = Array.isArray(data.threads) ? data.threads : [];
        if (select) {
          select.innerHTML = threads.length
            ? threads.map((t) =>
              '<option value="' + t.id + '">' + this.esc((t.subject || 'Thread') + ' · ' + (t.status || '')) + '</option>'
            ).join('')
            : '<option value="">No threads — a new one will be created on reply</option>';
          if (data.active && data.active.thread) {
            select.value = String(data.active.thread.id);
            this.userDetailState.supportThreadId = data.active.thread.id;
          } else if (threads[0]) {
            this.userDetailState.supportThreadId = threads[0].id;
          }
          select.onchange = () => {
            this.userDetailState.supportThreadId = select.value ? parseInt(select.value, 10) : null;
            this.loadUserDetailSupport().catch(() => {});
          };
        }
        this.renderUserDetailSupportMessages(data.active?.messages || []);
      } catch (err) {
        if ($('userDetailSupportMessages')) {
          $('userDetailSupportMessages').innerHTML = '<p class="hint" style="color:#f87171">' + this.esc(err.message) + '</p>';
        }
      }
    };

    Admin.submitUserDetailSupportReply = async function submitUserDetailSupportReply(e) {
      e.preventDefault();
      const uid = this.userDetailState.userId;
      const text = ($('userDetailSupportReplyText')?.value || '').trim();
      const errEl = $('userDetailSupportError');
      if (!uid || !text) return;
      const btn = $('userDetailSupportSendBtn');
      if (btn) btn.disabled = true;
      if (errEl) errEl.classList.add('hidden');
      try {
        await this.api('POST', '/api/admin/users/' + uid + '/detail/support/reply', {
          message: text,
          thread_id: this.userDetailState.supportThreadId || undefined,
        });
        if ($('userDetailSupportReplyText')) $('userDetailSupportReplyText').value = '';
        await this.loadUserDetailSupport();
      } catch (err) {
        if (errEl) {
          errEl.textContent = err.message || 'Send failed';
          errEl.classList.remove('hidden');
        }
      } finally {
        if (btn) btn.disabled = false;
      }
    };

    Admin.bindUserDetailModal = function bindUserDetailModal() {
      $('userDetailModalClose')?.addEventListener('click', () => this.closeUserDetailModal());
      $('userDetailModal')?.querySelector('.user-detail-modal-backdrop')
        ?.addEventListener('click', () => this.closeUserDetailModal());
      $('userDetailRefreshBtn')?.addEventListener('click', () => this.switchUserDetailTab(this.userDetailState.tab || 'profile'));
      document.querySelectorAll('[data-user-detail-tab]').forEach((btn) => {
        btn.addEventListener('click', () => {
          this.switchUserDetailTab(btn.getAttribute('data-user-detail-tab') || 'profile');
        });
      });
      document.querySelectorAll('[data-user-finance-kind]').forEach((btn) => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('[data-user-finance-kind]').forEach((el) => {
            el.classList.toggle('is-active', el === btn);
          });
          this.userDetailState.financeKind = btn.getAttribute('data-user-finance-kind') || 'deposits';
          this.userDetailState.financeOffset = 0;
          this.loadUserDetailFinance().catch(() => {});
        });
      });
      $('userDetailFinancePrev')?.addEventListener('click', () => {
        this.userDetailState.financeOffset = Math.max(0, this.userDetailState.financeOffset - this.userDetailState.financeLimit);
        this.loadUserDetailFinance().catch(() => {});
      });
      $('userDetailFinanceNext')?.addEventListener('click', () => {
        this.userDetailState.financeOffset += this.userDetailState.financeLimit;
        this.loadUserDetailFinance().catch(() => {});
      });
      $('userDetailTxPrev')?.addEventListener('click', () => {
        this.userDetailState.txOffset = Math.max(0, this.userDetailState.txOffset - this.userDetailState.txLimit);
        this.loadUserDetailTransactions().catch(() => {});
      });
      $('userDetailTxNext')?.addEventListener('click', () => {
        this.userDetailState.txOffset += this.userDetailState.txLimit;
        this.loadUserDetailTransactions().catch(() => {});
      });
      $('userDetailSupportReplyForm')?.addEventListener('submit', (e) => this.submitUserDetailSupportReply(e));
      document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        const modal = $('userDetailModal');
        if (modal && !modal.classList.contains('hidden')) this.closeUserDetailModal();
      });
    };

  }

  function boot() {
    if (!window.Admin) return;
    install(window.Admin);
    if (window.Admin.bindUserDetailModal) window.Admin.bindUserDetailModal();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.AdminUserDetail = { install };
})();
