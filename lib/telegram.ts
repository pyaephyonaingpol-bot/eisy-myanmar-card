/**
 * Admin Telegram notifications.
 *
 * Runtime exports use CommonJS `module.exports` (same pattern as lib/pagocard.ts).
 * Express loads this file through backend/src/services/loadTelegramClient.js.
 * Bot token: TELEGRAM_BOT_TOKEN. Chat: TELEGRAM_ADMIN_CHAT_ID, then
 * TELEGRAM_CHAT_ID, then TELEGRAM_SUPPORT_CHAT_ID.
 * A missing token or chat skips the send and does not throw.
 */
'use strict';

export type TelegramNotifyResult = {
  ok: boolean;
  skipped?: boolean;
  error?: string;
  chatId?: string;
  plain?: boolean;
  message?: { message_id?: number };
};

type SendOptions = {
  parseMode?: string;
  replyToMessageId?: number | string | null;
  messageThreadId?: number | string | null;
  fetchImpl?: typeof fetch;
  token?: string;
  chatId?: string;
};

type Person = {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
};

const PLACEHOLDER_TOKEN = 'your_telegram_bot_token_here';
const PLACEHOLDER_CHAT = 'your_admin_chat_id_here';

function readToken(override?: string) {
  const token = String(override ?? process.env.TELEGRAM_BOT_TOKEN ?? '').trim();
  if (!token || token === PLACEHOLDER_TOKEN) return '';
  return token;
}

function readChatId(override?: string) {
  const chatId = String(
    override
    ?? process.env.TELEGRAM_ADMIN_CHAT_ID
    ?? process.env.TELEGRAM_CHAT_ID
    ?? process.env.TELEGRAM_SUPPORT_CHAT_ID
    ?? ''
  ).trim();
  if (!chatId || chatId === PLACEHOLDER_CHAT) return '';
  return chatId;
}

function money(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : '0.00';
}

function whole(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '0';
}

function who(user?: Person | null) {
  const name = user?.name || 'Unknown';
  const contact = user?.email || user?.phone || 'N/A';
  return `${name} (${contact})`;
}

async function postTelegram(
  token: string,
  body: Record<string, unknown>,
  fetchImpl?: typeof fetch
) {
  const doFetch = fetchImpl || fetch;
  const response = await doFetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({} as { ok?: boolean; description?: string; result?: { message_id?: number } }));
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.description || `Telegram HTTP ${response.status}`);
  }
  return payload.result || {};
}

async function sendAdminMessage(message: string, options: SendOptions = {}): Promise<TelegramNotifyResult> {
  const token = readToken(options.token);
  const chatId = readChatId(options.chatId);
  const text = String(message || '');
  if (!chatId) {
    console.log('[Telegram] Admin chat not configured — skipping notification');
    console.log('[Telegram]', text.replace(/\*/g, ''));
    return { ok: false, skipped: true };
  }
  if (!token) {
    console.log('[Telegram] Bot token not configured — skipping notification');
    console.log('[Telegram]', text.replace(/\*/g, ''));
    return { ok: false, skipped: true };
  }

  const base: Record<string, unknown> = {
    chat_id: chatId,
    disable_web_page_preview: true,
  };
  if (options.replyToMessageId) base.reply_to_message_id = Number(options.replyToMessageId);
  if (options.messageThreadId) base.message_thread_id = Number(options.messageThreadId);

  try {
    const sent = await postTelegram(token, {
      ...base,
      text,
      parse_mode: options.parseMode || 'Markdown',
    }, options.fetchImpl);
    return { ok: true, message: sent, chatId };
  } catch (err) {
    try {
      const plain = await postTelegram(token, {
        ...base,
        text: text.replace(/[*_`[\]]/g, ''),
      }, options.fetchImpl);
      return { ok: true, message: plain, chatId, plain: true };
    } catch (err2) {
      const error = err2 instanceof Error ? err2.message : 'Telegram send failed';
      console.error('[Telegram] Failed to send notification:', error);
      return { ok: false, error };
    }
  }
}

async function notifyAdminDepositRequest(input: {
  user?: Person | null;
  amountUsdt?: unknown;
  feeUsdt?: unknown;
  netUsdt?: unknown;
  network?: string;
  refCode?: string;
  address?: string;
  deposit?: { amount_usd?: unknown; ref_code?: string; usdt_network?: string };
  fetchImpl?: typeof fetch;
  token?: string;
  chatId?: string;
} = {}) {
  const deposit = input.deposit || {};
  const lines = [
    '🔔 *Deposit request*',
    '',
    `👤 User: ${who(input.user)}`,
    `💰 Amount: $${money(input.amountUsdt ?? deposit.amount_usd)} USDT`,
  ];
  if (input.feeUsdt != null) lines.push(`💸 Fee: $${money(input.feeUsdt)}`);
  if (input.netUsdt != null) lines.push(`✅ Net: $${money(input.netUsdt)}`);
  lines.push(`🌐 Network: ${input.network || deposit.usdt_network || 'TRC20'}`);
  lines.push(`🔖 Ref: \`${input.refCode || deposit.ref_code || 'N/A'}\``);
  if (input.address) lines.push(`📍 Address: \`${input.address}\``);
  const result = await sendAdminMessage(lines.join('\n'), input);
  console.log('[Telegram] Deposit request notification', input.refCode || deposit.ref_code || '');
  return result;
}

async function notifyAdminCardCreated(input: {
  user?: Person | null;
  card?: {
    last_four?: string;
    last4?: string;
    product_code?: string;
    pago_card_id?: string;
    id?: number | string;
  };
  productCode?: string;
  pricing?: {
    card_issuance_fee_usd?: unknown;
    initial_load_usd?: unknown;
  };
  debitedUsdt?: unknown;
  fetchImpl?: typeof fetch;
  token?: string;
  chatId?: string;
} = {}) {
  const card = input.card || {};
  const pricing = input.pricing || {};
  const last4 = card.last_four || card.last4 || '';
  const lines = [
    '💳 *Card created*',
    '',
    `👤 User: ${who(input.user)}`,
    `💳 Card: ${last4 ? `•••• ${last4}` : (card.pago_card_id || card.id || 'new card')}`,
    `🏷 Product: ${card.product_code || input.productCode || 'us_404_visa_bin'}`,
  ];
  if (pricing.card_issuance_fee_usd != null) {
    lines.push(`💵 Issuing fee: $${money(pricing.card_issuance_fee_usd)}`);
  }
  if (pricing.initial_load_usd != null) {
    lines.push(`💰 Starting balance: $${money(pricing.initial_load_usd)}`);
  }
  lines.push(`🏦 Debited: $${money(input.debitedUsdt)} USDT`);
  const result = await sendAdminMessage(lines.join('\n'), input);
  console.log('[Telegram] Card created notification', last4 || card.id || '');
  return result;
}

async function notifyAdminWithdrawalRequest(input: {
  user?: Person | null;
  kind?: string;
  currency?: string;
  network?: string;
  amountUsdt?: unknown;
  feeUsdt?: unknown;
  netUsdt?: unknown;
  amountMmk?: unknown;
  feeMmk?: unknown;
  netMmk?: unknown;
  destination?: string;
  refCode?: string;
  status?: string;
  withdrawal?: {
    payout_method?: string;
    network?: string;
    wallet_address?: string;
    bank_name?: string;
    account_number?: string;
    amount_usdt?: unknown;
    fee_usdt?: unknown;
    net_usdt?: unknown;
    amount_mmk?: unknown;
    fee_mmk?: unknown;
    net_mmk?: unknown;
    ref_code?: string;
    status?: string;
  };
  fetchImpl?: typeof fetch;
  token?: string;
  chatId?: string;
} = {}) {
  const withdrawal = input.withdrawal || {};
  const kind = input.kind || withdrawal.payout_method || 'USDT';
  const network = input.network || withdrawal.network || '';
  const mmk = input.currency === 'MMK' || kind === 'MMK';
  const destination = input.destination
    || withdrawal.wallet_address
    || [withdrawal.bank_name, withdrawal.account_number].filter(Boolean).join(' ')
    || 'N/A';
  const lines = [
    '💸 *Withdrawal request*',
    '',
    `👤 User: ${who(input.user)}`,
    `🔀 Type: ${kind}${network ? ` ${network}` : ''}`,
    mmk
      ? `💰 Amount: ${whole(input.amountMmk ?? withdrawal.amount_mmk)} MMK`
      : `💰 Amount: $${money(input.amountUsdt ?? withdrawal.amount_usdt)} USDT`,
    mmk
      ? `💸 Fee: ${whole(input.feeMmk ?? withdrawal.fee_mmk)} MMK`
      : `💸 Fee: $${money(input.feeUsdt ?? withdrawal.fee_usdt)}`,
    mmk
      ? `✅ Net: ${whole(input.netMmk ?? withdrawal.net_mmk)} MMK`
      : `✅ Net: $${money(input.netUsdt ?? withdrawal.net_usdt)}`,
    `📍 To: \`${destination}\``,
    `🔖 Ref: \`${input.refCode || withdrawal.ref_code || 'N/A'}\``,
    `📌 Status: ${input.status || withdrawal.status || 'pending'}`,
  ];
  const result = await sendAdminMessage(lines.join('\n'), input);
  console.log('[Telegram] Withdrawal request notification', input.refCode || withdrawal.ref_code || '');
  return result;
}

module.exports = {
  sendAdminMessage,
  notifyAdminDepositRequest,
  notifyAdminCardCreated,
  notifyAdminWithdrawalRequest,
  readToken,
  readChatId,
};
