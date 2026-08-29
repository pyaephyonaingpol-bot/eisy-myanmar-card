/**
 * Deterministic per-user TRON (TRC-20) deposit addresses via BIP44 HD derivation.
 *
 * Path: m/44'/195'/0'/0/{index}  (coin type 195 = TRON)
 *
 * Seed sources (first match wins):
 *   1. TRON_HD_MNEMONIC  — BIP39 mnemonic
 *   2. TRON_HD_SEED_HEX  — hex seed (≥16 bytes)
 *   3. MASTER_PRIVATE_KEY — used as BIP32 seed material (fallback)
 *
 * Private keys are never persisted — only address + derivation index/path.
 */
const { mnemonicToSeedSync, validateMnemonic } = require('@scure/bip39');
const { wordlist } = require('@scure/bip39/wordlists/english');
const { HDKey } = require('@scure/bip32');
const { TronWeb } = require('tronweb');

const TRON_COIN_TYPE = 195;
const DEFAULT_ACCOUNT = 0;
const DEFAULT_CHANGE = 0;

function isHdEnabled() {
  const flag = String(process.env.TRON_HD_ENABLED || 'true').trim().toLowerCase();
  if (flag === 'false' || flag === '0' || flag === 'off') return false;
  try {
    return Boolean(getHdSeedBuffer());
  } catch (_) {
    return false;
  }
}

function getHdSeedBuffer() {
  const mnemonic = String(process.env.TRON_HD_MNEMONIC || '').trim();
  if (mnemonic) {
    if (!validateMnemonic(mnemonic, wordlist)) {
      const err = new Error('TRON_HD_MNEMONIC is not a valid BIP39 mnemonic');
      err.code = 'TRON_HD_MNEMONIC_INVALID';
      throw err;
    }
    return Buffer.from(mnemonicToSeedSync(mnemonic));
  }

  const seedHex = String(process.env.TRON_HD_SEED_HEX || '').trim().replace(/^0x/i, '');
  if (seedHex) {
    if (!/^[0-9a-fA-F]+$/.test(seedHex) || seedHex.length < 32 || seedHex.length % 2 !== 0) {
      const err = new Error('TRON_HD_SEED_HEX must be even-length hex (≥16 bytes)');
      err.code = 'TRON_HD_SEED_INVALID';
      throw err;
    }
    return Buffer.from(seedHex, 'hex');
  }

  const masterKey = String(process.env.MASTER_PRIVATE_KEY || '').trim().replace(/^0x/i, '');
  if (masterKey && /^[0-9a-fA-F]{64}$/.test(masterKey)) {
    // Non-BIP39 fallback: treat master private key bytes as BIP32 seed entropy.
    return Buffer.from(masterKey, 'hex');
  }

  return null;
}

function buildDerivationPath(index) {
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0 || i > 0x7fffffff) {
    const err = new Error(`Invalid HD derivation index: ${index}`);
    err.code = 'TRON_HD_INDEX_INVALID';
    throw err;
  }
  const account = Number(process.env.TRON_HD_ACCOUNT || DEFAULT_ACCOUNT) || 0;
  const change = Number(process.env.TRON_HD_CHANGE || DEFAULT_CHANGE) || 0;
  return `m/44'/${TRON_COIN_TYPE}'/${account}'/${change}/${i}`;
}

/**
 * Default index = userId (deterministic, stable per user).
 * Override with TRON_HD_INDEX_OFFSET (added to userId).
 */
function derivationIndexForUser(userId) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) {
    const err = new Error('A positive numeric user id is required for HD derivation');
    err.code = 'TRON_HD_USER_REQUIRED';
    throw err;
  }
  const offset = Number(process.env.TRON_HD_INDEX_OFFSET || 0) || 0;
  const index = id + offset;
  if (index < 0 || index > 0x7fffffff) {
    const err = new Error(`Derived HD index out of range for user ${userId}`);
    err.code = 'TRON_HD_INDEX_INVALID';
    throw err;
  }
  return index;
}

function deriveTronAccountAtIndex(index) {
  const seed = getHdSeedBuffer();
  if (!seed) {
    const err = new Error(
      'TRON HD seed not configured — set TRON_HD_MNEMONIC, TRON_HD_SEED_HEX, or MASTER_PRIVATE_KEY'
    );
    err.code = 'TRON_HD_NOT_CONFIGURED';
    throw err;
  }

  const path = buildDerivationPath(index);
  const master = HDKey.fromMasterSeed(seed);
  const child = master.derive(path);
  if (!child.privateKey) {
    const err = new Error(`Failed to derive private key at ${path}`);
    err.code = 'TRON_HD_DERIVE_FAILED';
    throw err;
  }

  const privateKeyHex = Buffer.from(child.privateKey).toString('hex');
  const tw = new TronWeb({ fullHost: process.env.TRON_FULL_HOST || 'https://api.trongrid.io' });
  const address = tw.address.fromPrivateKey(privateKeyHex);
  if (!address || !tw.isAddress(address)) {
    const err = new Error(`Derived invalid TRON address at ${path}`);
    err.code = 'TRON_HD_ADDRESS_INVALID';
    throw err;
  }

  return {
    index,
    path,
    address,
    // Returned only for ephemeral use (e.g. tests / future sweep). Callers must not persist.
    privateKeyHex,
  };
}

function deriveTronAddressForUser(userId) {
  const index = derivationIndexForUser(userId);
  const { path, address, privateKeyHex, index: idx } = deriveTronAccountAtIndex(index);
  return {
    userId: Number(userId),
    index: idx,
    path,
    address,
    privateKeyHex,
    network: 'TRC20',
  };
}

/** Public address only — never returns the private key. */
function getPublicDepositAddressForUser(userId) {
  const derived = deriveTronAddressForUser(userId);
  return {
    userId: derived.userId,
    index: derived.index,
    path: derived.path,
    address: derived.address,
    network: 'TRC20',
  };
}

module.exports = {
  TRON_COIN_TYPE,
  isHdEnabled,
  getHdSeedBuffer,
  buildDerivationPath,
  derivationIndexForUser,
  deriveTronAccountAtIndex,
  deriveTronAddressForUser,
  getPublicDepositAddressForUser,
};
