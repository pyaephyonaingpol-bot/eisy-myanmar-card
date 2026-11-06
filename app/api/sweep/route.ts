/**
 * POST /api/sweep — Netts energy + USDT sweep (Next App Router shape).
 *
 * PRODUCTION (this repo on Vercel): `vercel.json` rewrites `/api/*` → Express
 * (`api/index.js`). The live handler is `backend/src/routes/sweep.js`.
 *
 * Server-side HD derivation only — never accept private keys in the request body.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createRequire } from 'node:module';
import path from 'node:path';

export const runtime = 'nodejs';

const require = createRequire(path.join(process.cwd(), 'package.json'));

function configuredAdminApiKey(): string {
  return String(process.env.ADMIN_API_KEY || '').trim();
}

function isSweepAuthorized(request: NextRequest): boolean {
  const adminKey = configuredAdminApiKey();
  const providedKey = request.headers.get('x-admin-key')?.trim();
  if (adminKey && providedKey && providedKey === adminKey) return true;
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
    const body = (await request.json()) as Record<string, unknown>;
    const { executeSingleDepositSweepFromRequest } = require(
      path.join(process.cwd(), 'backend/src/services/sweepSingleApiService.js'),
    ) as {
      executeSingleDepositSweepFromRequest: (
        b: Record<string, unknown>,
      ) => Promise<Record<string, unknown>>;
    };

    const dryRun = Boolean(body.dry_run ?? body.dryRun);
    const skipPreflight = Boolean(body.skip_preflight ?? body.skipPreflight);
    if (!dryRun && !skipPreflight) {
      const { assertSweepPreflightOrThrow } = require(
        path.join(process.cwd(), 'backend/src/services/tronSweepService.js'),
      ) as {
        assertSweepPreflightOrThrow: (opts: object) => Promise<unknown>;
      };
      await assertSweepPreflightOrThrow({ verifyAddresses: true, limit: 500 });
    }

    const result = await executeSingleDepositSweepFromRequest(body);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code =
      err && typeof err === 'object' && 'code' in err
        ? String((err as { code?: string }).code)
        : 'SWEEP_FAILED';
    let status = 400;
    if (code === 'SWEEP_CONFIG') status = 500;
    else if (code === 'SWEEP_PREFLIGHT_FAILED') status = 503;
    else if (code === 'SWEEP_PRIVATE_KEY_NOT_ALLOWED') status = 400;
    else if (code === 'SWEEP_NETTS_INSUFFICIENT_BALANCE') status = 402;
    else if (code === 'SWEEP_NETTS_TIMEOUT') status = 504;
    else if (code === 'SWEEP_NETTS_CONFLICT') status = 409;
    else if (
      code.startsWith('SWEEP_NETTS_')
      || code === 'SWEEP_NO_TXID'
      || code === 'SWEEP_CHAIN_FAILED'
    ) {
      status = 502;
    } else if (code === 'SWEEP_ADDRESS_MISMATCH' || code === 'TRON_HD_NOT_CONFIGURED') {
      status = 503;
    }
    const preflight =
      err && typeof err === 'object' && 'preflight' in err
        ? (err as { preflight?: unknown }).preflight
        : undefined;
    return NextResponse.json({ ok: false, error: message, code, preflight }, { status });
  }
}
