-- Full schema reference (final state after all migrations)
-- Generated for documentation / fresh PostgreSQL porting — not executed by runner

-- ─── USERS & AUTH ───────────────────────────────────────────────
-- users: id, name, phone, email, email_verified, pin_hash, pin_set_at,
--        biometrics_token_hash, biometrics_enabled, biometrics_registered_at,
--        balance, auth_status, last_login_at, created_at, updated_at

-- otp_codes: id, user_id, email, otp_code, purpose, expires_at, verified_at,
--            attempts, max_attempts, ip_address, created_at

-- user_sessions: id, user_id, session_token_hash, device_name, device_platform,
--                ip_address, expires_at, revoked_at, created_at, last_seen_at

-- ─── CARDS ──────────────────────────────────────────────────────
-- cards_v2: id, user_id, card_number, exp_date, cvv, card_holder_name,
--           card_type, currency, status, is_primary, issued_by_admin_id,
--           admin_notes, daily_limit_usd, metadata, activated_at, cancelled_at,
--           created_at, updated_at

-- ─── DEPOSITS ───────────────────────────────────────────────────
-- deposit_requests_v2: id, user_id, amount_mmk, amount_usd, ref_code,
--   payment_method, kpay_transaction_id, txn_id, screenshot_path,
--   screenshot_original_name, screenshot_mime_type, status, user_note,
--   admin_note, rejection_reason, reviewed_by_admin_id, submitted_at,
--   reviewed_at, verified_at, expires_at, created_at, updated_at

-- ─── SUPPORT ────────────────────────────────────────────────────
-- support_threads: id, user_id, subject, category, status, priority,
--                  assigned_admin_id, last_message_at, last_message_preview,
--                  unread_by_user, unread_by_admin, created_at, updated_at, closed_at

-- support_messages: id, thread_id, sender_type, sender_id, message,
--                   attachment_path, attachment_original_name, attachment_mime_type,
--                   read_by_user_at, read_by_admin_at, created_at

-- ─── AUDIT ──────────────────────────────────────────────────────
-- transaction_logs: id, user_id, type, direction, amount_usd, amount_mmk,
--                   balance_before, balance_after, reference_type, reference_id,
--                   description, metadata, ip_address, created_by, created_at

-- ─── LEGACY (kept for backward compatibility) ───────────────────
-- cards, deposit_requests
