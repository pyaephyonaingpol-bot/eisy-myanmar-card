-- Optional Supabase mirror for USDT → MMK (bank) withdrawal requests.
-- Admin review remains available in the app admin portal (LibSQL/Turso).
-- Apply in Supabase SQL editor when dual-write is desired.

create table if not exists public.usdt_bank_withdrawals (
  id text primary key,
  user_id text not null,
  user_email text,
  user_name text,
  ref_code text,
  payout_method text default 'bank',
  amount_usdt numeric,
  fee_usdt numeric,
  net_usdt numeric,
  exchange_rate numeric,
  amount_mmk numeric,
  bank_name text,
  account_name text,
  account_number text,
  status text default 'pending',
  admin_note text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists usdt_bank_withdrawals_status_idx
  on public.usdt_bank_withdrawals (status, created_at desc);

create index if not exists usdt_bank_withdrawals_user_idx
  on public.usdt_bank_withdrawals (user_id);
