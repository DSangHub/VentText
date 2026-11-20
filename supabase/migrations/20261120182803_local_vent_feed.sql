-- A complaint is private unless the sender explicitly texts POST <thread id>.
-- The public endpoint selects only these reviewed-by-rule fields, never SMS
-- messages, phone numbers or receipt media.
ALTER TABLE venttext.conversations
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS zip_code TEXT,
  ADD COLUMN IF NOT EXISTS public_consent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS public_excerpt TEXT;

CREATE INDEX IF NOT EXISTS conversations_public_zip_feed
  ON venttext.conversations(zip_code, public_consent_at DESC)
  WHERE public_consent_at IS NOT NULL;
