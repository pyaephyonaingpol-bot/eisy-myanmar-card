const DepositPaymentMethod = require('../models/DepositPaymentMethod');

const METHOD_TYPE_LABELS = {
  kbzpay: 'KBZPay',
  wavepay: 'WavePay',
  bank_transfer: 'Bank Transfer',
  other: 'Other Wallet',
};

function normalizeMethodType(raw) {
  const value = String(raw || 'bank_transfer').trim().toLowerCase().replace(/\s+/g, '_');
  const aliases = {
    kbz: 'kbzpay',
    kpay: 'kbzpay',
    kbz_pay: 'kbzpay',
    wave: 'wavepay',
    wave_pay: 'wavepay',
    bank: 'bank_transfer',
    banktransfer: 'bank_transfer',
    transfer: 'bank_transfer',
  };
  const normalized = aliases[value] || value;
  if (!DepositPaymentMethod.METHOD_TYPES.includes(normalized)) {
    throw new Error('method_type must be one of: kbzpay, wavepay, bank_transfer, other');
  }
  return normalized;
}

function normalizeBankPayload(body = {}) {
  const bankName = String(body.bank_name || body.bankName || '').trim();
  const accountName = String(body.account_name || body.accountName || '').trim();
  const accountNumber = String(body.account_number || body.accountNumber || '').trim().replace(/\s+/g, '');
  const notes = String(body.notes || '').trim() || null;
  const qrCodeImageUrl = String(body.qr_code_image_url || body.qrCodeImageUrl || '').trim() || null;
  const isActive = body.is_active !== undefined
    ? Boolean(body.is_active)
    : (body.isActive !== undefined ? Boolean(body.isActive) : true);
  const sortOrder = body.sort_order !== undefined
    ? Number(body.sort_order)
    : (body.sortOrder !== undefined ? Number(body.sortOrder) : 0);
  const methodType = normalizeMethodType(
    body.method_type || body.methodType || 'bank_transfer'
  );

  if (!bankName || bankName.length < 2) {
    throw new Error('Bank name is required');
  }
  if (!accountName || accountName.length < 2) {
    throw new Error('Account name is required');
  }
  if (!accountNumber || accountNumber.length < 5) {
    throw new Error('Account number / phone number is required (min 5 characters)');
  }
  if (qrCodeImageUrl && !/^https?:\/\//i.test(qrCodeImageUrl) && !qrCodeImageUrl.startsWith('/')) {
    throw new Error('QR code image URL must be an http(s) URL or a site path starting with /');
  }

  return {
    bankName,
    accountName,
    accountNumber,
    methodType,
    notes,
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

async function resolveActivePaymentMethod({ paymentMethodId, paymentMethod } = {}) {
  if (paymentMethodId) {
    const row = await getPaymentMethod(parseInt(paymentMethodId, 10));
    if (!row || !row.is_active) {
      const err = new Error('Selected bank payment method is not available');
      err.code = 'PAYMENT_METHOD_UNAVAILABLE';
      throw err;
    }
    return row;
  }

  const active = await listPaymentMethods({ activeOnly: true });
  if (!active.length) {
    const err = new Error('No active bank payment methods configured. Please contact support.');
    err.code = 'NO_PAYMENT_METHODS';
    throw err;
  }

  if (paymentMethod) {
    const needle = String(paymentMethod).trim().toLowerCase();
    const byName = active.find((m) => String(m.bank_name || '').toLowerCase() === needle);
    if (byName) return byName;

    const byType = active.find((m) => {
      const type = String(m.method_type || '').toLowerCase();
      const label = (METHOD_TYPE_LABELS[type] || '').toLowerCase();
      return type === needle || label === needle || needle.includes(type) || type.includes(needle);
    });
    if (byType) return byType;
  }

  return active[0];
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

async function setPaymentMethodActive(id, isActive) {
  const existing = await DepositPaymentMethod.findById(id);
  if (!existing) {
    const err = new Error('Payment method not found');
    err.code = 'NOT_FOUND';
    throw err;
  }
  const row = await DepositPaymentMethod.update(id, {
    ...DepositPaymentMethod.toPublic(existing),
    isActive: Boolean(isActive),
  });
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
  resolveActivePaymentMethod,
  createPaymentMethod,
  updatePaymentMethod,
  setPaymentMethodActive,
  deletePaymentMethod,
  normalizeBankPayload,
  METHOD_TYPE_LABELS,
};
