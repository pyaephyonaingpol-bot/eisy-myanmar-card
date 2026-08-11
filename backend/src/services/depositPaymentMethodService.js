const DepositPaymentMethod = require('../models/DepositPaymentMethod');

function normalizeBankPayload(body = {}) {
  const bankName = String(body.bank_name || body.bankName || '').trim();
  const accountName = String(body.account_name || body.accountName || '').trim();
  const accountNumber = String(body.account_number || body.accountNumber || '').trim().replace(/\s+/g, '');
  const qrCodeImageUrl = String(body.qr_code_image_url || body.qrCodeImageUrl || '').trim() || null;
  const isActive = body.is_active !== undefined
    ? Boolean(body.is_active)
    : (body.isActive !== undefined ? Boolean(body.isActive) : true);
  const sortOrder = body.sort_order !== undefined
    ? Number(body.sort_order)
    : (body.sortOrder !== undefined ? Number(body.sortOrder) : 0);

  if (!bankName || bankName.length < 2) {
    throw new Error('Bank name is required');
  }
  if (!accountName || accountName.length < 2) {
    throw new Error('Account name is required');
  }
  if (!accountNumber || accountNumber.length < 5) {
    throw new Error('Account number is required');
  }
  if (qrCodeImageUrl && !/^https?:\/\//i.test(qrCodeImageUrl) && !qrCodeImageUrl.startsWith('/')) {
    throw new Error('QR code image URL must be an http(s) URL or a site path starting with /');
  }

  return {
    bankName,
    accountName,
    accountNumber,
    qrCodeImageUrl,
    isActive,
    sortOrder: Number.isFinite(sortOrder) ? sortOrder : 0,
  };
}

async function listPaymentMethods({ activeOnly = false } = {}) {
  const rows = await DepositPaymentMethod.listAll({ activeOnly });
  return rows.map((row) => DepositPaymentMethod.toPublic(row));
}

async function getPaymentMethod(id) {
  const row = await DepositPaymentMethod.findById(id);
  return DepositPaymentMethod.toPublic(row);
}

async function createPaymentMethod(body) {
  const payload = normalizeBankPayload(body);
  const row = await DepositPaymentMethod.create(payload);
  return DepositPaymentMethod.toPublic(row);
}

async function updatePaymentMethod(id, body) {
  const existing = await DepositPaymentMethod.findById(id);
  if (!existing) {
    const err = new Error('Payment method not found');
    err.code = 'NOT_FOUND';
    throw err;
  }
  const payload = normalizeBankPayload({ ...DepositPaymentMethod.toPublic(existing), ...body });
  const row = await DepositPaymentMethod.update(id, payload);
  return DepositPaymentMethod.toPublic(row);
}

async function deletePaymentMethod(id) {
  const row = await DepositPaymentMethod.remove(id);
  if (!row) {
    const err = new Error('Payment method not found');
    err.code = 'NOT_FOUND';
    throw err;
  }
  return DepositPaymentMethod.toPublic(row);
}

module.exports = {
  listPaymentMethods,
  getPaymentMethod,
  createPaymentMethod,
  updatePaymentMethod,
  deletePaymentMethod,
  normalizeBankPayload,
};
