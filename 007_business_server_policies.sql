-- RLS blocks all browser roles; only the existing private backend login can
-- access claim challenges. End-user ownership is checked by the API.
CREATE POLICY business_claims_backend ON venttext.business_claims
  FOR ALL TO venttext_app USING (true) WITH CHECK (true);
CREATE POLICY business_verification_backend ON venttext.business_verification_requests
  FOR ALL TO venttext_app USING (true) WITH CHECK (true);
