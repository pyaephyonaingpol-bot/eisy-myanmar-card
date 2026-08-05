const path = require('path');
const fs = require('fs');

const isVercel = Boolean(process.env.VERCEL);

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getDataDir() {
  const dir = isVercel
    ? path.join('/tmp', 'eisy-data')
    : path.join(__dirname, '..', 'data');
  return ensureDir(dir);
}

function getUploadRoot() {
  const root = isVercel
    ? path.join('/tmp', 'eisy-uploads')
    : path.join(__dirname, '..', 'uploads');
  ensureDir(root);
  ensureDir(path.join(root, 'deposits'));
  ensureDir(path.join(root, 'p2p'));
  ensureDir(path.join(root, 'kyc'));
  return root;
}

module.exports = { isVercel, getDataDir, getUploadRoot, ensureDir };
