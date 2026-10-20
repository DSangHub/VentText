-- Supabase Auth owns passwords and sessions. These tables remain server-only.
ALTER TABLE venttext.merchants ADD COLUMN IF NOT EXISTS owner_auth_user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE TABLE IF NOT EXISTS venttext.business_claims (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  profile JSONB NOT NULL,
  google_place_id TEXT NOT NULL,
  phone TEXT NOT NULL,
  code_hash TEXT,
  code_salt TEXT,
  expires_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS venttext.business_verification_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_business_verification_time ON venttext.business_verification_requests(created_at);
ALTER TABLE venttext.business_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE venttext.business_verification_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON venttext.business_claims, venttext.business_verification_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON venttext.business_claims TO venttext_app;
GRANT SELECT, INSERT, DELETE ON venttext.business_verification_requests TO venttext_app;
