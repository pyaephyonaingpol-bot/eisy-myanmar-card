-- Per-user TRON HD deposit addresses (BIP44 m/44'/195'/0'/0/{index})

ALTER TABLE user_usdt_wallet_addresses
  ADD COLUMN derivation_index INTEGER;

ALTER TABLE user_usdt_wallet_addresses
  ADD COLUMN derivation_path TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_usdt_wallet_addr_trc20_custodial_unique
  ON user_usdt_wallet_addresses(user_id, network, address_type)
  WHERE address_type = 'custodial' AND network = 'TRC20';

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_usdt_wallet_addr_address_lookup
  ON user_usdt_wallet_addresses(address)
  WHERE address_type = 'custodial' AND network = 'TRC20';
