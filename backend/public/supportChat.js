/**
 * Customer live chat + support ticket widget.
 * Depends on Auth.api / Auth.isLoggedIn from auth.js.
 */
(function initSupportChat(global) {
  'use strict';

  const POLL_MS = 3500;
  const state = {
    open: false,
    view: 'list', // list | chat | compose
    threads: [],
    activeThreadId: null,
    messages: [],
    lastMessageId: 0,
    pollTimer: null,
    sending: false,
  };

  function el(id) {
    return document.getElementById(id);
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function statusLabel(status) {
    const map = {
      pending: 'Open',
      open: 'Open',
      in_progress: 'In Progress',
      completed: 'Resolved',
      closed: 'Resolved',
      failed: 'Failed',
    };
    return map[String(status || '').toLowerCase()] || status || 'Open';
  }

  function categoryLabel(category) {
    const map = {
      mmk_payouts: 'MMK Payouts',
      card_issuing: 'Card Issuing Issues',
    };
    return map[String(category || '').toLowerCase()] || category || 'Support';
  }

  function priorityLabel(priority) {
    const map = { high: 'High', medium: 'Medium', low: 'Low', urgent: 'High', normal: 'Medium' };
    return map[String(priority || '').toLowerCase()] || 'Medium';
  }

  function api(method, path, body) {
    if (!global.Auth || typeof Auth.api !== 'function') {
      return Promise.reject(new Error('Please sign in to use live chat'));
    }
    return Auth.api(method, path, body);
  }

  function ensureMounted() {
    if (el('supportChatRoot')) return;

    const root = document.createElement('div');
    root.id = 'supportChatRoot';
    root.innerHTML = [
      '<button type="button" id="supportChatFab" class="support-chat-fab hidden" aria-label="Open live support chat">',
      '  <span aria-hidden="true">💬</span>',
      '  <span>Support</span>',
      '  <span id="supportChatFabBadge" class="support-chat-fab-badge hidden">0</span>',
      '</button>',
      '<section id="supportChatPanel" class="support-chat-panel hidden" role="dialog" aria-label="Live support chat">',
      '  <header class="support-chat-header">',
      '    <div>',
      '      <strong id="supportChatTitle">Live Support</strong>',
      '      <p class="support-chat-subtitle" id="supportChatSubtitle">MMK Payouts · Card Issuing</p>',
      '    </div>',
      '    <div class="support-chat-header-actions">',
      '      <button type="button" id="supportChatNewBtn" class="btn btn-secondary btn-sm">New ticket</button>',
      '      <button type="button" id="supportChatCloseBtn" class="support-chat-close" aria-label="Close">×</button>',
      '    </div>',
      '  </header>',
      '  <div id="supportChatBody" class="support-chat-body"></div>',
      '</section>',
    ].join('');
    document.body.appendChild(root);

    el('supportChatFab').addEventListener('click', () => setOpen(true));
    el('supportChatCloseBtn').addEventListener('click', () => setOpen(false));
    el('supportChatNewBtn').addEventListener('click', () => {
      state.view = 'compose';
      render();
    });
  }

  function setOpen(open) {
    if (open && !(global.Auth && Auth.isLoggedIn && Auth.isLoggedIn())) {
      alert('Please sign in to chat with support.');
      return;
    }
    state.open = !!open;
    el('supportChatPanel')?.classList.toggle('hidden', !state.open);
    if (state.open) {
      state.view = 'list';
      refreshThreads().then(render);
      startPolling();
    } else {
      stopPolling();
    }
  }

  function startPolling() {
    stopPolling();
    state.pollTimer = setInterval(() => {
      if (!state.open) return;
      if (state.view === 'chat' && state.activeThreadId) refreshMessages({ silent: true });
      else if (state.view === 'list') refreshThreads({ silent: true });
    }, POLL_MS);
  }

  function stopPolling() {
    if (state.pollTimer) clearInterval(state.pollTimer);
    state.pollTimer = null;
  }

  async function refreshThreads({ silent } = {}) {
    try {
      const data = await api('GET', '/api/support/threads');
      state.threads = Array.isArray(data.threads) ? data.threads : [];
      const unread = state.threads.reduce((n, t) => n + Number(t.unread_by_user || 0), 0);
      const badge = el('supportChatFabBadge');
      if (badge) {
        badge.textContent = String(unread);
        badge.classList.toggle('hidden', unread <= 0);
      }
      if (!silent && state.view === 'list') render();
    } catch (err) {
      if (!silent) console.warn('[support-chat]', err.message);
    }
  }

  async function refreshMessages({ silent } = {}) {
    if (!state.activeThreadId) return;
    try {
      const qs = state.lastMessageId > 0 ? ('?after_id=' + state.lastMessageId) : '';
      const data = await api(
        'GET',
        '/api/support/threads/' + state.activeThreadId + '/messages' + qs
      );
      const incoming = Array.isArray(data.messages) ? data.messages : [];
      if (qs) {
        if (incoming.length) {
          state.messages = state.messages.concat(incoming);
          state.lastMessageId = Math.max(
            state.lastMessageId,
            ...incoming.map((m) => Number(m.id) || 0)
          );
          renderMessages();
        }
      } else {
        state.messages = incoming;
        state.lastMessageId = incoming.reduce((max, m) => Math.max(max, Number(m.id) || 0), 0);
        if (!silent) render();
        else renderMessages();
      }
    } catch (err) {
      if (!silent) console.warn('[support-chat]', err.message);
    }
  }

  function render() {
    const body = el('supportChatBody');
    if (!body) return;

    if (state.view === 'compose') {
      body.innerHTML = composeHtml();
      bindCompose();
      return;
    }

    if (state.view === 'chat') {
      body.innerHTML = chatShellHtml();
      renderMessages();
      bindChat();
      return;
    }

    body.innerHTML = listHtml();
    body.querySelectorAll('[data-thread-id]').forEach((node) => {
      node.addEventListener('click', () => openThread(parseInt(node.getAttribute('data-thread-id'), 10)));
    });
    el('supportChatEmptyNew')?.addEventListener('click', () => {
      state.view = 'compose';
      render();
    });
  }

  function listHtml() {
    if (!state.threads.length) {
      return [
        '<div class="support-chat-empty">',
        '  <p>No open tickets yet.</p>',
        '  <button type="button" class="btn btn-primary btn-sm" id="supportChatEmptyNew">Start a live chat</button>',
        '</div>',
      ].join('');
    }
    return [
      '<div class="support-chat-list">',
      ...state.threads.map((t) => [
        '<button type="button" class="support-chat-thread" data-thread-id="' + t.id + '">',
        '  <div class="support-chat-thread-top">',
        '    <strong>' + esc(t.subject || 'Support') + '</strong>',
        '    <span class="support-pill status-' + esc(t.status) + '">' + esc(statusLabel(t.status)) + '</span>',
        '  </div>',
        '  <div class="support-chat-thread-meta">',
        '    <span>' + esc(categoryLabel(t.category)) + '</span><span>·</span>',
        '    <span>' + esc(priorityLabel(t.priority)) + '</span>',
        Number(t.unread_by_user) > 0
          ? ('<span class="support-unread">' + Number(t.unread_by_user) + ' new</span>')
          : '',
        '  </div>',
        '  <p class="support-chat-preview">' + esc(t.last_message_preview || '') + '</p>',
        '</button>',
      ].join('')),
      '</div>',
    ].join('');
  }

  function composeHtml() {
    return [
      '<form id="supportChatComposeForm" class="support-chat-compose form">',
      '  <div class="field"><label for="scCategory">Category</label>',
      '    <select id="scCategory" required>',
      '      <option value="mmk_payouts">MMK Payouts</option>',
      '      <option value="card_issuing">Card Issuing Issues</option>',
      '    </select></div>',
      '  <div class="field"><label for="scPriority">Priority</label>',
      '    <select id="scPriority">',
      '      <option value="medium">Medium</option>',
      '      <option value="high">High</option>',
      '      <option value="low">Low</option>',
      '    </select></div>',
      '  <div class="field"><label for="scSubject">Subject</label>',
      '    <input id="scSubject" maxlength="120" placeholder="Short summary" /></div>',
      '  <div class="field"><label for="scMessage">Message</label>',
      '    <textarea id="scMessage" rows="4" required placeholder="Describe your issue…"></textarea></div>',
      '  <p id="scComposeError" class="error-text hidden"></p>',
      '  <div class="support-chat-compose-actions">',
      '    <button type="button" id="scComposeCancel" class="btn btn-secondary btn-sm">Back</button>',
      '    <button type="submit" class="btn btn-primary btn-sm">Start chat</button>',
      '  </div>',
      '</form>',
    ].join('');
  }

  function bindCompose() {
    el('scComposeCancel')?.addEventListener('click', () => {
      state.view = 'list';
      render();
    });
    el('supportChatComposeForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errEl = el('scComposeError');
      try {
        if (errEl) {
          errEl.textContent = '';
          errEl.classList.add('hidden');
        }
        const data = await api('POST', '/api/support/threads', {
          category: el('scCategory')?.value,
          priority: el('scPriority')?.value || 'medium',
          subject: el('scSubject')?.value.trim() || 'Support request',
          message: el('scMessage')?.value.trim(),
        });
        await refreshThreads();
        if (data.thread?.id) openThread(data.thread.id);
      } catch (err) {
        if (errEl) {
          errEl.textContent = err.message || 'Failed to create ticket';
          errEl.classList.remove('hidden');
        }
      }
    });
  }

  function chatShellHtml() {
    const thread = state.threads.find((t) => t.id === state.activeThreadId) || {};
    if (el('supportChatTitle')) el('supportChatTitle').textContent = thread.subject || 'Live chat';
    if (el('supportChatSubtitle')) {
      el('supportChatSubtitle').textContent =
        categoryLabel(thread.category) + ' · ' + statusLabel(thread.status) + ' · ' + priorityLabel(thread.priority);
    }
    const closed = ['completed', 'closed', 'failed'].includes(String(thread.status || ''));
    return [
      '<div class="support-chat-thread-toolbar">',
      '  <button type="button" id="scBackToList" class="btn btn-secondary btn-sm">← Tickets</button>',
      '</div>',
      '<div id="supportChatMessages" class="support-chat-messages" aria-live="polite"></div>',
      closed
        ? '<p class="hint support-chat-closed">This ticket is resolved. Open a new ticket if you need more help.</p>'
        : [
          '<form id="supportChatReplyForm" class="support-chat-reply">',
          '  <input id="scReplyInput" type="text" maxlength="2000" placeholder="Type a message…" autocomplete="off" required />',
          '  <button type="submit" class="btn btn-primary btn-sm">Send</button>',
          '</form>',
        ].join(''),
    ].join('');
  }

  function renderMessages() {
    const box = el('supportChatMessages');
    if (!box) return;
    box.innerHTML = state.messages.map((m) => {
      const mine = m.sender_type === 'user';
      const via = m.source === 'telegram' ? ' · via Telegram' : '';
      return [
        '<div class="support-chat-bubble ' + (mine ? 'mine' : 'theirs') + '">',
        '  <div class="support-chat-bubble-meta">' + (mine ? 'You' : 'Support') + esc(via) + '</div>',
        '  <div class="support-chat-bubble-text">' + esc(m.message) + '</div>',
        '  <div class="support-chat-bubble-time">' + esc(m.created_at || '') + '</div>',
        '</div>',
      ].join('');
    }).join('') || '<p class="hint">No messages yet.</p>';
    box.scrollTop = box.scrollHeight;
  }

  function bindChat() {
    el('scBackToList')?.addEventListener('click', () => {
      state.view = 'list';
      state.activeThreadId = null;
      if (el('supportChatTitle')) el('supportChatTitle').textContent = 'Live Support';
      if (el('supportChatSubtitle')) el('supportChatSubtitle').textContent = 'MMK Payouts · Card Issuing';
      refreshThreads().then(render);
    });
    el('supportChatReplyForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (state.sending || !state.activeThreadId) return;
      const input = el('scReplyInput');
      const text = input?.value.trim();
      if (!text) return;
      state.sending = true;
      try {
        const data = await api('POST', '/api/support/threads/' + state.activeThreadId + '/messages', {
          message: text,
        });
        if (input) input.value = '';
        if (data.message) {
          state.messages.push(data.message);
          state.lastMessageId = Math.max(state.lastMessageId, Number(data.message.id) || 0);
          renderMessages();
        } else {
          await refreshMessages();
        }
      } catch (err) {
        alert(err.message || 'Failed to send');
      } finally {
        state.sending = false;
      }
    });
  }

  async function openThread(id) {
    state.activeThreadId = id;
    state.view = 'chat';
    state.messages = [];
    state.lastMessageId = 0;
    render();
    await refreshMessages();
  }

  function syncFabVisibility() {
    ensureMounted();
    const loggedIn = !!(global.Auth && Auth.isLoggedIn && Auth.isLoggedIn());
    el('supportChatFab')?.classList.toggle('hidden', !loggedIn);
    if (!loggedIn) setOpen(false);
  }

  function boot() {
    ensureMounted();
    syncFabVisibility();
    document.addEventListener('eisy:authchange', syncFabVisibility);
    setInterval(syncFabVisibility, 8000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  global.SupportChat = {
    open: () => setOpen(true),
    close: () => setOpen(false),
    refresh: refreshThreads,
  };
})(window);
