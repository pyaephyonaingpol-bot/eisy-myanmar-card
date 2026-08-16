/**
 * Mobile viewport + virtual keyboard helpers.
 *
 * - Keep --app-vh on a *stable* viewport height (svh / frozen layout height)
 *   so the app shell does not jump when the soft keyboard opens.
 * - Expose --app-dvh for surfaces that intentionally track the visible area.
 * - Soft-scroll focused fields into view without forcing shell resizes.
 */
(function syncAppViewportHeight() {
  const root = document.documentElement;
  const supportsSvh = typeof CSS !== 'undefined'
    && CSS.supports
    && CSS.supports('height', '100svh');
  const supportsDvh = typeof CSS !== 'undefined'
    && CSS.supports
    && CSS.supports('height', '100dvh');

  let frozenLayoutHeight = 0;
  let keyboardLikelyOpen = false;
  let focusScrollTimer = 0;

  function layoutHeight() {
    return window.innerHeight || root.clientHeight || 0;
  }

  function visibleHeight() {
    if (window.visualViewport && Number.isFinite(window.visualViewport.height)) {
      return window.visualViewport.height;
    }
    return layoutHeight();
  }

  function applyStableHeight(force) {
    const layout = layoutHeight();
    if (!layout || !Number.isFinite(layout)) return;

    // Grow freeze on orientation / first paint; never shrink while typing.
    if (force || layout > frozenLayoutHeight + 2 || frozenLayoutHeight === 0) {
      frozenLayoutHeight = layout;
    }

    if (!supportsSvh) {
      root.style.setProperty('--app-vh', `${Math.round(frozenLayoutHeight)}px`);
    }

    if (!supportsDvh) {
      const visible = Math.round(visibleHeight());
      if (visible > 0) {
        root.style.setProperty('--app-dvh', `${visible}px`);
      }
    }
  }

  function setKeyboardOpen(open) {
    keyboardLikelyOpen = open;
    document.body.classList.toggle('keyboard-open', open);
  }

  function isEditableTarget(el) {
    if (!el || el.nodeType !== 1) return false;
    const tag = el.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag === 'INPUT') {
      const type = String(el.type || 'text').toLowerCase();
      return !['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'hidden', 'image', 'range', 'color'].includes(type);
    }
    return el.isContentEditable;
  }

  function scrollFieldIntoView(el) {
    if (!el || typeof el.scrollIntoView !== 'function') return;
    try {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    } catch (_) {
      el.scrollIntoView(false);
    }

    // Chat compose bars: keep the form visible above the keyboard overlay.
    const chatForm = el.closest('.p2p-trade-chat-form, .support-compose, form.p2p-trade-chat-form');
    if (chatForm && typeof chatForm.scrollIntoView === 'function') {
      try {
        chatForm.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
      } catch (_) {
        chatForm.scrollIntoView(false);
      }
    }
  }

  function onFocusIn(event) {
    const el = event.target;
    if (!isEditableTarget(el)) return;
    setKeyboardOpen(true);
    window.clearTimeout(focusScrollTimer);
    focusScrollTimer = window.setTimeout(() => scrollFieldIntoView(el), 80);
  }

  function onFocusOut() {
    window.clearTimeout(focusScrollTimer);
    focusScrollTimer = window.setTimeout(() => {
      const active = document.activeElement;
      if (!isEditableTarget(active)) {
        setKeyboardOpen(false);
        applyStableHeight(false);
      }
    }, 120);
  }

  function onViewportResize() {
    const layout = layoutHeight();
    const visible = visibleHeight();
    // Keyboard heuristic: large height drop without a width-driven layout change.
    const shrink = frozenLayoutHeight > 0 ? (frozenLayoutHeight - visible) : 0;
    if (keyboardLikelyOpen || shrink > 120) {
      if (!supportsDvh && visible > 0) {
        root.style.setProperty('--app-dvh', `${Math.round(visible)}px`);
      }
      return;
    }
    applyStableHeight(false);
  }

  applyStableHeight(true);

  window.addEventListener('resize', onViewportResize, { passive: true });
  window.addEventListener('orientationchange', () => {
    setKeyboardOpen(false);
    window.setTimeout(() => applyStableHeight(true), 250);
  }, { passive: true });

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', onViewportResize, { passive: true });
  }

  document.addEventListener('focusin', onFocusIn, true);
  document.addEventListener('focusout', onFocusOut, true);
})();
