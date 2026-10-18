/**
 * Admin POST /api/sweep — server-side HD derivation only (no client private keys).
 */
const {
  sweepDepositAddress,
  assertSweepBodyHasNoPrivateKey,
} = require('./tronSweepService');

function parseSingleSweepBody(body = {}) {
  assertSweepBodyHasNoPrivateKey(body);

  const userIdRaw = body.user_id ?? body.userId ?? null;
  const userId = userIdRaw != null && userIdRaw !== '' ? Number(userIdRaw) : null;
  const derivationIndexRaw = body.derivation_index ?? body.derivationIndex ?? null;
  const derivationIndex =
    derivationIndexRaw != null && derivationIndexRaw !== ''
      ? Number(derivationIndexRaw)
      : null;
  const childAddress = String(body.childAddress ?? body.child_address ?? '').trim() || null;
  const dryRun = Boolean(body.dry_run ?? body.dryRun);
  const forceGas = Boolean(body.force_gas ?? body.forceGas);
  const idempotencyNonce = body.idempotencyNonce ?? body.idempotency_nonce ?? null;

  if (userId == null && derivationIndex == null) {
    const err = new Error('user_id or derivation_index is required');
    err.code = 'SWEEP_BAD_REQUEST';
    throw err;
  }
  if (userId != null && (!Number.isInteger(userId) || userId <= 0)) {
    const err = new Error('user_id must be a positive integer');
    err.code = 'SWEEP_INVALID_USER';
    throw err;
  }
  if (
    derivationIndex != null
    && (!Number.isInteger(derivationIndex) || derivationIndex < 0)
  ) {
    const err = new Error('derivation_index must be a non-negative integer');
    err.code = 'SWEEP_BAD_REQUEST';
    throw err;
  }

  return {
    userId,
    derivationIndex,
    childAddress,
    dryRun,
    forceGas,
    idempotencyNonce,
  };
}

/**
 * @param {Record<string, unknown>} body
 * @param {{ sweepUsdtWithNettsEnergyFn?: Function, fetchImpl?: typeof fetch }} [inject]
 */
async function executeSingleDepositSweepFromRequest(body, inject = {}) {
  const parsed = parseSingleSweepBody(body);
  const result = await sweepDepositAddress({
    userId: parsed.userId,
    derivationIndex: parsed.derivationIndex,
    address: parsed.childAddress,
    dryRun: parsed.dryRun,
    forceGas: parsed.forceGas,
    ...inject,
  });

  if (parsed.idempotencyNonce && !parsed.dryRun) {
    return { ...result, idempotencyNonce: parsed.idempotencyNonce };
  }
  return result;
}

module.exports = {
  parseSingleSweepBody,
  executeSingleDepositSweepFromRequest,
};
