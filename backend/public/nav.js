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

    // Event delegation only (capture): avoids double-toggle when both a direct
    // listener and a delegated listener would fire on the same click.
    if (!this._sidebarDelegateBound) {
      this._sidebarDelegateBound = true;
      document.addEventListener('click', (e) => {
        const toggle = e.target?.closest?.('[data-sidebar-toggle]');
        if (toggle && (this.root?.contains?.(toggle) || toggle.classList.contains('sidebar-toggle-fab'))) {
          e.preventDefault();
          e.stopPropagation();
          this.toggleMobileSidebar({ force: true });
          return;
        }
        const backdrop = e.target?.closest?.('[data-sidebar-backdrop]');
        if (backdrop && this.root?.contains?.(backdrop)) {
          e.preventDefault();
          this.closeMobileSidebar();
        }
      }, true);
    }

    this.sidebarToggle = sidebarToggle;
    this.sidebarBackdrop = sidebarBackdrop;

    window.addEventListener('resize', () => {
      // Keyboard open/close often fires resize without a width change.
      // Ignore those so sidebar/layout logic does not re-run and shake the UI.
      const width = window.innerWidth;
      if (width === this._lastViewportWidth) return;
      this._lastViewportWidth = width;
      this.handleViewportChange();
    });

    this._lastViewportWidth = window.innerWidth;
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
    const label = (typeof I18n !== 'undefined')
      ? I18n.t(open ? 'close_menu' : 'open_menu')
      : (open ? 'Close menu' : 'Open menu');

    if (this.sidebarToggle) {
      this.sidebarToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      this.sidebarToggle.setAttribute('aria-label', label);
    }

    // Floating close control lives as a shell sibling of the backdrop/drawer so
    // it stacks above the full-screen dimmer (header toggle cannot).
    const fab = this.ensureSidebarFab(shell);
    if (fab) {
      const showFab = open && this.isMobileSidebarMode();
      fab.hidden = !showFab;
      fab.setAttribute('aria-hidden', showFab ? 'false' : 'true');
      fab.setAttribute('aria-expanded', open ? 'true' : 'false');
      fab.setAttribute('aria-label', label);
      fab.classList.toggle('is-visible', showFab);
    }

    document.body.classList.toggle('sidebar-scroll-lock', open && this.isMobileSidebarMode());
  },

  ensureSidebarFab(shell) {
    if (!shell) return null;
    let fab = shell.querySelector('.sidebar-toggle-fab');
    if (fab) return fab;
    fab = document.createElement('button');
    fab.type = 'button';
    fab.className = 'sidebar-toggle sidebar-toggle-fab';
    fab.setAttribute('data-sidebar-toggle', '');
    fab.setAttribute('aria-label', 'Close menu');
    fab.setAttribute('aria-expanded', 'false');
    fab.hidden = true;
    fab.innerHTML = '☰';
    // Insert after backdrop so it stacks with drawer siblings.
    const backdrop = shell.querySelector('[data-sidebar-backdrop]');
    if (backdrop?.nextSibling) shell.insertBefore(fab, backdrop.nextSibling);
    else shell.prepend(fab);
    return fab;
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
    // Avoid re-running page loaders when hashchange echoes a navigate we just did.
    if (page === this.currentPage) return;
    this.navigate(page, { pushHash: false });
  },

  navigate(page, opts = {}) {
    const { pushHash = false, replace = false, forceReload = false } = opts;
    // Same-page navigations (e.g. hash echoes) should not re-fire onChange loaders.
    if (page === this.currentPage && !forceReload && !opts.depositTab && !opts.p2pTab) {
      if (pushHash) {
        const hash = `#${this.hashPrefix}${page}`;
        if (replace) history.replaceState(null, '', hash);
        else if (window.location.hash !== hash) window.location.hash = hash;
      }
      return;
    }
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

  toggleMobileSidebar(opts = {}) {
    const { force = false } = opts;
    // If the visible hamburger was tapped, always toggle — do not no-op when
    // viewport width is near the breakpoint or a soft keyboard resize glitched.
    if (!force && !this.isMobileSidebarMode()) return;
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

  openMobileSidebar() {
    const shell = this.getShell();
    if (!shell) return;
    shell.classList.add('sidebar-open');
    this.syncSidebarUi();
  },
};
