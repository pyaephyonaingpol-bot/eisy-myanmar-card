/**
 * POST /api/sweep — Netts energy + USDT sweep (Next App Router shape).
 *
 * PRODUCTION (this repo on Vercel): `vercel.json` rewrites `/api/*` → Express
 * (`api/index.js`). The live handler is `backend/src/routes/sweep.js`.
 *
 * This file is for Next.js hosting or future migration. Requires the same
 * admin auth as Express: `X-Admin-Key: ADMIN_API_KEY` or admin Bearer session.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createRequire } from 'node:module';
import path from 'node:path';

export const runtime = 'nodejs';

const require = createRequire(path.join(process.cwd(), 'package.json'));

type SweepLib = {
  sweepUsdtWithNettsEnergy: (params: {
    childAddress: string;
    childPrivateKey: string;
    amountToSweep: number | string;
  }) => Promise<Record<string, unknown>>;
};

function loadSweepLib(): SweepLib {
  return require(path.join(process.cwd(), 'lib/nettsUsdtSweep.js')) as SweepLib;
}

function configuredAdminApiKey(): string {
  return String(process.env.ADMIN_API_KEY || '').trim();
}

function isSweepAuthorized(request: NextRequest): boolean {
  const adminKey = configuredAdminApiKey();
  const providedKey = request.headers.get('x-admin-key')?.trim();
  if (adminKey && providedKey && providedKey === adminKey) return true;

  const auth = request.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return false;
  // Full session RBAC belongs in Express; Next path accepts API key only unless extended.
  return false;
}

export async function POST(request: NextRequest) {
  if (!isSweepAuthorized(request)) {
    return NextResponse.json(
      { ok: false, error: 'Valid admin key required', code: 'ADMIN_REQUIRED' },
      { status: 403 },
    );
  }

  try {
    const body = (await request.json()) as {
      childAddress?: string;
      childPrivateKey?: string;
      amountToSweep?: number | string;
      idempotencyNonce?: string;
    };
    const { sweepUsdtWithNettsEnergy } = loadSweepLib();
    const result = await sweepUsdtWithNettsEnergy({
      childAddress: String(body.childAddress || ''),
      childPrivateKey: String(body.childPrivateKey || ''),
      amountToSweep: body.amountToSweep as number | string,
      idempotencyNonce: body.idempotencyNonce,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code =
      err && typeof err === 'object' && 'code' in err ? String((err as { code?: string }).code) : 'SWEEP_FAILED';
    let status = 400;
    if (code === 'SWEEP_CONFIG') status = 500;
    else if (code === 'SWEEP_NETTS_INSUFFICIENT_BALANCE') status = 402;
    else if (code === 'SWEEP_NETTS_TIMEOUT') status = 504;
    else if (code === 'SWEEP_NETTS_CONFLICT') status = 409;
    else if (
      code.startsWith('SWEEP_NETTS_')
      || code === 'SWEEP_NO_TXID'
      || code === 'SWEEP_CHAIN_FAILED'
    ) {
      status = 502;
    }
    return NextResponse.json({ ok: false, error: message, code }, { status });
  }
}
