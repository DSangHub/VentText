-- VentText backend schema
-- Designed for Postgres (Vercel Postgres, Supabase, or Neon all work identically)

CREATE TABLE merchants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  phone TEXT,                          -- merchant's own contact number, used for claim verification
  email TEXT,
  merchant_code TEXT UNIQUE NOT NULL,  -- short code embedded in QR/deep link, e.g. "MARIO123"
  api_key TEXT UNIQUE,                 -- dashboard auth secret, issued at claim time (Bearer token)
  status TEXT NOT NULL DEFAULT 'UNCLAIMED', -- UNCLAIMED | PENDING | CLAIMED
  coupon_ceiling_cents INTEGER DEFAULT 1000, -- max auto-issued coupon value, e.g. $10.00
  monthly_cap_cents INTEGER DEFAULT 15000,   -- total auto-issued exposure per month
  response_window_hours INTEGER DEFAULT 48,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT UNIQUE NOT NULL,
  name TEXT,
  verified BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID REFERENCES merchants(id),
  customer_id UUID REFERENCES customers(id),
  status TEXT NOT NULL DEFAULT 'NEW', -- NEW | AWAITING_MERCHANT | RESOLVED | ESCALATED
  severity_score INTEGER,             -- from sentiment/severity pipeline
  receipt_verified BOOLEAN DEFAULT false,
  receipt_source TEXT,                -- 'reseats' | 'photo' | 'manual' | null
  coupon_issued_cents INTEGER,
  coupon_code TEXT,
  response_deadline TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id),
  direction TEXT NOT NULL,   -- 'inbound' | 'outbound'
  sender TEXT NOT NULL,      -- 'customer' | 'merchant' | 'system'
  body TEXT,
  media_url TEXT,
  twilio_sid TEXT,
  status TEXT,               -- delivery status from Twilio callback
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_conversations_merchant ON conversations(merchant_id);
CREATE INDEX idx_conversations_customer ON conversations(customer_id);
CREATE INDEX idx_messages_conversation ON messages(conversation_id);
CREATE INDEX idx_customers_phone ON customers(phone);
CREATE INDEX idx_merchants_code ON merchants(merchant_code);
CREATE INDEX idx_merchants_api_key ON merchants(api_key);
CREATE INDEX idx_conversations_open ON conversations(customer_id, merchant_id, status);
