-- Migration 002 — Twilio texting connect
-- Run against an existing VentText schema. No production login is seeded.
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS api_key TEXT UNIQUE;
CREATE INDEX IF NOT EXISTS idx_merchants_api_key ON merchants(api_key);
CREATE INDEX IF NOT EXISTS idx_conversations_open ON conversations(customer_id, merchant_id, status);

-- Remove the previously documented demo credential if an older seed was used.
UPDATE merchants SET api_key=NULL WHERE api_key='vt_live_demo_change_me';
-- Verify each business and issue a distinct random key out of band.
