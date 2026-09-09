/**
 * Mobile viewport helpers
 *
 * Document-scroll layout on mobile / Android Chrome / Android WebView:
 * html/body use natural height (height:auto) + min-height:100vh + overflow-y:auto.
 * Do NOT pixel-lock --app-vh while idle — that reintroduces collapse/clipping.
 *
 * Desktop (≥901px, non-Android) keeps the fixed SPA shell via CSS media query.
 *
 * Scroll smoothness:
 * - Passive scroll/touch listeners only (never block the compositor)
 * - html.is-scrolling flag lets CSS/JS defer expensive work while finger is moving
 */
(function unlockMobileDocumentScroll() {
  const root = document.documentElement;
  const mqMobile = window.matchMedia('(max-width: 900px)');
  const mqTouch = window.matchMedia('(hover: none) and (pointer: coarse)');

  let focusDepth = 0;
  let unlockTimer = 0;
  let scrollIdleTimer = 0;
  let scrolling = false;

  function isAndroid() {
    return /Android/i.test(navigator.userAgent || '');
  }

  function isAndroidWebView() {
    const ua = navigator.userAgent || '';
    if (/\bwv\b/i.test(ua) || /; wv\)/i.test(ua)) return true;
    if (/Android/i.test(ua) && /Version\/[\d.]+/i.test(ua) && /Chrome/i.test(ua)) return true;
    return false;
  }

  function syncDocScrollClass() {
    // Always unlock on Android (Chrome + WebView), touch, or narrow viewports.
    const on = mqMobile.matches || mqTouch.matches || isAndroid() || isAndroidWebView();
    root.classList.toggle('doc-scroll', on);
    if (on) {
      clearPixelLock();
      // Belt-and-suspenders: clear any leftover inline overflow locks.
      try {
        root.style.removeProperty('overflow');
        root.style.removeProperty('overflow-y');
        root.style.removeProperty('height');
        root.style.removeProperty('max-height');
        if (document.body) {
          document.body.style.removeProperty('overflow');
          document.body.style.removeProperty('overflow-y');
          document.body.style.removeProperty('height');
          document.body.style.removeProperty('max-height');
          document.body.style.removeProperty('position');
        }
      } catch (_) { /* ignore */ }
    }
  }

  function isTextEntry(el) {
    if (!el || el.disabled) return false;
    const tag = el.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag === 'INPUT') {
      const type = String(el.type || 'text').toLowerCase();
      return ![
        'button', 'submit', 'reset', 'checkbox', 'radio',
        'file', 'image', 'range', 'color', 'hidden',
      ].includes(type);
    }
    return Boolean(el.isContentEditable);
  }

  function setKeyboardClass(on) {
    root.classList.toggle('kb-open', on);
    document.body?.classList.toggle('kb-open', on);
  }

  function clearPixelLock() {
    root.style.removeProperty('--app-vh');
    root.style.removeProperty('--app-shell-px');
  }

  function markScrolling() {
    if (!scrolling) {
      scrolling = true;
      root.classList.add('is-scrolling');
    }
    window.clearTimeout(scrollIdleTimer);
    scrollIdleTimer = window.setTimeout(() => {
      scrolling = false;
      root.classList.remove('is-scrolling');
    }, 140);
  }

  function onFocusIn(event) {
    if (!isTextEntry(event.target)) return;
    focusDepth += 1;
    if (focusDepth === 1) {
      if (mqMobile.matches || root.classList.contains('doc-scroll')) clearPixelLock();
      setKeyboardClass(true);
    }
    const target = event.target;
    window.setTimeout(() => {
      try {
        // Instant snap — smooth scrollIntoView competes with finger scrolling.
        target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
      } catch (_) {
        try { target.scrollIntoView(true); } catch (__) { /* ignore */ }
      }
    }, 280);
  }

  function onFocusOut(event) {
    if (!isTextEntry(event.target)) return;
    focusDepth = Math.max(0, focusDepth - 1);
    window.clearTimeout(unlockTimer);
    unlockTimer = window.setTimeout(() => {
      if (isTextEntry(document.activeElement)) {
        focusDepth = Math.max(focusDepth, 1);
        return;
      }
      focusDepth = 0;
      setKeyboardClass(false);
      clearPixelLock();
    }, 120);
  }

  function onOrientationChange() {
    setKeyboardClass(false);
    focusDepth = 0;
    clearPixelLock();
    syncDocScrollClass();
  }

  document.addEventListener('focusin', onFocusIn, true);
  document.addEventListener('focusout', onFocusOut, true);
  window.addEventListener('orientationchange', onOrientationChange, { passive: true });

  if (screen.orientation && screen.orientation.addEventListener) {
    screen.orientation.addEventListener('change', onOrientationChange);
  }

  window.addEventListener('resize', () => {
    // Skip layout work while the finger is mid-scroll.
    if (root.classList.contains('is-scrolling')) return;
    syncDocScrollClass();
    if (mqMobile.matches || root.classList.contains('doc-scroll')) clearPixelLock();
  }, { passive: true });

  // Passive-only: never call preventDefault on scroll/touchmove (keeps iOS/Android momentum).
  window.addEventListener('scroll', markScrolling, { passive: true, capture: true });
  document.addEventListener('touchstart', markScrolling, { passive: true, capture: true });
  document.addEventListener('touchmove', markScrolling, { passive: true, capture: true });

  if (typeof mqMobile.addEventListener === 'function') {
    mqMobile.addEventListener('change', syncDocScrollClass);
  } else if (typeof mqMobile.addListener === 'function') {
    mqMobile.addListener(syncDocScrollClass);
  }

  window.EisyScroll = {
    isScrolling() {
      return scrolling || root.classList.contains('is-scrolling');
    },
  };

  clearPixelLock();
  syncDocScrollClass();
})();
