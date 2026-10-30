CREATE TABLE venttext.business_applications (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  profile JSONB NOT NULL,
  phone TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PHONE_VERIFIED','REVIEW_PENDING','APPROVED','REJECTED')),
  code_hash TEXT,
  code_salt TEXT,
  expires_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  phone_verified_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  reviewed_at TIMESTAMPTZ,
  reviewed_by TEXT,
  review_note TEXT,
  merchant_id UUID REFERENCES venttext.merchants(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status IN ('DRAFT','REJECTED') OR phone_verified_at IS NOT NULL)
);
CREATE INDEX idx_business_applications_review ON venttext.business_applications(submitted_at) WHERE status='REVIEW_PENDING';
ALTER TABLE venttext.business_applications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON venttext.business_applications FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON venttext.business_applications TO venttext_app;
CREATE POLICY business_applications_backend ON venttext.business_applications
  FOR ALL TO venttext_app USING (true) WITH CHECK (true);

-- Trusted reviewers use the SQL editor; this is never a browser or app-login API.
-- SECURITY INVOKER retains the caller's existing privileges; no privilege escalation.
CREATE FUNCTION venttext.review_business_application(
  p_user_id UUID, p_approve BOOLEAN, p_review_note TEXT, p_existing_merchant_id UUID DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog,venttext
AS $$
DECLARE
  application venttext.business_applications%ROWTYPE;
  account_email TEXT;
  result_id UUID;
BEGIN
  IF p_approve IS NULL OR length(btrim(coalesce(p_review_note,''))) < 10 OR length(p_review_note)>2000 THEN
    RAISE EXCEPTION 'Provide a decision and a review note of 10 to 2000 characters';
  END IF;
  SELECT * INTO application FROM venttext.business_applications WHERE user_id=p_user_id FOR UPDATE;
  IF NOT FOUND OR application.status <> 'REVIEW_PENDING' OR application.phone_verified_at IS NULL THEN
    RAISE EXCEPTION 'Only a phone-verified application submitted for review can be decided';
  END IF;
  IF NOT p_approve THEN
    UPDATE venttext.business_applications SET status='REJECTED',reviewed_at=now(),reviewed_by=current_user,
      review_note=btrim(p_review_note),updated_at=now() WHERE user_id=p_user_id;
    RETURN NULL;
  END IF;
  SELECT email INTO account_email FROM auth.users WHERE id=p_user_id AND email_confirmed_at IS NOT NULL;
  IF account_email IS NULL OR account_email IS DISTINCT FROM application.profile->>'email' THEN
    RAISE EXCEPTION 'The current email must be confirmed and match the submitted profile';
  END IF;
  IF nullif(btrim(coalesce(application.profile->>'website','')),'') IS NULL AND
     nullif(btrim(coalesce(application.profile->>'registration','')),'') IS NULL THEN
    RAISE EXCEPTION 'Business website or registration evidence is required';
  END IF;
  IF application.phone IS DISTINCT FROM application.profile->>'phone' THEN
    RAISE EXCEPTION 'The verified phone must match the submitted profile';
  END IF;
  IF EXISTS(SELECT 1 FROM venttext.merchants WHERE owner_auth_user_id=p_user_id) THEN
    RAISE EXCEPTION 'This account already owns a business';
  END IF;
  IF p_existing_merchant_id IS NOT NULL THEN
    -- Only an operator who verified the evidence can link an unclaimed inbox.
    UPDATE venttext.merchants SET name=application.profile->>'name',address=application.profile->>'address',
      contact_person=application.profile->>'contactPerson',phone=application.phone,email=account_email,
      owner_auth_user_id=p_user_id,status='CLAIMED'
      WHERE id=p_existing_merchant_id AND owner_auth_user_id IS NULL AND status <> 'CLAIMED'
      RETURNING id INTO result_id;
    IF result_id IS NULL THEN RAISE EXCEPTION 'Target business does not exist or already has an owner'; END IF;
  ELSE
    INSERT INTO venttext.merchants(name,address,contact_person,phone,email,merchant_code,status,owner_auth_user_id)
      VALUES(application.profile->>'name',application.profile->>'address',application.profile->>'contactPerson',
        application.phone,account_email,'VT'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,16)),'CLAIMED',p_user_id)
      RETURNING id INTO result_id;
  END IF;
  UPDATE venttext.business_applications SET status='APPROVED',merchant_id=result_id,reviewed_at=now(),
    reviewed_by=current_user,review_note=btrim(p_review_note),code_hash=NULL,code_salt=NULL,expires_at=NULL,updated_at=now()
    WHERE user_id=p_user_id;
  RETURN result_id;
END;
$$;
REVOKE ALL ON FUNCTION venttext.review_business_application(UUID,BOOLEAN,TEXT,UUID) FROM PUBLIC,anon,authenticated,service_role,venttext_app;
GRANT EXECUTE ON FUNCTION venttext.review_business_application(UUID,BOOLEAN,TEXT,UUID) TO postgres;
