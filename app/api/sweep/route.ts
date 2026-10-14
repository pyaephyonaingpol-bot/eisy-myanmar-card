/**
 * POST /api/sweep — rent Netts energy, then sweep USDT TRC-20 to the central wallet.
 *
 * Configure via process.env (never commit secrets):
 * TRON_ENERGY_API_URL, TRON_ENERGY_API_KEY, TRON_FULL_HOST, CENTRAL_WALLET_ADDRESS
 *
 * On Vercel this repo may still rewrite `/api/*` to Express; this route follows
 * Next.js App Router conventions for dedicated Next hosting or future migration.
 */
import { NextRequest, NextResponse } from 'next/server';
import { TronWeb } from 'tronweb';

export const runtime = 'nodejs';

const USDT_TRC20_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const ENERGY_ORDER_AMOUNT = 65_000;
const DELEGATION_SETTLE_MS = 2_000;
const USDT_FEE_LIMIT_SUN = 100_000_000;

type SweepRequestBody = {
  childAddress?: string;
  childPrivateKey?: string;
  amountToSweep?: number | string;
};

type JsonRecord = Record<string, unknown>;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseAmountToSun(amountToSweep: number | string): string {
  const raw = String(amountToSweep).trim();
  if (!raw || !/^-?\d+(\.\d+)?$/.test(raw)) {
    throw new Error('amountToSweep must be a positive number');
  }
  const asNumber = Number(raw);
  if (!Number.isFinite(asNumber) || asNumber <= 0) {
    throw new Error('amountToSweep must be greater than zero');
  }
  const sun = BigInt(Math.round(asNumber * 1_000_000));
  if (sun <= 0n) {
    throw new Error('amountToSweep is too small after conversion');
  }
  return sun.toString();
}

function extractTxId(result: unknown): string | null {
  if (!result) return null;
  if (typeof result === 'string') return result;
  if (typeof result === 'object') {
    const row = result as JsonRecord;
    const tx = row.txid ?? row.txID ?? row.transaction;
    if (typeof tx === 'string') return tx;
    if (tx && typeof tx === 'object') {
      const nested = tx as JsonRecord;
      const nestedId = nested.txID ?? nested.txid;
      if (typeof nestedId === 'string') return nestedId;
    }
  }
  return null;
}

function isNettsEnergyOrderSuccessful(status: number, payload: unknown): boolean {
  if (status < 200 || status >= 300) return false;
  if (!payload || typeof payload !== 'object') return true;
  const body = payload as JsonRecord;
  if (body.success === false) return false;
  if (body.ok === false) return false;
  if (typeof body.error === 'string' && body.error.trim()) return false;
  if (typeof body.message === 'string' && /fail|error/i.test(body.message)) return false;
  const code = body.code;
  if (typeof code === 'number' && code !== 0 && code !== 200) return false;
  return true;
}

async function rentEnergyFromNetts(childAddress: string): Promise<{ ok: true; data: unknown }> {
  const apiUrl = requireEnv('TRON_ENERGY_API_URL');
  const apiKey = requireEnv('TRON_ENERGY_API_KEY');

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': apiKey,
    },
    body: JSON.stringify({
      address: childAddress,
      energy: ENERGY_ORDER_AMOUNT,
    }),
  });

  let data: unknown = null;
  const text = await response.text();
  if (text) {
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      data = { raw: text };
    }
  }

  if (!isNettsEnergyOrderSuccessful(response.status, data)) {
    const detail =
      data && typeof data === 'object'
        ? JSON.stringify(data)
        : text || `HTTP ${response.status}`;
    throw new Error(`Netts energy rental failed: ${detail}`);
  }

  return { ok: true, data };
}

function createChildTronWeb(fullHost: string, privateKey: string): TronWeb {
  const headers: Record<string, string> = {};
  const trongridKey = process.env.TRONGRID_API_KEY || process.env.TRON_PRO_API_KEY;
  if (trongridKey?.trim()) {
    headers['TRON-PRO-API-KEY'] = trongridKey.trim();
  }
  return new TronWeb({
    fullHost,
    headers,
    privateKey: privateKey.trim(),
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as SweepRequestBody;
    const childAddress = String(body.childAddress || '').trim();
    const childPrivateKey = String(body.childPrivateKey || '').trim();
    const amountToSweep = body.amountToSweep;

    if (!childAddress || !childPrivateKey || amountToSweep == null || amountToSweep === '') {
      return NextResponse.json(
        {
          ok: false,
          error: 'childAddress, childPrivateKey, and amountToSweep are required',
        },
        { status: 400 },
      );
    }

    const tronFullHost = requireEnv('TRON_FULL_HOST');
    const centralWallet = requireEnv('CENTRAL_WALLET_ADDRESS');
    const amountInSun = parseAmountToSun(amountToSweep);

    const tronWeb = createChildTronWeb(tronFullHost, childPrivateKey);
    if (!tronWeb.isAddress(childAddress)) {
      return NextResponse.json({ ok: false, error: 'Invalid childAddress' }, { status: 400 });
    }
    if (!tronWeb.isAddress(centralWallet)) {
      return NextResponse.json(
        { ok: false, error: 'Invalid CENTRAL_WALLET_ADDRESS configuration' },
        { status: 500 },
      );
    }

    const derivedAddress = tronWeb.address.fromPrivateKey(childPrivateKey);
    if (derivedAddress !== childAddress) {
      return NextResponse.json(
        { ok: false, error: 'childPrivateKey does not match childAddress' },
        { status: 400 },
      );
    }

    const energyOrder = await rentEnergyFromNetts(childAddress);
    await sleep(DELEGATION_SETTLE_MS);

    const contract = await tronWeb.contract().at(USDT_TRC20_CONTRACT);
    const sendResult = await contract.transfer(centralWallet, amountInSun).send({
      feeLimit: USDT_FEE_LIMIT_SUN,
    });

    const txid = extractTxId(sendResult);
    if (!txid) {
      return NextResponse.json(
        {
          ok: false,
          error: 'USDT transfer broadcast but no transaction id was returned',
          energyOrder: energyOrder.data,
          raw: sendResult,
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      ok: true,
      txid,
      from: childAddress,
      to: centralWallet,
      amountToSweep,
      amountInSun,
      energy: ENERGY_ORDER_AMOUNT,
      energyOrder: energyOrder.data,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status =
      message.startsWith('Missing required environment variable') ||
      message.includes('CENTRAL_WALLET_ADDRESS')
        ? 500
        : message.includes('Netts energy rental failed')
          ? 502
          : 400;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
