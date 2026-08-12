const API = '';

let pollTimer = null;
let currentRefCode = null;

const $ = (id) => document.getElementById(id);

function getUserId() {
  return parseInt($('globalUserId').value, 10) || 1;
}

function log(message, type = 'info') {
  const el = $('activityLog');
  const time = new Date().toLocaleTimeString();
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.innerHTML = `
    <span class="log-time">${time}</span>
    <span class="log-msg ${type === 'error' ? 'log-err' : type === 'ok' ? 'log-ok' : ''}">${message}</span>
  `;
  el.prepend(entry);
}

function showOutput(elId, data, isError = false) {
  const el = $(elId);
  el.textContent = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  el.style.color = isError ? 'var(--error)' : 'var(--muted)';
}

async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`${API}${path}`, opts);
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

async function loadUserSummary() {
  const userId = getUserId();
  try {
    const { user } = await api('GET', `/api/user/${userId}`);
    $('sumName').textContent = user.name;
    $('sumPhone').textContent = user.phone;
    $('sumBalance').textContent = `$${Number(user.balance).toFixed(2)}`;

    try {
      const cardRes = await api('GET', `/api/user/card/${userId}`);
      const masked = cardRes.card.card_number.replace(/\d(?=\d{4})/g, '*');
      $('sumCard').textContent = masked;
    } catch {
      $('sumCard').textContent = 'No card issued';
    }

    log(`Loaded user #${userId} — balance $${Number(user.balance).toFixed(2)}`, 'ok');
  } catch (err) {
    $('sumName').textContent = '—';
    $('sumPhone').textContent = '—';
    $('sumBalance').textContent = '—';
    $('sumCard').textContent = '—';
    log(`User #${userId}: ${err.message}`, 'error');
  }
}

async function loadCardDetails() {
  const userId = getUserId();
  try {
    const data = await api('GET', `/api/user/card/${userId}`);
    const { card } = data;

    $('cardVisual').classList.remove('hidden');
    $('visNumber').textContent = card.card_number;
    $('visHolder').textContent = card.card_holder_name;
    $('visExp').textContent = card.exp_date;
    $('visCvv').textContent = card.cvv;

    showOutput('viewCardOutput', data);
    log(`Loaded card for user #${userId}`, 'ok');
  } catch (err) {
    $('cardVisual').classList.add('hidden');
    showOutput('viewCardOutput', err.message, true);
    log(`Card load failed: ${err.message}`, 'error');
  }
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function startPolling(refCode) {
  stopPolling();
  currentRefCode = refCode;
  const statusEl = $('depositStatus');
  statusEl.textContent = 'Waiting for Payment Verification…';
  statusEl.className = 'status-line';

  pollTimer = setInterval(async () => {
    try {
      const { deposit } = await api('GET', `/api/deposit/status/${refCode}`);
      if (deposit.status === 'VERIFIED') {
        stopPolling();
        statusEl.textContent = 'Payment Verified!';
        statusEl.className = 'status-line verified';
        log(`Deposit ${refCode} verified`, 'ok');
        loadUserSummary();
      } else if (deposit.status === 'FAILED') {
        stopPolling();
        statusEl.textContent = 'Verification Failed';
        statusEl.className = 'status-line failed';
        log(`Deposit ${refCode} failed`, 'error');
      }
    } catch {
      /* keep polling */
    }
  }, 3000);
}

// --- Event listeners ---

$('btnRefreshUser').addEventListener('click', loadUserSummary);

$('issueCardForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const userId = getUserId();
  try {
    const data = await api('POST', '/api/admin/issue-card', {
      user_id: userId,
      card_number: $('cardNumber').value.trim(),
      exp_date: $('expDate').value.trim(),
      cvv: $('cvv').value.trim(),
      card_holder_name: $('holderName').value.trim() || undefined,
    });
    showOutput('issueCardOutput', data);
    log(`Card issued for user #${userId}`, 'ok');
    loadUserSummary();
    loadCardDetails();
  } catch (err) {
    showOutput('issueCardOutput', err.message, true);
    log(`Issue card failed: ${err.message}`, 'error');
  }
});

$('btnLoadCard').addEventListener('click', loadCardDetails);

$('depositForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const userId = getUserId();
  try {
    const data = await api('POST', '/api/deposit/request', {
      user_id: userId,
      amount_mmk: parseFloat($('amountMmk').value),
      payment_method: $('paymentMethod').value,
    });

    const ref = data.deposit.ref_code;
    $('refCodeBox').classList.remove('hidden');
    $('refCodeDisplay').textContent = ref;
    $('verifyRef').value = ref;
    $('verifyAmount').value = data.deposit.amount_mmk;

    showOutput('depositOutput', data);
    log(`Deposit requested: ${ref} (${data.deposit.amount_mmk} MMK)`, 'ok');
    startPolling(ref);
  } catch (err) {
    showOutput('depositOutput', err.message, true);
    log(`Deposit request failed: ${err.message}`, 'error');
  }
});

$('btnCopyRef').addEventListener('click', () => {
  const ref = $('refCodeDisplay').textContent;
  navigator.clipboard.writeText(ref).then(() => {
    log(`Copied ref code: ${ref}`, 'ok');
  });
});

$('verifyForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const secret = localStorage.getItem('deposit_listener_secret');
    const adminKey = localStorage.getItem('adminKey') || localStorage.getItem('admin_api_key');
    const opts = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(secret ? { 'X-Deposit-Listener-Secret': secret } : {}),
        ...(!secret && adminKey ? { 'X-Admin-Key': adminKey } : {}),
      },
      body: JSON.stringify({
        ref_code: $('verifyRef').value.trim(),
        amount: parseFloat($('verifyAmount').value),
        txn_id: $('verifyTxn').value.trim() || undefined,
        sender_phone: $('verifyPhone').value.trim() || undefined,
      }),
    };
    const res = await fetch(`${API}/api/deposit/verify`, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    showOutput('verifyOutput', data);
    log(`Verified ${data.deposit.ref_code} — new balance $${Number(data.user.balance).toFixed(2)}`, 'ok');

    if (currentRefCode === data.deposit.ref_code) {
      stopPolling();
      const statusEl = $('depositStatus');
      statusEl.textContent = 'Payment Verified!';
      statusEl.className = 'status-line verified';
    }

    loadUserSummary();
  } catch (err) {
    showOutput('verifyOutput', err.message, true);
    log(`Verify failed: ${err.message}`, 'error');
  }
});

// Initial load
loadUserSummary();
log('Dashboard ready — API at same origin');
