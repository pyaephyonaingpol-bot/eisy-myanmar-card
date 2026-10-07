/**
 * Pago Card Business API client.
 *
 * Docs: https://pagocards.com/documentation
 * Auth headers: `publickey` = PAGO_CARD_API_KEY, `secretkey` = PAGO_CARD_SECRET_KEY.
 * Base URL: PAGO_CARD_API_BASE_URL. Every request is sent to the DigitalOcean
 * proxy so Pago Card sees the whitelisted server IP.
 * Default: http://157.245.87.210/api/pago
 *
 * Card numbers and CVVs are returned to the caller when the provider includes
 * them. This module does not log request headers or response bodies.
 *
 * createVirtualCard(cardholderData) issues a card.
 * getCardDetails(cardId) returns number, CVV, and expiry when the provider sends them.
 * getCardBalance(cardId) reads the current balance.
 * topUpCard(cardId, amount) funds the card with USD already taken from the platform balance.
 */
'use strict';

const DEFAULT_BASE_URL = 'http://157.245.87.210/api/pago';
const REQUEST_TIMEOUT_MS = 20_000;
const ATM_PRODUCT_CODE = 'us_493_visa_atm';
const MIN_INITIAL_LOAD = 10;
const MAX_INITIAL_LOAD = 2500;
const MIN_TOP_UP = 5;

export type PagoCardProductCode =
  | 'us_493_visa_bin_v2'
  | 'us_404_visa_bin'
  | 'us_493_visa_atm'
  | '536_master'
  | (string & {});

export interface PagoCardBalance {
  /** Provider minor units (1 display dollar = 1_000_000). */
  amount: number;
  display_amount: number;
  currency: string;
}

export interface PagoCard {
  card_id: string;
  product_code: string;
  brand: string;
  type: string;
  currency: string;
  status: string;
  name_on_card: string;
  email: string;
  last_four: string;
  expiry_month: string;
  expiry_year: string;
  balance: PagoCardBalance;
  card_number: string | null;
  cvv: string | null;
  created_at: string;
  cardnumber?: string;
  expiredate?: string;
}

export interface PagoCardFundResult {
  card_id: string;
  amount: number;
  display_amount: number;
  currency: string;
  status: string;
  transaction_id: string;
}

export interface CreateCardInput {
  product_code: PagoCardProductCode;
  first_name: string;
  last_name: string;
  email: string;
  /** USD. Optional. Min 10, max 2500. Not allowed for us_493_visa_atm. */
  initial_load?: number;
  idempotencyKey?: string;
}

/** Cardholder payload for createVirtualCard. Snake_case and camelCase are both accepted. */
export interface CardholderData {
  product_code?: PagoCardProductCode;
  productCode?: PagoCardProductCode;
  first_name?: string;
  firstName?: string;
  last_name?: string;
  lastName?: string;
  name?: string;
  cardholder_name?: string;
  cardholderName?: string;
  email?: string;
  /** USD. Optional. Min 10, max 2500. Not allowed for us_493_visa_atm. */
  initial_load?: number;
  initialLoad?: number;
  idempotencyKey?: string;
}

export interface TopUpCardInput {
  cardId: string;
  /** USD. Minimum 5. Extra decimals are truncated, not rounded. */
  amount: number;
  idempotencyKey?: string;
}

export interface PagoCardClientOptions {
  baseUrl?: string;
  apiKey?: string;
  secretKey?: string;
  fetchImpl?: typeof fetch;
}

export interface PagoCardErrorOptions {
  status?: number;
  code?: string;
  details?: Record<string, string[]>;
  cause?: unknown;
}

interface PagoEnvelope<T> {
  status?: string;
  message?: string;
  code?: string;
  errors?: Record<string, string[]>;
  data?: T;
}

interface ResolvedPagoConfig {
  baseUrl: string;
  apiKey: string;
  secretKey: string;
  fetchImpl: typeof fetch;
}

class PagoCardError extends Error {
  status: number;
  code: string;
  details?: Record<string, string[]>;

  constructor(message: string, options: PagoCardErrorOptions = {}) {
    super(message);
    this.name = 'PagoCardError';
    this.status = options.status ?? 0;
    this.code = options.code || 'PAGO_ERROR';
    if (options.details) this.details = options.details;
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

function redact(message: string, secrets: string[]): string {
  let out = String(message || '');
  for (const secret of secrets) {
    if (secret && secret.length > 3) out = out.split(secret).join('[redacted]');
  }
  return out;
}

function resolveBaseUrl(raw: string | undefined): string {
  const trimmed = String(raw || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
  return trimmed.replace(/\/api\/v1$/i, '') || DEFAULT_BASE_URL;
}

function truncateUsd(amount: number): number {
  if (!Number.isFinite(amount)) return amount;
  const sign = amount < 0 ? -1 : 1;
  const truncated = Math.trunc(Math.abs(amount) * 100) / 100;
  return sign * truncated;
}

function requireText(value: unknown, field: string): string {
  const text = String(value ?? '').trim();
  if (!text) {
    throw new PagoCardError(`${field} is required`, {
      status: 400,
      code: 'VALIDATION_ERROR',
      details: { [field]: [`${field} is required`] },
    });
  }
  return text;
}

function resolveConfig(options: PagoCardClientOptions = {}): ResolvedPagoConfig {
  const apiKey = String(options.apiKey ?? process.env.PAGO_CARD_API_KEY ?? '').trim();
  const secretKey = String(options.secretKey ?? process.env.PAGO_CARD_SECRET_KEY ?? '').trim();
  if (!apiKey || !secretKey) {
    throw new PagoCardError(
      'Pago Card is not configured. Set PAGO_CARD_API_KEY and PAGO_CARD_SECRET_KEY.',
      { status: 500, code: 'PAGO_NOT_CONFIGURED' }
    );
  }
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new PagoCardError('fetch is not available', { status: 500, code: 'PAGO_NO_FETCH' });
  }
  return {
    baseUrl: resolveBaseUrl(options.baseUrl ?? process.env.PAGO_CARD_API_BASE_URL),
    apiKey,
    secretKey,
    fetchImpl: fetchImpl.bind(globalThis),
  };
}

async function pagoRequest<T>(
  config: ResolvedPagoConfig,
  method: string,
  path: string,
  options: { body?: unknown; idempotencyKey?: string } = {}
): Promise<T> {
  const headers: Record<string, string> = {
    publickey: config.apiKey,
    secretkey: config.secretKey,
  };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;

  let response: Response;
  try {
    response = await config.fetchImpl(`${config.baseUrl}${path}`, {
      method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Pago Card request failed';
    throw new PagoCardError(redact(message, [config.apiKey, config.secretKey]), {
      status: 0,
      code: 'PAGO_NETWORK',
      cause: err,
    });
  }

  const text = await response.text();
  let payload: PagoEnvelope<T> | null = null;
  if (text) {
    try {
      payload = JSON.parse(text) as PagoEnvelope<T>;
    } catch {
      throw new PagoCardError('Pago Card returned a non-JSON response', {
        status: response.status,
        code: 'PAGO_BAD_RESPONSE',
      });
    }
  }

  if (!response.ok || payload?.status === 'failure' || payload == null) {
    throw new PagoCardError(
      redact(payload?.message || `Pago Card request failed (${response.status})`, [config.apiKey, config.secretKey]),
      {
        status: response.status,
        code: payload?.code || 'PAGO_REQUEST_FAILED',
        details: payload?.errors,
      }
    );
  }

  if (payload.data === undefined || payload.data === null) {
    throw new PagoCardError(payload.message || 'Pago Card response did not include data', {
      status: response.status,
      code: 'PAGO_BAD_RESPONSE',
    });
  }

  return payload.data;
}

function normalizeCardholder(input: CardholderData | null | undefined): CreateCardInput {
  if (!input || typeof input !== 'object') {
    throw new PagoCardError('cardholderData is required', {
      status: 400,
      code: 'VALIDATION_ERROR',
      details: { cardholderData: ['cardholderData is required'] },
    });
  }
  let firstName = String(input.first_name || input.firstName || '').trim();
  let lastName = String(input.last_name || input.lastName || '').trim();
  if (!firstName || !lastName) {
    const full = String(input.name || input.cardholder_name || input.cardholderName || '').trim();
    const parts = full.split(/\s+/).filter(Boolean);
    if (!firstName && parts.length) firstName = parts[0];
    if (!lastName && parts.length > 1) lastName = parts.slice(1).join(' ');
  }
  const rawLoad = input.initial_load ?? input.initialLoad;
  const initialLoad = rawLoad == null || String(rawLoad).trim() === '' ? undefined : Number(rawLoad);
  return {
    product_code: String(input.product_code || input.productCode || '').trim(),
    first_name: firstName,
    last_name: lastName,
    email: String(input.email || '').trim(),
    initial_load: initialLoad,
    idempotencyKey: input.idempotencyKey,
  };
}

function createPagoCardClient(options: PagoCardClientOptions = {}) {
  async function createCard(input: CreateCardInput): Promise<PagoCard> {
    const config = resolveConfig(options);
    const productCode = requireText(input?.product_code, 'product_code');
    const firstName = requireText(input?.first_name, 'first_name');
    const lastName = requireText(input?.last_name, 'last_name');
    const email = requireText(input?.email, 'email');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new PagoCardError('email must be a valid email address', {
        status: 400,
        code: 'VALIDATION_ERROR',
        details: { email: ['The email field must be a valid email address.'] },
      });
    }

    const body: Record<string, unknown> = {
      product_code: productCode,
      first_name: firstName,
      last_name: lastName,
      email,
    };

    if (input.initial_load != null) {
      if (productCode === ATM_PRODUCT_CODE) {
        throw new PagoCardError('us_493_visa_atm cards do not accept initial_load', {
          status: 400,
          code: 'VALIDATION_ERROR',
          details: { initial_load: ['Do not send initial_load for us_493_visa_atm.'] },
        });
      }
      const initialLoad = truncateUsd(Number(input.initial_load));
      if (!Number.isFinite(initialLoad) || initialLoad < MIN_INITIAL_LOAD || initialLoad > MAX_INITIAL_LOAD) {
        throw new PagoCardError(
          `initial_load must be between ${MIN_INITIAL_LOAD} and ${MAX_INITIAL_LOAD} USD`,
          {
            status: 400,
            code: 'VALIDATION_ERROR',
            details: { initial_load: [`Minimum $${MIN_INITIAL_LOAD} and maximum $${MAX_INITIAL_LOAD}.`] },
          }
        );
      }
      body.initial_load = initialLoad;
    }

    return pagoRequest<PagoCard>(config, 'POST', '/api/v1/cards', {
      body,
      idempotencyKey: input.idempotencyKey,
    });
  }

  function createVirtualCard(cardholderData: CardholderData): Promise<PagoCard> {
    return createCard(normalizeCardholder(cardholderData));
  }

  async function getCardDetails(cardId: string): Promise<PagoCard> {
    const config = resolveConfig(options);
    const id = requireText(cardId, 'card_id');
    return pagoRequest<PagoCard>(config, 'GET', `/api/v1/cards/${encodeURIComponent(id)}`);
  }

  async function getCardBalance(cardId: string): Promise<PagoCardBalance> {
    const card = await getCardDetails(cardId);
    if (!card?.balance || card.balance.display_amount == null) {
      throw new PagoCardError('Card balance was not returned', {
        status: 200,
        code: 'PAGO_BAD_RESPONSE',
      });
    }
    return card.balance;
  }

  /**
   * Fund a card. `amount` is the USD taken from the platform USDT balance.
   * Accepts topUpCard(cardId, amount) or topUpCard({ cardId, amount }).
   */
  async function topUpCard(
    cardIdOrInput: string | TopUpCardInput,
    amount?: number,
    extra: { idempotencyKey?: string } = {}
  ): Promise<PagoCardFundResult> {
    const config = resolveConfig(options);
    const input: TopUpCardInput = typeof cardIdOrInput === 'object' && cardIdOrInput !== null
      ? cardIdOrInput
      : {
        cardId: String(cardIdOrInput || ''),
        amount: Number(amount),
        idempotencyKey: extra.idempotencyKey,
      };
    const cardId = requireText(input.cardId, 'card_id');
    const fundAmount = truncateUsd(Number(input.amount));
    if (!Number.isFinite(fundAmount) || fundAmount < MIN_TOP_UP) {
      throw new PagoCardError(`amount must be at least ${MIN_TOP_UP} USD`, {
        status: 400,
        code: 'VALIDATION_ERROR',
        details: { amount: [`The minimum top-up amount is $${MIN_TOP_UP}.`] },
      });
    }
    return pagoRequest<PagoCardFundResult>(
      config,
      'POST',
      `/api/v1/cards/${encodeURIComponent(cardId)}/fund`,
      {
        body: { amount: fundAmount },
        idempotencyKey: input.idempotencyKey,
      }
    );
  }

  return {
    createVirtualCard,
    createCard,
    getCardDetails,
    getCardBalance,
    topUpCard,
  };
}

function createVirtualCard(cardholderData: CardholderData): Promise<PagoCard> {
  return createPagoCardClient().createVirtualCard(cardholderData);
}

function createCard(input: CreateCardInput): Promise<PagoCard> {
  return createVirtualCard(input);
}

function getCardDetails(cardId: string): Promise<PagoCard> {
  return createPagoCardClient().getCardDetails(cardId);
}

function getCardBalance(cardId: string): Promise<PagoCardBalance> {
  return createPagoCardClient().getCardBalance(cardId);
}

function topUpCard(
  cardIdOrInput: string | TopUpCardInput,
  amount?: number,
  extra?: { idempotencyKey?: string }
): Promise<PagoCardFundResult> {
  return createPagoCardClient().topUpCard(cardIdOrInput, amount, extra);
}

module.exports = {
  PagoCardError,
  createPagoCardClient,
  createVirtualCard,
  createCard,
  getCardDetails,
  getCardBalance,
  topUpCard,
  truncateUsd,
};
