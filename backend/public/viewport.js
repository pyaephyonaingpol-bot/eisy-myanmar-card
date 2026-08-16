/**
 * Stable app shell height for mobile keyboards.
 *
 * Modern browsers: CSS maps --app-vh to 100svh (does not shrink with the
 * virtual keyboard). This script is only a fallback for engines without svh.
 *
 * Fallback rules:
 *  - Lock --app-vh to the layout viewport (innerHeight)
 *  - Never shrink it when the keyboard opens (visualViewport shrink)
 *  - Reset on orientation change
 */
(function syncAppViewportHeight() {
  const root = document.documentElement;
  const supportsSvh = typeof CSS !== 'undefined'
    && CSS.supports
    && CSS.supports('height', '100svh');

  // CSS @supports (height: 100svh) already keeps the shell stable.
  if (supportsSvh) return;

  let lockedLayoutPx = 0;
  let lastOrientation = screen.orientation?.type || window.orientation;

  function layoutHeight() {
    return window.innerHeight || document.documentElement.clientHeight || 0;
  }

  function visualHeight() {
    if (window.visualViewport && Number.isFinite(window.visualViewport.height)) {
      return window.visualViewport.height;
    }
    return layoutHeight();
  }

  function keyboardLikelyOpen() {
    const layout = layoutHeight();
    const visual = visualHeight();
    if (!layout || !visual) return false;
    // Ignore address-bar chrome (~40–80px); keyboards are typically >120px.
    return (layout - visual) > 120 || (lockedLayoutPx - visual) > 120;
  }

  function apply(force) {
    const layout = layoutHeight();
    if (!layout || !Number.isFinite(layout)) return;

    const orientation = screen.orientation?.type || window.orientation;
    if (orientation !== lastOrientation) {
      lastOrientation = orientation;
      lockedLayoutPx = 0;
    }

    if (force) lockedLayoutPx = 0;

    // Keep the previous lock while the keyboard is open so the shell does not jump.
    if (keyboardLikelyOpen() && lockedLayoutPx) return;

    lockedLayoutPx = Math.max(lockedLayoutPx, Math.round(layout));
    root.style.setProperty('--app-vh', `${lockedLayoutPx}px`);
  }

  apply(true);

  window.addEventListener('orientationchange', () => {
    lockedLayoutPx = 0;
    setTimeout(() => apply(true), 250);
  }, { passive: true });

  window.addEventListener('resize', () => {
    if (keyboardLikelyOpen()) return;
    apply(false);
  }, { passive: true });

  // Do not listen to visualViewport resize/scroll — those fire on keyboard
  // open/focus and were the primary cause of layout shake.
})();
