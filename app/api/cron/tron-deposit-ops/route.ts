/**
 * GET|POST /api/cron/tron-deposit-ops — hourly TRON deposit credit + Netts sweep.
 *
 * PRODUCTION (eisymyanmar on Vercel): `vercel.json` rewrites `/api/*` → Express
 * (`api/index.js`). The live handler is `backend/src/routes/cron.js`.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createRequire } from 'node:module';
import path from 'node:path';

export const runtime = 'nodejs';
export const maxDuration = 60;

const require = createRequire(path.join(process.cwd(), 'package.json'));

function authorizeCron(request: NextRequest): { ok: true } | { ok: false; status: number; code: string } {
  const secret = String(process.env.CRON_SECRET || '').trim();
  if (!secret) {
    return { ok: false, status: 503, code: 'CRON_NOT_CONFIGURED' };
  }
  const header = request.headers.get('authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const token = match?.[1]?.trim() || '';
  if (!token || token !== secret) {
    return { ok: false, status: 401, code: 'CRON_UNAUTHORIZED' };
  }
  return { ok: true };
}

export async function GET(request: NextRequest) {
  return runCron(request);
}

export async function POST(request: NextRequest) {
  return runCron(request);
}

async function runCron(request: NextRequest) {
  const auth = authorizeCron(request);
  if (!auth.ok) {
    return NextResponse.json(
      {
        ok: false,
        success: false,
        error: auth.code === 'CRON_NOT_CONFIGURED'
          ? 'CRON_SECRET is not configured on the server'
          : 'Unauthorized',
        code: auth.code,
      },
      { status: auth.status },
    );
  }

  try {
    const { runTronDepositOpsCron } = require(
      path.join(process.cwd(), 'backend/src/services/tronDepositOpsCronService.js'),
    ) as { runTronDepositOpsCron: (opts?: object) => Promise<Record<string, unknown>> };

    let body: Record<string, unknown> = {};
    if (request.method === 'POST') {
      try {
        body = (await request.json()) as Record<string, unknown>;
      } catch {
        body = {};
      }
    }

    const dryRunParam = request.nextUrl.searchParams.get('dry_run');
    const dryRun =
      body.dry_run ?? body.dryRun ?? (dryRunParam != null ? dryRunParam === 'true' : null);

    const result = await runTronDepositOpsCron({
      dryRun: dryRun != null ? Boolean(dryRun) : null,
      skipPreflight: Boolean(body.skip_preflight ?? body.skipPreflight),
    });

    const sweepOk = result.sweep_ok !== false;
    const status = result.skipped ? 200 : sweepOk ? 200 : 207;

    return NextResponse.json(
      {
        success: true,
        ok: true,
        ...result,
      },
      { status },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code =
      err && typeof err === 'object' && 'code' in err
        ? String((err as { code?: string }).code)
        : 'CRON_DEPOSIT_OPS_FAILED';
    let status = 500;
    if (code === 'SWEEP_IN_PROGRESS') status = 409;
    else if (code === 'SWEEP_PREFLIGHT_FAILED') status = 503;
    const preflight =
      err && typeof err === 'object' && 'preflight' in err
        ? (err as { preflight?: unknown }).preflight
        : undefined;
    return NextResponse.json(
      { ok: false, success: false, error: message, code, preflight },
      { status },
    );
  }
}
