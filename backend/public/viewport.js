/**
 * Keep --app-vh in sync with the visible viewport on mobile browsers
 * where 100vh includes the URL bar and 100dvh is unavailable.
 */
(function syncAppViewportHeight() {
  const root = document.documentElement;

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

  // Prefer CSS 100dvh when supported — avoid fighting it on modern browsers.
  if (typeof CSS !== 'undefined' && CSS.supports && CSS.supports('height', '100dvh')) {
    root.style.removeProperty('--app-vh');
  }
})();
