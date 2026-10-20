import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

export function phoneNumber(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return /^1?\d{10}$/.test(digits) ? '+1' + digits.slice(-10) : null;
}
export function businessProfile(body, email) {
  const { name, address, contactPerson, phone, channel, consent, smsConsent, smsPhone } = body || {};
  if ([name,address,contactPerson].some(v => typeof v !== 'string' || !v.trim()) ||
      name.length > 120 || address.length > 160 || contactPerson.length > 120 ||
      !phoneNumber(phone) || !['sms','voice'].includes(channel) || consent !== true ||
      (smsConsent === true && !phoneNumber(smsPhone))) return null;
  return { name:name.trim(), address:address.trim(), contactPerson:contactPerson.trim(),
    phone:phoneNumber(phone), email, channel, smsConsent:smsConsent === true,
    smsPhone:smsConsent === true ? phoneNumber(smsPhone) : null };
}
export const hashCode = (salt, code) => createHash('sha256').update(salt + ':' + code).digest('hex');
export function newChallenge() {
  const code = String(randomInt(100000, 1000000));
  const salt = randomBytes(32).toString('hex');
  return { code, salt, hash:hashCode(salt,code) };
}
export function codeMatches(claim, code) {
  if (!/^\d{6}$/.test(code) || !claim.code_hash || !claim.code_salt || !/^[a-f0-9]{64}$/.test(claim.code_hash)) return false;
  return timingSafeEqual(Buffer.from(claim.code_hash,'hex'),Buffer.from(hashCode(claim.code_salt,code),'hex'));
}

// Global serialization makes the limits safe across parallel serverless instances.
export async function reserveVerification(db, userId, phone) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(836204116)');
    await client.query("DELETE FROM business_verification_requests WHERE created_at < now() - interval '1 day'");
    const {rows:[counts]} = await client.query(`SELECT count(*)::int AS total,
      count(*) FILTER (WHERE user_id=$1)::int AS account,
      count(*) FILTER (WHERE phone=$2)::int AS phone,
      count(*) FILTER (WHERE user_id=$1 AND created_at > now()-interval '1 minute')::int AS recent
      FROM business_verification_requests WHERE created_at > now()-interval '1 hour'`,[userId,phone]);
    if (counts.total >= 100 || counts.account >= 5 || counts.phone >= 3 || counts.recent > 0) {
      await client.query('ROLLBACK'); return false;
    }
    await client.query('INSERT INTO business_verification_requests(user_id,phone) VALUES($1,$2)',[userId,phone]);
    await client.query('COMMIT'); return true;
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}

export async function finishClaim(db, user, code) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const {rows:[claim]} = await client.query('SELECT * FROM business_claims WHERE user_id=$1 FOR UPDATE',[user.id]);
    if (!claim || claim.verified_at || !claim.expires_at || new Date(claim.expires_at) <= new Date() || claim.attempts >= 5) {
      await client.query('ROLLBACK'); return {error:'Request a new verification code.',status:400};
    }
    await client.query('UPDATE business_claims SET attempts=attempts+1 WHERE user_id=$1',[user.id]);
    if (!codeMatches(claim,code)) {
      await client.query('COMMIT'); return {error:'Incorrect code. Codes expire in 10 minutes and allow five attempts.',status:400};
    }
    const p=claim.profile;
    const {rows:[merchant]} = await client.query(`INSERT INTO merchants
      (name,address,contact_person,phone,email,merchant_code,google_place_id,status,owner_auth_user_id,
       sms_phone,sms_consent_at,sms_consent_source)
      VALUES($1,$2,$3,$4,$5,$6,$7,'CLAIMED',$8,$9,CASE WHEN $10 THEN now() END,CASE WHEN $10 THEN 'business_account' END)
      ON CONFLICT (google_place_id) DO UPDATE SET name=EXCLUDED.name,address=EXCLUDED.address,
        contact_person=EXCLUDED.contact_person,phone=EXCLUDED.phone,email=EXCLUDED.email,
        status='CLAIMED',owner_auth_user_id=EXCLUDED.owner_auth_user_id,
        sms_phone=EXCLUDED.sms_phone,sms_consent_at=EXCLUDED.sms_consent_at,
        sms_consent_source=EXCLUDED.sms_consent_source,sms_confirmed_at=NULL,sms_opted_out_at=NULL
      WHERE merchants.owner_auth_user_id=EXCLUDED.owner_auth_user_id OR
        (merchants.owner_auth_user_id IS NULL AND merchants.status <> 'CLAIMED')
      RETURNING id,merchant_code`,[p.name,p.address,p.contactPerson,p.phone,user.email,
        'VT'+randomBytes(8).toString('hex').toUpperCase(),claim.google_place_id,user.id,p.smsPhone,p.smsConsent]);
    if (!merchant) {
      await client.query('COMMIT'); return {error:'This business already has an owner. Contact VentText for an account transfer.',status:409};
    }
    await client.query('UPDATE business_claims SET verified_at=now(),code_hash=NULL,code_salt=NULL,expires_at=NULL WHERE user_id=$1',[user.id]);
    await client.query('COMMIT'); return {merchant,profile:p};
  } catch(e) {
    await client.query('ROLLBACK');
    if (e.code==='23505') return {error:'This account already has a business.',status:409};
    throw e;
  } finally { client.release(); }
}
