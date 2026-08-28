/**
 * TRON energy rental (Feee.io-compatible) before master-wallet USDT transfers.
 *
 * Env:
 *   ENERGY_RENTAL_ENABLED=true
 *   ENERGY_RENTAL_API_KEY=...
 *   ENERGY_RENTAL_API_BASE=https://feee.io/open
 *   ENERGY_RENTAL_AMOUNT=65000
 *   ENERGY_RENTAL_WAIT_MS=2000
 *   ENERGY_RENTAL_DURATION=1
 *   ENERGY_RENTAL_TIME_UNIT=h
 */
const DEFAULT_API_BASE = 'https://feee.io/open';
const DEFAULT_ENERGY = 65_000;
const DEFAULT_WAIT_MS = 2_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isEnergyRentalEnabled() {
  const flag = String(process.env.ENERGY_RENTAL_ENABLED || '').trim().toLowerCase();
  if (flag === 'false' || flag === '0' || flag === 'off') return false;
  // Enabled when an API key is present unless explicitly disabled.
  return Boolean(String(process.env.ENERGY_RENTAL_API_KEY || process.env.FEEE_API_KEY || '').trim());
}

function getEnergyRentalConfig() {
  const apiKey = String(
    process.env.ENERGY_RENTAL_API_KEY
    || process.env.FEEE_API_KEY
    || ''
  ).trim();
  const apiBase = String(
    process.env.ENERGY_RENTAL_API_BASE
    || process.env.FEEE_API_BASE
    || DEFAULT_API_BASE
  ).trim().replace(/\/$/, '');
  const energyAmount = Math.max(
    32_000,
    parseInt(process.env.ENERGY_RENTAL_AMOUNT || String(DEFAULT_ENERGY), 10) || DEFAULT_ENERGY
  );
  const waitMs = Math.max(
    0,
    parseInt(process.env.ENERGY_RENTAL_WAIT_MS || String(DEFAULT_WAIT_MS), 10) || DEFAULT_WAIT_MS
  );
  const rentDuration = Math.max(
    1,
    parseInt(process.env.ENERGY_RENTAL_DURATION || '1', 10) || 1
  );
  const rentTimeUnit = String(process.env.ENERGY_RENTAL_TIME_UNIT || 'h').trim().toLowerCase() || 'h';

  return {
    apiKey,
    apiBase,
    energyAmount,
    waitMs,
    rentDuration,
    rentTimeUnit,
    submitPath: process.env.ENERGY_RENTAL_SUBMIT_PATH || '/v2/order/submit',
  };
}

/**
 * POST energy rental order to Feee.io (or compatible provider).
 * @param {string} receiveAddress - Master wallet that will receive delegated energy
 */
async function rentEnergyForAddress(receiveAddress, opts = {}) {
  const address = String(receiveAddress || '').trim();
  if (!address) {
    const err = new Error('Energy rental receive_address is required');
    err.code = 'ENERGY_RENTAL_ADDRESS_REQUIRED';
    throw err;
  }

  if (!isEnergyRentalEnabled()) {
    return {
      skipped: true,
      reason: 'energy_rental_disabled',
      receive_address: address,
    };
  }

  const cfg = getEnergyRentalConfig();
  if (!cfg.apiKey) {
    const err = new Error('ENERGY_RENTAL_API_KEY (or FEEE_API_KEY) is not configured');
    err.code = 'ENERGY_RENTAL_NOT_CONFIGURED';
    throw err;
  }

  const energyAmount = opts.energyAmount != null
    ? Number(opts.energyAmount)
    : cfg.energyAmount;
  const body = {
    resource_type: 1,
    receive_address: address,
    resource_value: energyAmount,
    rent_duration: opts.rentDuration != null ? opts.rentDuration : cfg.rentDuration,
    rent_time_unit: opts.rentTimeUnit || cfg.rentTimeUnit,
  };

  const url = `${cfg.apiBase}${cfg.submitPath.startsWith('/') ? cfg.submitPath : `/${cfg.submitPath}`}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs || 20_000);

  let response;
  let payload = null;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        key: cfg.apiKey,
        'User-Agent': 'Eisy-Myanmar/1.0 (energy-rental)',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      const timed = new Error('Energy rental API timed out');
      timed.code = 'ENERGY_RENTAL_TIMEOUT';
      throw timed;
    }
    const wrapped = new Error(`Energy rental request failed: ${err.message}`);
    wrapped.code = 'ENERGY_RENTAL_REQUEST_FAILED';
    wrapped.cause = err;
    throw wrapped;
  } finally {
    clearTimeout(timer);
  }

  const code = payload?.code;
  const okHttp = response.ok;
  const okBiz = code === 0 || code === '0' || code === 200 || String(payload?.msg || '').toLowerCase() === 'success';
  if (!okHttp || (payload && code != null && !okBiz)) {
    const message = payload?.msg
      || payload?.message
      || payload?.error
      || `Energy rental HTTP ${response.status}`;
    const err = new Error(message);
    err.code = 'ENERGY_RENTAL_FAILED';
    err.status = response.status;
    err.details = payload;
    throw err;
  }

  const waitMs = opts.waitMs != null ? Number(opts.waitMs) : cfg.waitMs;
  if (waitMs > 0) {
    await sleep(waitMs);
  }

  return {
    skipped: false,
    receive_address: address,
    energy_amount: energyAmount,
    wait_ms: waitMs,
    order_no: payload?.data?.order_no || payload?.data?.orderNo || null,
    pay_amount: payload?.data?.pay_amount ?? null,
    provider: 'feee',
    raw: payload?.data || payload || null,
  };
}

module.exports = {
  DEFAULT_ENERGY,
  DEFAULT_WAIT_MS,
  isEnergyRentalEnabled,
  getEnergyRentalConfig,
  rentEnergyForAddress,
  sleep,
};
