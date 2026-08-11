/**
 * Generate a new TRON (TRC20) wallet.
 *
 * Usage:
 *   node create-wallet.js
 *
 * Prints address (base58 + hex), public key, and private key.
 * Keep the private key secret — anyone with it controls the funds.
 */

const { TronWeb } = require('tronweb');

async function createWallet() {
  const account = await TronWeb.createAccount();

  return {
    address: account.address.base58,
    addressHex: account.address.hex,
    publicKey: account.publicKey,
    privateKey: account.privateKey,
  };
}

async function main() {
  const wallet = await createWallet();

  console.log('=== New TRON Wallet ===');
  console.log(`Address (Base58): ${wallet.address}`);
  console.log(`Address (Hex):    ${wallet.addressHex}`);
  console.log(`Public Key:       ${wallet.publicKey}`);
  console.log(`Private Key:      ${wallet.privateKey}`);
  console.log('');
  console.log('WARNING: Store the private key securely. Never commit or share it.');

  return wallet;
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Failed to create wallet:', err.message || err);
    process.exit(1);
  });
}

module.exports = { createWallet };
