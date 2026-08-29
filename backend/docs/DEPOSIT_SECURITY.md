# Deposit approval & master-wallet security

## Architecture note
USDT TRC20 deposits prefer **per-user HD deposit addresses** derived from
`TRON_HD_MNEMONIC` / `TRON_HD_SEED_HEX` (BIP44 `m/44'/195'/0'/0/{userId}`).
Each user gets a unique TRC-20 address stored in:
- local `user_usdt_wallet_addresses` (with `derivation_index` / `derivation_path`)
- Supabase `user_wallets.tron_deposit_address` + `user_tron_deposit_addresses`

The TronGrid poller watches **each pending order’s** `deposit_address`.

Withdrawals still pay **from** the hot master wallet (`MASTER_PRIVATE_KEY`).
Sweeping HD deposits → master is a separate ops step (not automated here).

When HD is disabled (`TRON_HD_ENABLED=false`) or unconfigured, deposits fall back
to the shared gateway address (`TRON_GATEWAY_DEPOSIT_ADDRESS` / master wallet).

**Sweep:** `npm run sweep:tron-deposits -- --all` sends a small TRX gas top-up from
the master wallet to each deposit address, then sweeps all USDT back to master
(`tronSweepService.js`).

## Guarantees (after hardening)

1. **On-chain verification required** for USDT auto-approve  
   `BYPASS_USDT_TX_VERIFICATION` defaults off and is **refused in production**.

2. **No fake / reused TxHashes**  
   - Application check (`assertTxHashAvailable`) before credit — blocks reuse on
     any deposit status (pending or verified)  
   - Partial unique indexes on `deposit_requests_v2.tx_hash` / `txn_id` /
     `kpay_transaction_id`  
   - Admin USDT approve re-verifies on-chain (unless non-prod `force_approve`)

2b. **Rapid duplicate request rejection**  
   `assertNoRapidDuplicateUsdtDeposit` rejects same-user USDT creates with the
   same open amount (and network) within `USDT_DEPOSIT_DUPLICATE_WINDOW_SEC`
   (default 90s), and rejects TxID submits already attached to another recent
   deposit. Prevents double-click spam from flooding the admin queue.

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
Admin tools may verify deposits with `X-Admin-Key` when a listener secret is not presented.
