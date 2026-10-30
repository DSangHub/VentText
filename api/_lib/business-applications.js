import { businessProfile, codeMatches } from './business-claims.js';

export function applicationProfile(body,email) {
  const profile=businessProfile({...body,channel:body?.channel || 'sms',consent:true,smsConsent:false},email);
  if (!profile) return null;
  const website=typeof body.website==='string' ? body.website.trim() : '';
  const registration=typeof body.registration==='string' ? body.registration.trim() : '';
  const notes=typeof body.notes==='string' ? body.notes.trim() : '';
  if (website.length>500 || registration.length>500 || notes.length>1000 || (!website && !registration)) return null;
  if (website) {
    try {
      const url=new URL(website);
      if (url.protocol!=='https:' || url.username || url.password || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname) || /\.(local|internal|localhost)$/i.test(url.hostname)) return null;
    } catch {return null;}
  }
  return {...profile,website,registration,notes};
}
export function applicationSummary(row) {
  if (!row) return null;
  return {status:row.status,profile:row.profile,phoneVerified:!!row.phone_verified_at,
    codePending:row.code_pending ?? !!(row.code_hash && row.expires_at && new Date(row.expires_at)>new Date() && row.attempts<5),
    submittedAt:row.submitted_at,reviewedAt:row.reviewed_at,reviewNote:row.review_note || '',merchantId:row.merchant_id};
}
export async function readApplication(db,userId) {
  const {rows:[row]}=await db.query('SELECT status,profile,phone_verified_at,submitted_at,reviewed_at,review_note,merchant_id, (code_hash IS NOT NULL AND expires_at>now() AND attempts<5) AS code_pending FROM business_applications WHERE user_id=$1',[userId]);
  return applicationSummary(row);
}
export async function saveApplication(db,user,profile) {
  const client=await db.connect();
  try {
    await client.query('BEGIN');
    // The same row lock is used by phone checks, submission, and staff review.
    const {rows:owned}=await client.query('SELECT id FROM merchants WHERE owner_auth_user_id=$1',[user.id]);
    if (owned.length) {await client.query('ROLLBACK');return {status:409,error:'Your business is already connected. Open your dashboard.'};}
    const {rows:[row]}=await client.query(`INSERT INTO business_applications(user_id,profile,phone)
      VALUES($1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET profile=EXCLUDED.profile,phone=EXCLUDED.phone,
      status='DRAFT',code_hash=NULL,code_salt=NULL,expires_at=NULL,attempts=0,phone_verified_at=NULL,
      submitted_at=NULL,reviewed_at=NULL,reviewed_by=NULL,review_note=NULL,updated_at=now()
      WHERE business_applications.status <> 'APPROVED' RETURNING *`,[user.id,profile,profile.phone]);
    await client.query('COMMIT');
    return row ? {application:applicationSummary(row)} : {status:409,error:'This application is already approved.'};
  } catch(error) {await client.query('ROLLBACK');throw error;} finally {client.release();}
}
export async function verifyApplicationPhone(db,userId,code) {
  const client=await db.connect();
  try {
    await client.query('BEGIN');
    const {rows:[row]}=await client.query('SELECT * FROM business_applications WHERE user_id=$1 FOR UPDATE',[userId]);
    if (!row || row.status!=='DRAFT' || !row.expires_at || new Date(row.expires_at)<=new Date() || row.attempts>=5) {
      await client.query('ROLLBACK');return {status:400,error:'Request a new phone verification code.'};
    }
    await client.query('UPDATE business_applications SET attempts=attempts+1 WHERE user_id=$1',[userId]);
    if (!codeMatches(row,code)) {await client.query('COMMIT');return {status:400,error:'Incorrect code. Codes expire in 10 minutes and allow five attempts.'};}
    const {rows:[verified]}=await client.query(`UPDATE business_applications SET status='PHONE_VERIFIED',
      phone_verified_at=now(),code_hash=NULL,code_salt=NULL,expires_at=NULL,updated_at=now()
      WHERE user_id=$1 RETURNING *`,[userId]);
    await client.query('COMMIT');return {application:applicationSummary(verified)};
  } catch(error) {await client.query('ROLLBACK');throw error;} finally {client.release();}
}
export async function submitApplication(db,userId) {
  const {rows:[row]}=await db.query(`UPDATE business_applications SET status='REVIEW_PENDING',submitted_at=now(),updated_at=now()
    WHERE user_id=$1 AND status='PHONE_VERIFIED' AND phone_verified_at IS NOT NULL RETURNING *`,[userId]);
  if (row) return {application:applicationSummary(row)};
  const existing=await readApplication(db,userId);
  return existing?.status==='REVIEW_PENDING' ? {application:existing} : {status:400,error:'Save your business details and verify your phone before submitting for review.'};
}
