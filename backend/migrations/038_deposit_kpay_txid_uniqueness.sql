-- Extend tx identity uniqueness to kpay_transaction_id (MMK listener / bank rails).
-- Complements 037 unique indexes on tx_hash and txn_id.

UPDATE deposit_requests_v2
SET kpay_transaction_id = NULL
WHERE kpay_transaction_id IS NOT NULL AND trim(kpay_transaction_id) = '';

-- Keep the earliest row per kpay_transaction_id; clear duplicates so the unique index can apply.
UPDATE deposit_requests_v2
SET kpay_transaction_id = NULL
WHERE id IN (
  SELECT d.id
  FROM deposit_requests_v2 d
  WHERE d.kpay_transaction_id IS NOT NULL
    AND d.id NOT IN (
      SELECT MIN(d2.id)
      FROM deposit_requests_v2 d2
      WHERE d2.kpay_transaction_id IS NOT NULL
      GROUP BY d2.kpay_transaction_id
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_deposit_v2_kpay_txn_uq
  ON deposit_requests_v2(kpay_transaction_id)
  WHERE kpay_transaction_id IS NOT NULL;
