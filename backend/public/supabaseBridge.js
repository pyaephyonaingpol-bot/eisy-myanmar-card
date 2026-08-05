/**
 * Browser Supabase bridge — reads config from /api/config/supabase,
 * fetches synced state, and subscribes to Realtime updates.
 */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SupabaseBridge = {
  client: null,
  enabled: false,
  _initPromise: null,
  _channels: [],

  async init() {
    if (this._initPromise) return this._initPromise;
    this._initPromise = (async () => {
      try {
        const res = await fetch('/api/config/supabase');
        const cfg = await res.json();
        if (!cfg.enabled || !cfg.url || !cfg.anonKey) {
          console.info('[SupabaseBridge] Disabled — check .env.local credentials');
          this.enabled = false;
          return false;
        }
        this.client = createClient(cfg.url, cfg.anonKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        this.enabled = true;
        console.info('[SupabaseBridge] Connected');
        return true;
      } catch (err) {
        console.warn('[SupabaseBridge] Init failed:', err.message);
        this.enabled = false;
        return false;
      }
    })();
    return this._initPromise;
  },

  isReady() {
    return this.enabled && Boolean(this.client);
  },

  async fetchUserWallet(userId) {
    if (!this.isReady() || !userId) return null;
    const { data, error } = await this.client
      .from('user_wallets')
      .select('*')
      .eq('user_id', String(userId))
      .maybeSingle();
    if (error) {
      console.warn('[SupabaseBridge] fetchUserWallet:', error.message);
      return null;
    }
    return data;
  },

  async fetchUserDeposits(userId, limit = 50) {
    if (!this.isReady() || !userId) return [];
    const { data, error } = await this.client
      .from('deposit_requests')
      .select('*')
      .eq('user_id', String(userId))
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) {
      console.warn('[SupabaseBridge] fetchUserDeposits:', error.message);
      return [];
    }
    return (data || []).map((row) => this.mapDepositRow(row));
  },

  async fetchUserReloads(userId, limit = 50) {
    if (!this.isReady() || !userId) return [];
    const { data, error } = await this.client
      .from('card_reload_requests')
      .select('*')
      .eq('user_id', String(userId))
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) {
      console.warn('[SupabaseBridge] fetchUserReloads:', error.message);
      return [];
    }
    return (data || []).map((row) => this.mapReloadRow(row));
  },

  async fetchUserCardApplications(userId, limit = 20) {
    if (!this.isReady() || !userId) return [];
    const { data, error } = await this.client
      .from('card_applications')
      .select('*')
      .eq('user_id', String(userId))
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) {
      console.warn('[SupabaseBridge] fetchUserCardApplications:', error.message);
      return [];
    }
    return data || [];
  },

  async fetchAdminDeposits({ status, limit = 100 } = {}) {
    if (!this.isReady()) return null;
    let query = this.client.from('deposit_requests').select('*').order('created_at', { ascending: false }).limit(limit);
    if (status && status !== 'all' && status !== 'pending') {
      query = query.eq('status', status);
    } else if (status === 'pending') {
      query = query.in('status', ['SUBMITTED', 'UNDER_REVIEW', 'PENDING']);
    }
    const { data, error } = await query;
    if (error) {
      console.warn('[SupabaseBridge] fetchAdminDeposits:', error.message);
      return null;
    }
    return (data || []).map((row) => this.mapDepositRow(row, true));
  },

  async fetchAdminPendingCards(limit = 100) {
    if (!this.isReady()) return null;
    const { data, error } = await this.client
      .from('card_applications')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(limit);
    if (error) {
      console.warn('[SupabaseBridge] fetchAdminPendingCards:', error.message);
      return null;
    }
    return (data || []).map((row) => this.mapCardApplicationRow(row));
  },

  async fetchAdminPendingReloads(limit = 100) {
    if (!this.isReady()) return null;
    const { data, error } = await this.client
      .from('card_reload_requests')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(limit);
    if (error) {
      console.warn('[SupabaseBridge] fetchAdminPendingReloads:', error.message);
      return null;
    }
    return (data || []).map((row) => this.mapReloadRow(row, true));
  },

  mapDepositRow(row, admin = false) {
    if (!row) return null;
    const base = {
      id: row.id,
      user_id: row.user_id,
      amount_mmk: Number(row.amount_mmk ?? 0),
      amount_usd: Number(row.amount_usd ?? 0),
      ref_code: row.ref_code,
      payment_method: row.payment_method,
      deposit_currency: row.deposit_currency,
      status: row.status,
      purpose: row.purpose,
      metadata: row.metadata || {},
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
    if (admin) {
      base.name = row.user_name;
      base.email = row.user_email;
    }
    return base;
  },

  mapReloadRow(row, admin = false) {
    if (!row) return null;
    const pricing = row.pricing || {};
    const mapped = {
      id: row.id,
      user_id: row.user_id,
      card_id: row.card_id,
      wallet_type: row.wallet_type,
      amount_mmk: row.amount_mmk,
      amount_usdt: row.amount_usdt,
      net_usd_to_card: row.net_usd_to_card,
      status: row.status,
      pricing,
      pricing_json: pricing,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
    if (admin) {
      mapped.user_name = row.user_name;
      mapped.user_email = row.user_email;
      mapped.top_up_amount_usd = row.net_usd_to_card;
      mapped.fee_profit_usd = pricing?.net_profit_usd ?? pricing?.reload_fee_usd ?? null;
      mapped.reload_fee_usd = pricing?.reload_fee_usd ?? null;
      mapped.card_last4 = row.metadata?.card_last4 || '????';
      mapped.wallet_deducted_display = row.wallet_type === 'usdt'
        ? `$${Number(row.amount_usdt || 0).toFixed(2)} USDT`
        : `${Number(row.amount_mmk || 0).toLocaleString()} MMK`;
    }
    return mapped;
  },

  mapCardApplicationRow(row) {
    if (!row) return null;
    return {
      id: row.id,
      user_id: row.user_id,
      name: row.user_name,
      email: row.user_email,
      card_holder_name: row.card_holder_name,
      status: row.status,
      display_status: row.display_status || 'PENDING_ISSUANCE',
      issuance_status: row.display_status || 'PENDING_ISSUANCE',
      pricing: row.pricing || {},
      metadata: row.metadata || {},
      deposit_id: row.deposit_id,
      created_at: row.created_at,
    };
  },

  walletToApiShape(row) {
    if (!row) return null;
    return {
      balance_mmk: Number(row.balance_mmk ?? 0),
      balance_usdt: Number(row.balance_usdt ?? 0),
      mmk_formatted: `Ks ${Math.round(Number(row.balance_mmk ?? 0)).toLocaleString()} MMK`,
      usdt_formatted: `$ ${Number(row.balance_usdt ?? 0).toFixed(2)} USDT`,
    };
  },

  subscribeUser(userId, handlers = {}) {
    if (!this.isReady() || !userId) return null;
    const uid = String(userId);
    const channel = this.client
      .channel(`user-${uid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_wallets', filter: `user_id=eq.${uid}` }, (payload) => {
        handlers.onWallet?.(payload.new);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deposit_requests', filter: `user_id=eq.${uid}` }, () => {
        handlers.onDeposits?.();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'card_reload_requests', filter: `user_id=eq.${uid}` }, () => {
        handlers.onReloads?.();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'card_applications', filter: `user_id=eq.${uid}` }, () => {
        handlers.onCards?.();
      })
      .subscribe();
    this._channels.push(channel);
    return channel;
  },

  subscribeAdmin(handlers = {}) {
    if (!this.isReady()) return null;
    const channel = this.client
      .channel('admin-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deposit_requests' }, () => {
        handlers.onDeposits?.();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'card_applications' }, () => {
        handlers.onCards?.();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'card_reload_requests' }, () => {
        handlers.onReloads?.();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_wallets' }, () => {
        handlers.onWallets?.();
      })
      .subscribe();
    this._channels.push(channel);
    return channel;
  },

  unsubscribeAll() {
    this._channels.forEach((ch) => {
      try { this.client?.removeChannel(ch); } catch (_) { /* ignore */ }
    });
    this._channels = [];
  },
};

window.SupabaseBridge = SupabaseBridge;
await SupabaseBridge.init();

export default SupabaseBridge;
