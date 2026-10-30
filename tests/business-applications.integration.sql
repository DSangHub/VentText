BEGIN;
DO $test$
DECLARE u1 UUID:=gen_random_uuid(); u2 UUID:=gen_random_uuid(); u3 UUID:=gen_random_uuid(); m1 UUID; old_m UUID; c UUID; p JSONB;
BEGIN
  IF has_function_privilege('venttext_app','venttext.review_business_application(uuid,boolean,text,uuid)','EXECUTE')
    OR has_function_privilege('authenticated','venttext.review_business_application(uuid,boolean,text,uuid)','EXECUTE')
    OR has_function_privilege('anon','venttext.review_business_application(uuid,boolean,text,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'TEST: approval is exposed to an untrusted role';
  END IF;
  INSERT INTO auth.users(id,email,email_confirmed_at,aud,role)
    VALUES(u1,'qa-'||u1||'@example.invalid',now(),'authenticated','authenticated'),
          (u2,'qa-'||u2||'@example.invalid',now(),'authenticated','authenticated'),
          (u3,'qa-'||u3||'@example.invalid',NULL,'authenticated','authenticated');
  p:=jsonb_build_object('name','Unlisted QA Business','address','123 Main St','contactPerson','QA',
    'phone','+15595550100','website','https://example.com','email','qa-'||u1||'@example.invalid');
  INSERT INTO venttext.business_applications(user_id,profile,phone) VALUES(u1,p,'+15595550100');
  BEGIN
    PERFORM venttext.review_business_application(u1,true,'QA evidence checked');
    RAISE EXCEPTION 'TEST: unverified draft approved';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'TEST:%' THEN RAISE; END IF;
  END;
  UPDATE venttext.business_applications SET status='REVIEW_PENDING',phone_verified_at=now(),submitted_at=now() WHERE user_id=u1;
  m1:=venttext.review_business_application(u1,true,'QA website and registration checked');
  IF NOT EXISTS(SELECT 1 FROM venttext.merchants WHERE id=m1 AND owner_auth_user_id=u1 AND status='CLAIMED' AND google_place_id IS NULL)
    OR NOT EXISTS(SELECT 1 FROM venttext.business_applications WHERE user_id=u1 AND status='APPROVED' AND merchant_id=m1 AND reviewed_by='postgres') THEN
    RAISE EXCEPTION 'TEST: manual approval did not attach the verified applicant';
  END IF;
  INSERT INTO venttext.business_applications(user_id,profile,phone,status,phone_verified_at,submitted_at)
    VALUES(u2,jsonb_set(p,'{email}',to_jsonb('qa-'||u2||'@example.invalid')),'+15595550100','REVIEW_PENDING',now(),now());
  BEGIN
    PERFORM venttext.review_business_application(u2,true,'QA must not transfer an owned merchant',m1);
    RAISE EXCEPTION 'TEST: another owner was replaced';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'TEST:%' THEN RAISE; END IF;
  END;
  IF NOT EXISTS(SELECT 1 FROM venttext.merchants WHERE id=m1 AND owner_auth_user_id=u1) THEN RAISE EXCEPTION 'TEST: ownership changed after rejection'; END IF;
  INSERT INTO venttext.merchants(name,merchant_code,status) VALUES('QA unclaimed','VT'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,16)),'UNCLAIMED') RETURNING id INTO old_m;
  INSERT INTO venttext.conversations(merchant_id,status) VALUES(old_m,'NEW') RETURNING id INTO c;
  PERFORM venttext.review_business_application(u2,true,'QA evidence matched to unclaimed location',old_m);
  IF NOT EXISTS(SELECT 1 FROM venttext.merchants WHERE id=old_m AND owner_auth_user_id=u2 AND status='CLAIMED')
    OR NOT EXISTS(SELECT 1 FROM venttext.conversations WHERE id=c AND merchant_id=old_m) THEN
    RAISE EXCEPTION 'TEST: existing complaint association was not preserved';
  END IF;
  INSERT INTO venttext.business_applications(user_id,profile,phone,status,phone_verified_at,submitted_at)
    VALUES(u3,jsonb_set(p,'{email}',to_jsonb('qa-'||u3||'@example.invalid')),'+15595550100','REVIEW_PENDING',now(),now());
  BEGIN
    PERFORM venttext.review_business_application(u3,true,'QA unconfirmed email must not approve');
    RAISE EXCEPTION 'TEST: unconfirmed account approved';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'TEST:%' THEN RAISE; END IF;
  END;
  PERFORM venttext.review_business_application(u3,false,'QA registration evidence could not be verified');
  IF NOT EXISTS(SELECT 1 FROM venttext.business_applications WHERE user_id=u3 AND status='REJECTED' AND review_note LIKE 'QA registration%') THEN RAISE EXCEPTION 'TEST: review rejection not saved'; END IF;
END $test$;
ROLLBACK;
