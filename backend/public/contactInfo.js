/**
 * Official Eisymyanmar contact details — shared across footer, support, and legal pages.
 */
(function initOfficialContact(global) {
  'use strict';

  const CONTACT = Object.freeze({
    phoneE164: '+971505176334',
    phoneLabel: '+971 50 517 6334',
    whatsappUrl: 'https://wa.me/971505176334',
    telegramHandle: '@eisymyanmar',
    telegramUrl: 'https://t.me/eisymyanmar',
    email: 'pyaephyo.naing@eisymyanmar.com',
    address:
      'Al Batal building 302 Zahiya Abudhabi (opposite of Ramada downtown hotel)',
    mapsUrl:
      'https://www.google.com/maps/search/?api=1&query=Al+Batal+building+302+Zahiya+Abu+Dhabi',
  });

  const ICONS = {
    phone:
      '<svg class="official-contact-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
    telegram:
      '<svg class="official-contact-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21.94 4.57a1.5 1.5 0 0 0-1.56-.24L3.6 11.23a1.25 1.25 0 0 0 .09 2.36l3.92 1.38 1.38 3.92a1.25 1.25 0 0 0 2.12.08l.12-.12 2.2-6.38 6.38-2.2.12-.12a1.25 1.25 0 0 0 .13-1.69zM10.5 13.5l6.9-4.5-5.25 5.85-.45 1.35-1.2-3.45z"/></svg>',
    location:
      '<svg class="official-contact-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
    email:
      '<svg class="official-contact-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><path d="m22 6-10 7L2 6"/></svg>',
  };

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * @param {'compact'|'default'|'legal'} variant
   */
  function renderOfficialContact(variant) {
    const v = variant || 'default';
    const showTitle = v !== 'compact';
    const title = showTitle
      ? '<h3 class="official-contact-title">Contact Us</h3>'
      : '<p class="official-contact-eyebrow">Contact Us</p>';

    const phoneRow =
      '<li class="official-contact-item">' +
      '<a class="official-contact-link" href="' + esc(CONTACT.whatsappUrl) + '" target="_blank" rel="noopener noreferrer">' +
      ICONS.phone +
      '<span><strong>Phone / WhatsApp</strong><br>' + esc(CONTACT.phoneLabel) + '</span>' +
      '</a></li>';

    const telegramRow =
      '<li class="official-contact-item">' +
      '<a class="official-contact-link" href="' + esc(CONTACT.telegramUrl) + '" target="_blank" rel="noopener noreferrer">' +
      ICONS.telegram +
      '<span><strong>Telegram</strong><br>' + esc(CONTACT.telegramHandle) + '</span>' +
      '</a></li>';

    const addressInner =
      '<span><strong>Address</strong><br>' + esc(CONTACT.address) + '</span>';
    const addressRow =
      '<li class="official-contact-item">' +
      (v === 'legal'
        ? '<div class="official-contact-static">' + ICONS.location + addressInner + '</div>'
        : '<a class="official-contact-link" href="' + esc(CONTACT.mapsUrl) + '" target="_blank" rel="noopener noreferrer">' +
          ICONS.location + addressInner + '</a>') +
      '</li>';

    const emailRow =
      '<li class="official-contact-item">' +
      '<a class="official-contact-link" href="mailto:' + esc(CONTACT.email) + '">' +
      ICONS.email +
      '<span><strong>Email</strong><br>' + esc(CONTACT.email) + '</span>' +
      '</a></li>';

    return (
      '<section class="official-contact official-contact--' + esc(v) + '" aria-label="Contact us">' +
      title +
      '<ul class="official-contact-list">' +
      phoneRow + telegramRow + addressRow + emailRow +
      '</ul></section>'
    );
  }

  function mount(selectorOrEl, variant) {
    const el =
      typeof selectorOrEl === 'string'
        ? document.querySelector(selectorOrEl)
        : selectorOrEl;
    if (!el) return;
    const v = variant || el.getAttribute('data-official-contact') || 'default';
    el.innerHTML = renderOfficialContact(v);
  }

  function mountAll() {
    document.querySelectorAll('[data-official-contact]').forEach((node) => {
      mount(node, node.getAttribute('data-official-contact') || 'default');
    });
  }

  global.EisyContact = Object.freeze({
    CONTACT,
    renderOfficialContact,
    mount,
    mountAll,
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountAll);
  } else {
    mountAll();
  }
})(typeof window !== 'undefined' ? window : globalThis);
