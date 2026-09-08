/**
 * Mobile viewport helpers
 *
 * Document-scroll layout on mobile / coarse-pointer / Android WebView:
 * html/body use height:100% + min-height:100vh + overflow-y:auto rather than
 * a fixed h-screen shell. Do NOT pixel-lock --app-vh while idle — that
 * reintroduces collapse/clipping when browser chrome changes.
 *
 * Desktop (≥901px) keeps the fixed SPA shell via CSS media query.
 */
(function lockAppViewport() {
  const root = document.documentElement;
  const mqMobile = window.matchMedia('(max-width: 900px)');
  const mqTouch = window.matchMedia('(hover: none) and (pointer: coarse)');

  let focusDepth = 0;
  let unlockTimer = 0;

  function isAndroidWebView() {
    const ua = navigator.userAgent || '';
    // Android WebView markers: "; wv)" or Version/x.x Chrome without "Chrome/" Safari patterns.
    if (/\bwv\b/i.test(ua) || /; wv\)/i.test(ua)) return true;
    if (/Android/i.test(ua) && /Version\/[\d.]+/i.test(ua) && /Chrome/i.test(ua)) return true;
    return false;
  }

  function syncDocScrollClass() {
    const on = mqMobile.matches || mqTouch.matches || isAndroidWebView();
    root.classList.toggle('doc-scroll', on);
    if (on) clearPixelLock();
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

  function onFocusIn(event) {
    if (!isTextEntry(event.target)) return;
    focusDepth += 1;
    if (focusDepth === 1) {
      // Never freeze a pixel height on mobile — let the page scroll.
      if (mqMobile.matches || root.classList.contains('doc-scroll')) clearPixelLock();
      setKeyboardClass(true);
    }
    // Bring the focused field into view after the keyboard settles.
    const target = event.target;
    window.setTimeout(() => {
      try {
        target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
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
    syncDocScrollClass();
    if (mqMobile.matches || root.classList.contains('doc-scroll')) clearPixelLock();
  }, { passive: true });

  if (typeof mqMobile.addEventListener === 'function') {
    mqMobile.addEventListener('change', syncDocScrollClass);
  } else if (typeof mqMobile.addListener === 'function') {
    mqMobile.addListener(syncDocScrollClass);
  }

  // Ensure any leftover pixel lock from a previous build is cleared on boot.
  clearPixelLock();
  syncDocScrollClass();
})();
