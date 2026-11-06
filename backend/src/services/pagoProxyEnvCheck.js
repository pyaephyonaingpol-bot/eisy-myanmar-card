'use strict';

/**
 * Pagocards DigitalOcean proxy readiness (never logs secret values).
 */
const { envIsSet, firstEnv } = require('../lib/envAliases');
const { loadPagoCardClient } = require('./loadPagoCardClient');

function resolveConfiguredPagoBaseUrl() {
  try {
    const lib = loadPagoCardClient();
    if (typeof lib.resolvePagoCardBaseUrl === 'function') {
      return lib.resolvePagoCardBaseUrl();
    }
  } catch (_) { /* fall through */ }
  return String(firstEnv('PAGO_CARD_API_BASE_URL') || '').trim().replace(/\/+$/, '');
}

function hostFromBaseUrl(base) {
  try {
    return new URL(base).hostname;
  } catch {
    return '';
  }
}

function isIpv4(value) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(String(value || '').trim());
}

function evaluatePagoProxyEnvChecks() {
  const baseUrl = resolveConfiguredPagoBaseUrl();
  const host = hostFromBaseUrl(baseUrl);
  const whitelistIp = firstEnv('PAGO_CARD_WHITELIST_IP', 'PAGO_CARD_PROXY_OUTBOUND_IP');
  const deprecatedHosts = String(process.env.PAGO_CARD_DEPRECATED_PROXY_HOSTS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const results = [
    {
      id: 'PAGO_CARD_API_BASE',
      label: 'Pagocards proxy base URL',
      ok: Boolean(baseUrl),
      hint: baseUrl
        ? `host ${host || '(parse ok)'}`
        : 'Set PAGO_CARD_API_BASE_URL or PAGO_CARD_PROXY_HOST (+ optional _SCHEME/_PATH)',
    },
    {
      id: 'PAGO_CARD_API_KEY',
      label: 'PAGO_CARD_API_KEY (publickey header)',
      ok: envIsSet('PAGO_CARD_API_KEY'),
      hint: 'Pagocards Business API public key',
    },
    {
      id: 'PAGO_CARD_SECRET_KEY',
      label: 'PAGO_CARD_SECRET_KEY (secretkey header)',
      ok: envIsSet('PAGO_CARD_SECRET_KEY'),
      hint: 'Pagocards Business API secret key',
    },
    {
      id: 'PAGO_CARD_WHITELIST_IP',
      label: 'PAGO_CARD_WHITELIST_IP (optional)',
      ok: !whitelistIp || isIpv4(whitelistIp),
      hint: whitelistIp
        ? (isIpv4(whitelistIp)
          ? `IPv4 ${whitelistIp} — must match Pagocards dashboard whitelist`
          : 'Must be a plain IPv4 address')
        : 'Recommended after Droplet migration — same IPv4 whitelisted at Pagocards',
    },
    {
      id: 'PAGO_PROXY_HOST_MATCH',
      label: 'Proxy host vs whitelist IP',
      ok: !whitelistIp || !isIpv4(host) || host === whitelistIp,
      hint: whitelistIp && isIpv4(host) && host !== whitelistIp
        ? `PAGO_CARD_API_BASE_URL host (${host}) differs from PAGO_CARD_WHITELIST_IP (${whitelistIp})`
        : (whitelistIp && host && host !== whitelistIp
          ? 'Using a DNS name is OK if it resolves to the whitelisted Droplet'
          : 'ok'),
    },
    {
      id: 'PAGO_DEPRECATED_PROXY',
      label: 'Deprecated proxy host check',
      ok: !host || !deprecatedHosts.some((bad) => bad && host.includes(bad)),
      hint: deprecatedHosts.length
        ? `Retire hosts listed in PAGO_CARD_DEPRECATED_PROXY_HOSTS (current host: ${host || 'n/a'})`
        : 'Set PAGO_CARD_DEPRECATED_PROXY_HOSTS to old Droplet IPs after migration',
    },
  ];

  const ok = results.every((row) => row.ok);
  return { ok, baseUrl, host, whitelistIp, results };
}

async function probePagoProxy({ timeoutMs = 12000 } = {}) {
  const baseUrl = resolveConfiguredPagoBaseUrl();
  if (!baseUrl) {
    return {
      ok: false,
      code: 'PAGO_NOT_CONFIGURED',
      message: 'Pagocards proxy URL is not configured',
      hint: 'Set PAGO_CARD_API_BASE_URL=http://YOUR_DROPLET_IP/api/pago on Vercel and the Droplet PM2 env',
    };
  }

  try {
    const client = loadPagoCardClient().createPagoCardClient({ timeoutMs });
    await client.getAdminBalance();
    return {
      ok: true,
      code: 'PAGO_OK',
      message: 'Pagocards responded via the configured proxy',
      proxyHost: hostFromBaseUrl(baseUrl),
    };
  } catch (err) {
    const code = String(err?.code || 'PAGO_ERROR');
    const message = String(err?.message || err);
    const status = Number(err?.status);

    if (code === 'PAGO_NETWORK' || /fetch failed|econnrefused|enotfound/i.test(message)) {
      return {
        ok: false,
        code: 'PAGO_NETWORK',
        message,
        proxyHost: hostFromBaseUrl(baseUrl),
        hint: 'Cannot reach the Droplet proxy — update PAGO_CARD_API_BASE_URL to the new host, open firewall ports, and ensure /api/pago is running on the Droplet.',
      };
    }
    if (code === 'PAGO_TIMEOUT') {
      return {
        ok: false,
        code,
        message,
        hint: 'Proxy or Pagocards timed out — retry or increase PAGO_CARD_REQUEST_TIMEOUT_MS',
      };
    }
    if (status === 401 || status === 403 || /whitelist|ip not|forbidden/i.test(message)) {
      return {
        ok: false,
        code: 'PAGO_IP_WHITELIST',
        message,
        hint: 'Whitelist the Droplet public IPv4 in the Pagocards merchant dashboard (set PAGO_CARD_WHITELIST_IP to that address for local checks).',
      };
    }
    if (status >= 400 && status < 500) {
      return {
        ok: true,
        code: 'PAGO_REACHABLE',
        message: 'Proxy reachable; Pagocards returned a client error (verify API keys and IP whitelist)',
        proxyHost: hostFromBaseUrl(baseUrl),
      };
    }
    return {
      ok: false,
      code,
      message,
      proxyHost: hostFromBaseUrl(baseUrl),
    };
  }
}

async function evaluatePagoProxyEnv(options = {}) {
  const checks = evaluatePagoProxyEnvChecks();
  let probe = null;
  if (options.probe && checks.ok) {
    probe = await probePagoProxy({ timeoutMs: options.probeTimeoutMs });
  }
  const ok = checks.ok && (!probe || probe.ok);
  return { ok, checks, probe };
}

module.exports = {
  evaluatePagoProxyEnv,
  evaluatePagoProxyEnvChecks,
  probePagoProxy,
  resolveConfiguredPagoBaseUrl,
};
