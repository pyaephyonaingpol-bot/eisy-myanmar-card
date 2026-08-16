/**
 * Keep --app-vh aligned with the visible viewport on browsers without 100dvh
 * (older mobile Safari/Chrome), so 100vh address-bar bugs don't clip the UI.
 */
(function syncAppViewportHeight() {
  const root = document.documentElement;
  const supportsDvh = typeof CSS !== 'undefined'
    && CSS.supports
    && CSS.supports('height', '100dvh');

  // Modern browsers: CSS @supports already maps --app-vh to 100dvh.
  if (supportsDvh) return;

  function apply() {
    const height = (window.visualViewport && window.visualViewport.height)
      ? window.visualViewport.height
      : window.innerHeight;
    if (!height || !Number.isFinite(height)) return;
    root.style.setProperty('--app-vh', `${Math.round(height)}px`);
  }

  apply();
  window.addEventListener('resize', apply, { passive: true });
  window.addEventListener('orientationchange', apply, { passive: true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', apply, { passive: true });
    window.visualViewport.addEventListener('scroll', apply, { passive: true });
  }
})();
