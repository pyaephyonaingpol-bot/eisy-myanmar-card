/**
 * Lightweight SPA page router — show/hide sections without reload.
 * Supports hash URLs (#page) and optional onChange callbacks.
 */
const AppNav = {
  MOBILE_BREAKPOINT: 900,

  init(options = {}) {
    const {
      root = document,
      navSelector = '.sidebar-nav [data-page]',
      pageSelector = '.app-page[data-page]',
      defaultPage = 'home',
      hashPrefix = '',
      onChange = null,
    } = options;

    this.root = root;
    this.navSelector = navSelector;
    this.pageSelector = pageSelector;
    this.defaultPage = defaultPage;
    this.hashPrefix = hashPrefix;
    this.onChange = onChange;
    this.currentPage = null;

    root.querySelectorAll(navSelector).forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const page = btn.dataset.page;
        if (page) this.navigate(page, { pushHash: true });
      });
    });

    window.addEventListener('hashchange', () => this.syncFromHash());

    const sidebarToggle = root.querySelector('[data-sidebar-toggle]');
    const sidebarBackdrop = root.querySelector('[data-sidebar-backdrop]');
    this.sidebarToggle = sidebarToggle;

    if (sidebarToggle) {
      sidebarToggle.addEventListener('click', () => this.toggleMobileSidebar());
    }
    if (sidebarBackdrop) {
      sidebarBackdrop.addEventListener('click', () => this.closeMobileSidebar());
    }

    window.addEventListener('resize', () => this.handleViewportChange());

    this.syncFromHash();
    if (!window.location.hash) {
      this.navigate(defaultPage, { pushHash: true, replace: true });
    }

    this.syncSidebarUi();
  },

  getShell() {
    if (this.root?.classList?.contains('app-shell')) return this.root;
    return this.root?.querySelector('.app-shell') || null;
  },

  isMobileSidebarMode() {
    return window.innerWidth <= this.MOBILE_BREAKPOINT;
  },

  syncSidebarUi() {
    const shell = this.getShell();
    const open = Boolean(shell?.classList.contains('sidebar-open'));
    if (this.sidebarToggle) {
      this.sidebarToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      const openKey = open ? 'close_menu' : 'open_menu';
      const label = (typeof I18n !== 'undefined') ? I18n.t(openKey) : (open ? 'Close menu' : 'Open menu');
      this.sidebarToggle.setAttribute('aria-label', label);
    }
    document.body.classList.toggle('sidebar-scroll-lock', open && this.isMobileSidebarMode());
  },

  handleViewportChange() {
    if (!this.isMobileSidebarMode()) {
      this.closeMobileSidebar();
    } else {
      this.syncSidebarUi();
    }
  },

  pageFromHash() {
    const raw = window.location.hash.replace(/^#/, '').trim();
    if (!raw) return null;
    return this.hashPrefix && raw.startsWith(this.hashPrefix)
      ? raw.slice(this.hashPrefix.length)
      : raw;
  },

  syncFromHash() {
    const page = this.pageFromHash() || this.defaultPage;
    this.navigate(page, { pushHash: false });
  },

  navigate(page, opts = {}) {
    const { pushHash = false, replace = false } = opts;
    const pages = this.root.querySelectorAll(this.pageSelector);
    const navItems = this.root.querySelectorAll(this.navSelector);
    let found = false;

    pages.forEach((panel) => {
      const active = panel.dataset.page === page;
      panel.classList.toggle('is-active', active);
      if (active) found = true;
    });

    if (!found) {
      if (page !== this.defaultPage) {
        this.navigate(this.defaultPage, opts);
      }
      return;
    }

    navItems.forEach((btn) => {
      const active = btn.dataset.page === page;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-current', active ? 'page' : 'false');
    });

    this.currentPage = page;
    this.closeMobileSidebar();

    if (pushHash) {
      const hash = `#${this.hashPrefix}${page}`;
      if (replace) {
        history.replaceState(null, '', hash);
      } else if (window.location.hash !== hash) {
        window.location.hash = hash;
      }
    }

    const titleEl = this.root.querySelector(`[data-page-title="${page}"]`);
    if (titleEl) {
      const heading = this.root.querySelector('.page-heading');
      if (heading) {
        const key = titleEl.getAttribute('data-i18n');
        heading.textContent = (key && typeof I18n !== 'undefined') ? I18n.t(key) : titleEl.textContent;
      }
    }

    if (typeof this.onChange === 'function') {
      this.onChange(page, opts);
    }
  },

  toggleMobileSidebar() {
    if (!this.isMobileSidebarMode()) return;
    const shell = this.getShell();
    if (!shell) return;
    shell.classList.toggle('sidebar-open');
    this.syncSidebarUi();
  },

  closeMobileSidebar() {
    const shell = this.getShell();
    if (!shell) return;
    shell.classList.remove('sidebar-open');
    this.syncSidebarUi();
  },
};
