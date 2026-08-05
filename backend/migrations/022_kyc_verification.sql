-- KYC identity verification for P2P trading

ALTER TABLE users ADD COLUMN kyc_status TEXT NOT NULL DEFAULT 'UNVERIFIED';

CREATE TABLE IF NOT EXISTS kyc_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  full_name TEXT NOT NULL,
  id_type TEXT NOT NULL CHECK(id_type IN ('NRC', 'Passport')),
  id_number TEXT NOT NULL,
  front_photo_path TEXT NOT NULL,
  back_photo_path TEXT NOT NULL,
  selfie_photo_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING_REVIEW' CHECK(status IN ('PENDING_REVIEW', 'VERIFIED', 'REJECTED')),
  rejection_reason TEXT,
  reviewed_by TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_kyc_submissions_user ON kyc_submissions(user_id);
CREATE INDEX IF NOT EXISTS idx_kyc_submissions_status ON kyc_submissions(status);
