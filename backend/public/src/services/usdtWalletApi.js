/**
 * USDT wallet domain API (user SPA).
 * Sensitive Auth.api already sends Cache-Control: no-store — avoid ?_= cache-bust
 * on every read (it defeats HTTP coalescing and forces extra work).
 */
(function (root) {
  'use strict';

  root.EisyServices = root.EisyServices || {};
  const api = () => root.EisyServices.api;

  async function withRetries(fn, { retries = 3, label = 'usdt-wallet' } = {}) {
    const maxAttempts = Math.max(1, Math.min(4, Number(retries) || 1));
    let lastErr = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await fn(attempt);
      } catch (err) {
        lastErr = err;
        const retryable = err?.code === 'REQUEST_TIMEOUT' || err?.code === 'NETWORK_ERROR';
        if (!retryable || attempt >= maxAttempts) break;
        const waitMs = Math.min(2500, 400 * (2 ** (attempt - 1)));
        console.warn(
          `[EisyServices.usdtWallet] ${label} attempt ${attempt}/${maxAttempts} failed; retry in ${waitMs}ms`
        );
        await new Promise((r) => setTimeout(r, waitMs));
      }
    }
    throw lastErr;
  }

  root.EisyServices.usdtWallet = {
    getOverview() {
      return withRetries(
        (attempt) => api().request('GET', '/api/user/usdt-wallet', null, {
          sensitive: true,
          timeoutMs: 25000,
          force: attempt > 1,
          skipDedupe: attempt > 1,
        }),
        { label: 'overview' }
      );
    },
    getPlatformWallet(opts = {}) {
      const q = opts.fresh ? '?fresh=1' : '';
      return withRetries(
        (attempt) => api().request('GET', `/api/user/wallet${q}`, null, {
          sensitive: true,
          timeoutMs: 20000,
          force: attempt > 1,
          skipDedupe: attempt > 1,
        }),
        { label: 'platform-wallet' }
      );
    },
    getTransactions() {
      return withRetries(
        (attempt) => api().request('GET', '/api/user/usdt-wallet/transactions', null, {
          sensitive: true,
          timeoutMs: 20000,
          force: attempt > 1,
          skipDedupe: attempt > 1,
        }),
        { label: 'transactions' }
      );
    },
    getBalance(opts = {}) {
      const q = opts.fresh ? '?fresh=1' : '';
      return withRetries(
        (attempt) => api().request('GET', `/api/user/usdt-wallet/balance${q}`, null, {
          sensitive: true,
          timeoutMs: 15000,
          force: attempt > 1,
          skipDedupe: attempt > 1,
        }),
        { label: 'balance' }
      );
    },
    linkAddress(body) {
      return api().request('POST', '/api/user/usdt-wallet/link', body, { timeoutMs: 15000 });
    },
    unlinkAddress(id) {
      return api().request('DELETE', `/api/user/usdt-wallet/link/${id}`, null, { timeoutMs: 15000 });
    },
    getLinkedBalance(id) {
      return withRetries(
        (attempt) => api().request('GET', `/api/user/usdt-wallet/linked/${id}/balance`, null, {
          timeoutMs: 30000,
          force: attempt > 1,
          skipDedupe: attempt > 1,
        }),
        { label: 'linked-balance' }
      );
    },
    transfer(body) {
      return api().request('POST', '/api/user/usdt-wallet/transfer', body, {
        sensitive: true,
        timeoutMs: 20000,
      });
    },
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
