# Deposit approval & master-wallet security

## Architecture note
USDT TRC20 deposits are paid **to** the shared master wallet address. There is no
post-deposit “sweep.” Withdrawals pay **from** the same master wallet.

## Guarantees (after hardening)

1. **On-chain verification required** for USDT auto-approve  
   `BYPASS_USDT_TX_VERIFICATION` defaults off and is **refused in production**.  
   TRC20 verification uses **TronGrid first**, then Tronscan fallback. On submit
   (`submitAndAutoVerifyUsdtDeposit`) and status poll (`retryVerifySubmittedUsdtDeposit`),
   a matching confirmed TxHash auto-credits net USDT and marks the deposit `VERIFIED`.

2. **No fake / reused TxHashes**  
   - Application check (`assertTxHashAvailable`) before credit — blocks reuse on
     any deposit status (pending or verified)  
   - Partial unique indexes on `deposit_requests_v2.tx_hash` / `txn_id` /
     `kpay_transaction_id`  
   - Admin USDT approve re-verifies on-chain (unless non-prod `force_approve`)

3. **Idempotent credit**  
   `DepositRequest.claimForCredit` only transitions non-terminal → `VERIFIED`  
   (`WHERE status NOT IN ('VERIFIED','REJECTED','FAILED')`). Concurrent credits
   cannot double-increase balances.

4. **MMK listener locked down**  
   `POST /api/deposit/verify` accepts **only**:
   - `DEPOSIT_LISTENER_SECRET` via `X-Deposit-Listener-Secret` (server hook), **or**
   - Authorized admin (API key / admin session) with `deposits` permission  
   Anonymous callers are always rejected. Exact amount match; USDT deposits
   rejected on this path.

5. **Binance Pay**  
   Query-before-credit enabled by default; paid amount checked vs deposit gross.

6. **BEP20 Transfer topic** corrected (`keccak256(Transfer(address,address,uint256))`);
   configurable `USDT_MIN_CONFIRMATIONS` on both RPC and BscScan paths.

## Required env (production)

```bash
DEPOSIT_LISTENER_SECRET=$(openssl rand -hex 32)   # Android listener + verify sim
# Optional:
USDT_MIN_CONFIRMATIONS=1
# Never:
# BYPASS_USDT_TX_VERIFICATION=true
```

Android listener: set Gradle property `DEPOSIT_LISTENER_SECRET` to the same value
(see `deposit_listener/app/build.gradle.kts` → `BuildConfig.LISTENER_SECRET`).

Dashboard listener simulation:  
`localStorage.setItem('deposit_listener_secret', '…')` then use the verify form.
Admin simulation may instead send `X-Admin-Key`.
