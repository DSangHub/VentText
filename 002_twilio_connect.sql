-- Migration 002 — Twilio texting connect
-- Run this against an EXISTING VentText database that already has schema.sql applied.
-- Safe to run more than once (guards with IF NOT EXISTS).

-- Merchant dashboard API key (Bearer token used by /api/merchant/* endpoints).
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS api_key TEXT UNIQUE;

-- Helpful indexes for auth lookups and the inbound routing query.
CREATE INDEX IF NOT EXISTS idx_merchants_api_key ON merchants(api_key);
CREATE INDEX IF NOT EXISTS idx_conversations_open ON conversations(customer_id, merchant_id, status);

-- ---------------------------------------------------------------------------
-- Seed a demo merchant so you can log into the dashboard immediately.
-- Change the code/key, or delete this block, before production.
-- Log in at /dashboard.html with the api_key below.
-- ---------------------------------------------------------------------------
INSERT INTO merchants (name, merchant_code, api_key, status)
VALUES ('Demo Pizzeria', 'MARIO123', 'vt_live_demo_change_me', 'CLAIMED')
ON CONFLICT (merchant_code) DO UPDATE
  SET api_key = EXCLUDED.api_key,
      status  = 'CLAIMED';
