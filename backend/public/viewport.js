/**
 * Mobile viewport helpers
 *
 * Mobile (≤900px) uses a document-scroll layout: html/body are min-height
 * (100svh) rather than a fixed h-screen shell. Do NOT pixel-lock --app-vh
 * while idle — that reintroduces collapse/clipping when browser chrome
 * changes. Keyboard open only toggles a class for CSS; scrolling stays on
 * the document so focused inputs remain reachable.
 *
 * Desktop keeps the fixed SPA shell and CSS --app-vh (100svh).
 */
(function lockAppViewport() {
  const root = document.documentElement;
  const mqMobile = window.matchMedia('(max-width: 900px)');

  let focusDepth = 0;
  let unlockTimer = 0;

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
      if (mqMobile.matches) clearPixelLock();
      setKeyboardClass(true);
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
  }

  document.addEventListener('focusin', onFocusIn, true);
  document.addEventListener('focusout', onFocusOut, true);

  window.addEventListener('orientationchange', onOrientationChange, { passive: true });

  if (screen.orientation && screen.orientation.addEventListener) {
    screen.orientation.addEventListener('change', onOrientationChange);
  }

  window.addEventListener('resize', () => {
    if (mqMobile.matches) clearPixelLock();
  }, { passive: true });

  // Ensure any leftover pixel lock from a previous build is cleared on boot.
  clearPixelLock();
})();
