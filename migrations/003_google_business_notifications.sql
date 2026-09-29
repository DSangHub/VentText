-- Apply to the private VentText schema before deploying the matching code.
ALTER TABLE venttext.merchants
  ADD COLUMN IF NOT EXISTS google_place_id TEXT,
  ADD COLUMN IF NOT EXISTS sms_consent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sms_consent_source TEXT,
  ADD COLUMN IF NOT EXISTS sms_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sms_opted_out_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS notice_sent_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS merchants_google_place_id_key
  ON venttext.merchants (google_place_id);
