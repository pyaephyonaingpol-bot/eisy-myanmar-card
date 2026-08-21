/**
 * Mobile viewport + keyboard lock
 *
 * Idle (keyboard closed): leave --app-vh as CSS 100svh so Safari chrome /
 * address-bar changes do not leave the shell taller than the visible area.
 *
 * Keyboard open: snapshot a pixel height and freeze --app-vh so the shell
 * does not collapse with visualViewport / 100dvh.
 *
 * Works with CSS: html/body are overflow-hidden + fixed; scrolling happens
 * inside .app-content / .auth-screen — so the keyboard overlays instead of
 * resizing the document (viewport meta also sets interactive-widget=overlays-content).
 */
(function lockAppViewport() {
  const root = document.documentElement;
  const mqMobile = window.matchMedia('(max-width: 900px)');

  let shellPx = 0;
  let focusDepth = 0;
  let lastOrientation = screen.orientation?.type || String(window.orientation);
  let unlockTimer = 0;

  function layoutHeight() {
    return Math.round(window.innerHeight || root.clientHeight || 0);
  }

  function visualHeight() {
    const vv = window.visualViewport;
    if (vv && Number.isFinite(vv.height) && vv.height > 0) {
      return Math.round(vv.height);
    }
    return layoutHeight();
  }

  /**
   * Visible shell height: never taller than what the user can see.
   * Using min(layout, visual) avoids the iOS Safari case where innerHeight
   * outruns the area above the browser chrome.
   */
  function visibleShellHeight() {
    const layout = layoutHeight();
    const visual = visualHeight();
    if (!layout) return visual || 0;
    if (!visual) return layout;
    return Math.min(layout, visual);
  }

  function keyboardOpen() {
    if (focusDepth > 0) return true;
    const layout = layoutHeight();
    const visual = visualHeight();
    if (!layout || !visual) return false;
    return (layout - visual) > 120 || (shellPx > 0 && (shellPx - visual) > 120);
  }

  function lockShellHeight(force) {
    if (!force && keyboardOpen() && shellPx) return;

    const next = visibleShellHeight();
    if (!next || !Number.isFinite(next)) return;

    shellPx = next;
    root.style.setProperty('--app-vh', `${shellPx}px`);
    root.style.setProperty('--app-shell-px', `${shellPx}px`);
  }

  /** Restore CSS svh / fill-available instead of a stale pixel lock. */
  function releaseShellHeight() {
    shellPx = 0;
    root.style.removeProperty('--app-vh');
    root.style.removeProperty('--app-shell-px');
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
      // Snapshot before the keyboard animates (and before visualViewport shrinks).
      lockShellHeight(true);
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
      // Drop the pixel lock so Safari chrome / 100svh stay in sync.
      releaseShellHeight();
    }, 120);
  }

  function onOrientationChange() {
    shellPx = 0;
    setKeyboardClass(false);
    focusDepth = 0;
    releaseShellHeight();
    window.setTimeout(() => {
      // Soft remeasure only if still needed after rotation settles.
      if (mqMobile.matches && keyboardOpen()) lockShellHeight(true);
    }, 280);
  }

  // Idle: rely on CSS --app-vh (100svh). Do not lock pixels on first paint —
  // locking to a tall innerHeight is what lets Safari chrome cover content.

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
    if (keyboardOpen()) return;
    // Desktop window resizes: keep CSS vars in sync via optional soft lock clear.
    if (!mqMobile.matches) {
      releaseShellHeight();
    }
  }, { passive: true });

  // Intentionally no visualViewport resize/scroll listeners while idle.
})();
