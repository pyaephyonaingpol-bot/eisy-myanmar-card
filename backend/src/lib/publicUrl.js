/**
 * Resolve public site origin for webhooks / return URLs on Vercel or custom domains.
 */
function getPublicBaseUrl() {
  const explicit = (
    process.env.PUBLIC_BASE_URL
    || process.env.APP_BASE_URL
    || process.env.SITE_URL
    || ''
  ).trim().replace(/\/$/, '');
  if (explicit) return explicit;

  const vercelUrl = (process.env.VERCEL_URL || '').trim().replace(/\/$/, '');
  if (vercelUrl) {
    return vercelUrl.startsWith('http') ? vercelUrl : `https://${vercelUrl}`;
  }

  return '';
}

function joinPublicUrl(pathname) {
  const base = getPublicBaseUrl();
  if (!base) return undefined;
  const path = String(pathname || '').startsWith('/') ? pathname : `/${pathname || ''}`;
  return `${base}${path}`;
}

module.exports = {
  getPublicBaseUrl,
  joinPublicUrl,
};
