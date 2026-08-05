-- Payment proof on P2P buy orders (required before pending_seller_release)

ALTER TABLE p2p_buy_orders ADD COLUMN payment_tx_ref TEXT;
ALTER TABLE p2p_buy_orders ADD COLUMN payment_proof_path TEXT;
ALTER TABLE p2p_buy_orders ADD COLUMN payment_proof_original_name TEXT;
ALTER TABLE p2p_buy_orders ADD COLUMN payment_proof_mime_type TEXT;
