ALTER TABLE deposit_requests_v2
  ADD COLUMN platform_profit_usd REAL NOT NULL DEFAULT 0;

UPDATE deposit_requests_v2
SET platform_profit_usd = ROUND(
  COALESCE(
    json_extract(metadata, '$.pricing.platform_profit_usd'),
    json_extract(metadata, '$.payment_fee.platform_profit_usd'),
    json_extract(metadata, '$.fee_usdt'),
    CASE
      WHEN COALESCE(json_extract(metadata, '$.payment_fee.fee_mmk'), json_extract(metadata, '$.pricing.fee_mmk')) IS NOT NULL
       AND amount_mmk > 0
       AND amount_usd > 0
      THEN
        CAST(COALESCE(json_extract(metadata, '$.payment_fee.fee_mmk'), json_extract(metadata, '$.pricing.fee_mmk')) AS REAL)
        / NULLIF(amount_mmk / amount_usd, 0)
      ELSE 0
    END,
    0
  ),
  2
)
WHERE platform_profit_usd = 0
  OR platform_profit_usd IS NULL;
