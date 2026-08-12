-- Harden deposit tx identity: normalize blanks and enforce unique tx hashes.
-- Prevents the same on-chain / payment TxID from verifying two deposits.

UPDATE deposit_requests_v2
SET tx_hash = NULL
WHERE tx_hash IS NOT NULL AND trim(tx_hash) = '';

UPDATE deposit_requests_v2
SET txn_id = NULL
WHERE txn_id IS NOT NULL AND trim(txn_id) = '';

UPDATE deposit_requests_v2
SET kpay_transaction_id = NULL
WHERE kpay_transaction_id IS NOT NULL AND trim(kpay_transaction_id) = '';

-- Keep the earliest verified row per tx_hash; clear duplicates so the unique index can apply.
UPDATE deposit_requests_v2
SET tx_hash = NULL
WHERE id IN (
  SELECT d.id
  FROM deposit_requests_v2 d
  WHERE d.tx_hash IS NOT NULL
    AND d.id NOT IN (
      SELECT MIN(d2.id)
      FROM deposit_requests_v2 d2
      WHERE d2.tx_hash IS NOT NULL
      GROUP BY d2.tx_hash
    )
);

UPDATE deposit_requests_v2
SET txn_id = NULL
WHERE id IN (
  SELECT d.id
  FROM deposit_requests_v2 d
  WHERE d.txn_id IS NOT NULL
    AND d.id NOT IN (
      SELECT MIN(d2.id)
      FROM deposit_requests_v2 d2
      WHERE d2.txn_id IS NOT NULL
      GROUP BY d2.txn_id
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_deposit_v2_tx_hash_uq
  ON deposit_requests_v2(tx_hash)
  WHERE tx_hash IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_deposit_v2_txn_id_uq
  ON deposit_requests_v2(txn_id)
  WHERE txn_id IS NOT NULL;
