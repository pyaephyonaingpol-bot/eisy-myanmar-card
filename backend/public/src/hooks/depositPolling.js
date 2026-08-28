/**
 * Deposit status polling helper.
 * window.EisyHooks.depositPolling
 */
(function (root) {
  'use strict';

  root.EisyHooks = root.EisyHooks || {};

  function startDepositStatusPolling({
    refCode,
    intervalMs = 5000,
    getStatus,
    onVerified,
    onReview,
    onError,
  }) {
    if (!refCode || typeof getStatus !== 'function') {
      return { stop() {} };
    }

    let timer = null;
    const tick = async () => {
      try {
        const result = await getStatus(refCode);
        const deposit = result?.deposit || result;
        const status = String(deposit?.status || '').toUpperCase();
        if (status === 'VERIFIED') {
          stop();
          onVerified?.(deposit);
        } else if (status === 'SUBMITTED' || status === 'UNDER_REVIEW') {
          onReview?.(deposit);
        }
      } catch (err) {
        onError?.(err);
      }
    };

    function stop() {
      if (timer) clearInterval(timer);
      timer = null;
    }

    timer = setInterval(tick, intervalMs);
    return { stop, timerRef: () => timer };
  }

  function startTronOrderStatusPolling({
    orderId,
    intervalMs = 5000,
    getOrder,
    onCompleted,
    onPending,
    onError,
  }) {
    if (!orderId || typeof getOrder !== 'function') {
      return { stop() {} };
    }

    let timer = null;
    const tick = async () => {
      try {
        const result = await getOrder(orderId);
        const order = result?.order || result;
        const status = String(order?.status || '').toUpperCase();
        if (status === 'COMPLETED') {
          stop();
          onCompleted?.(order);
        } else if (status === 'PENDING') {
          onPending?.(order);
        }
      } catch (err) {
        onError?.(err);
      }
    };

    function stop() {
      if (timer) clearInterval(timer);
      timer = null;
    }

    tick();
    timer = setInterval(tick, intervalMs);
    return { stop, timerRef: () => timer };
  }

  root.EisyHooks.depositPolling = { startDepositStatusPolling, startTronOrderStatusPolling };
})(typeof globalThis !== 'undefined' ? globalThis : window);
