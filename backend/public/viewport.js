/**
 * Mobile viewport + keyboard lock
 *
 * 1) Freeze --app-vh to a pixel shell height (prefer layout viewport).
 * 2) Never recalculate that height while an input is focused / keyboard open.
 * 3) Only refresh on orientation change (or desktop window resize without keyboard).
 *
 * Works with CSS: html/body are overflow-hidden + fixed; scrolling happens
 * inside .app-content / .auth-screen — so the keyboard overlays instead of
 * resizing the document and causing layout loops.
 */
(function lockAppViewport() {
  const root = document.documentElement;
  const mqMobile = window.matchMedia('(max-width: 900px)');

  let shellPx = 0;
  let focusDepth = 0;
  let lastOrientation = screen.orientation?.type || String(window.orientation);
  let unlockTimer = 0;

  function layoutHeight() {
    // Prefer the layout viewport. visualViewport shrinks with the keyboard and
    // must not drive shell height.
    return Math.round(window.innerHeight || root.clientHeight || 0);
  }

  function visualHeight() {
    const vv = window.visualViewport;
    if (vv && Number.isFinite(vv.height)) return Math.round(vv.height);
    return layoutHeight();
  }

  function keyboardOpen() {
    if (focusDepth > 0) return true;
    const layout = layoutHeight();
    const visual = visualHeight();
    if (!layout || !visual) return false;
    return (layout - visual) > 120 || (shellPx - visual) > 120;
  }

  function applyShellHeight(force) {
    if (!force && keyboardOpen()) return;

    const next = layoutHeight();
    if (!next || !Number.isFinite(next)) return;

    // While not focused, allow growth (address bar hide) but never shrink from
    // a transient visualViewport blip. Forced updates always take the new value.
    if (force || !shellPx || next >= shellPx - 2) {
      shellPx = next;
    }

    root.style.setProperty('--app-vh', `${shellPx}px`);
    root.style.setProperty('--app-shell-px', `${shellPx}px`);
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

  function onFocusIn(event) {
    if (!isTextEntry(event.target)) return;
    focusDepth += 1;
    if (focusDepth === 1) {
      // Snapshot the current shell before the keyboard animates.
      applyShellHeight(true);
      setKeyboardClass(true);
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
      // Keep the pixel lock — do not bounce back to svh mid-session.
    }, 80);
  }

  function onOrientationChange() {
    shellPx = 0;
    setKeyboardClass(false);
    focusDepth = 0;
    window.setTimeout(() => applyShellHeight(true), 280);
  }

  applyShellHeight(true);

  document.addEventListener('focusin', onFocusIn, true);
  document.addEventListener('focusout', onFocusOut, true);

  window.addEventListener('orientationchange', onOrientationChange, { passive: true });

  if (screen.orientation && screen.orientation.addEventListener) {
    screen.orientation.addEventListener('change', onOrientationChange);
  }

  window.addEventListener('resize', () => {
    const orientation = screen.orientation?.type || String(window.orientation);
    if (orientation !== lastOrientation) {
      lastOrientation = orientation;
      onOrientationChange();
      return;
    }
    // Ignore keyboard / visualViewport-driven resizes entirely.
    if (keyboardOpen()) return;
    // Desktop window resizes may update; on mobile keep the lock unless height grew.
    if (mqMobile.matches) {
      const next = layoutHeight();
      if (next && next > shellPx + 40) applyShellHeight(true);
      return;
    }
    applyShellHeight(true);
  }, { passive: true });

  // Intentionally no visualViewport resize/scroll listeners.
})();
