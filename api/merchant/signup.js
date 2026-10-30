import { getDb } from '../../db.js';
import { authenticatedBusinessUser } from '../_lib/business-auth.js';
import { businessProfile, newChallenge, reserveVerification } from '../_lib/business-claims.js';
import { findBusinessPlace, matchesListedPhone } from '../_lib/google-places.js';
import { sendSms, twilioClient } from '../_lib/twilio.js';

export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if (req.method !== 'POST') return res.status(405).json({error:'Method not allowed'});
  let stage='authenticate';
  try {
    const user=await authenticatedBusinessUser(req);
    if (!user) return res.status(401).json({error:'Sign in with a confirmed business email first.'});
    const profile=businessProfile(req.body,user.email);
    if (!profile) return res.status(400).json({error:'Enter your business name, full address, contact person and US phone. Choose text or call and agree to receive the verification code.'});
    stage='database';
    const db=getDb();
    const owned=await db.query('SELECT id FROM merchants WHERE owner_auth_user_id=$1',[user.id]);
    if (owned.rows.length) return res.status(409).json({error:'Your business is already connected. Open your dashboard.'});
    if (!await reserveVerification(db,user.id,profile.phone)) return res.status(429).json({error:'Too many verification requests. Wait before requesting another code.'});
    stage='place_lookup';
    const placeId=await findBusinessPlace(profile.name,profile.address,undefined,{businessSignup:true});
    if (!placeId) {
      return res.status(422).json({code:'BUSINESS_NOT_FOUND',error:'We could not identify one Google Maps listing for that business name and address. Check the listing name and street number, city and state. Street/Avenue abbreviations and full state names are accepted. No verification code was sent.'});
    }
    stage='phone_lookup';
    if (!await matchesListedPhone(placeId,profile.phone)) {
      return res.status(422).json({code:'BUSINESS_PHONE_MISMATCH',error:'We found the business location, but this phone does not match its Google Maps phone. Enter the listed business phone and choose Phone call for a landline. No verification code was sent.'});
    }
    stage='save_challenge';
    const existing=await db.query("SELECT id FROM merchants WHERE google_place_id=$1 AND (owner_auth_user_id IS NOT NULL OR status='CLAIMED')",[placeId]);
    if (existing.rows.length) return res.status(409).json({error:'This business already has an owner. Contact VentText for an account transfer.'});
    const challenge=newChallenge();
    await db.query(`INSERT INTO business_claims(user_id,profile,google_place_id,phone,code_hash,code_salt,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,now()+interval '10 minutes')
      ON CONFLICT(user_id) DO UPDATE SET profile=EXCLUDED.profile,google_place_id=EXCLUDED.google_place_id,
      phone=EXCLUDED.phone,code_hash=EXCLUDED.code_hash,code_salt=EXCLUDED.code_salt,
      expires_at=EXCLUDED.expires_at,attempts=0,verified_at=NULL`,
      [user.id,profile,placeId,profile.phone,challenge.hash,challenge.salt]);
    try {
      if (profile.channel === 'voice') {
        const digits=challenge.code.split('').join(' ');
        await twilioClient.calls.create({from:process.env.TWILIO_PHONE_NUMBER,to:profile.phone,
          twiml:`<Response><Say>Your Vent Text business verification code is ${digits}. Again, ${digits}. This code expires in ten minutes. Do not share this code.</Say></Response>`});
      } else {
        await sendSms(profile.phone,`VentText business verification code: ${challenge.code}. Expires in 10 minutes. Only enter it at venttext.com. Do not share it. Reply STOP to opt out.`);
      }
    } catch {
      await db.query('UPDATE business_claims SET code_hash=NULL,code_salt=NULL,expires_at=NULL WHERE user_id=$1 AND code_hash=$2',[user.id,challenge.hash]);
      return res.status(502).json({error:'The verification code could not be delivered. Check the number; choose a call for a landline.'});
    }
    return res.status(200).json({message:`Verification ${profile.channel === 'voice' ? 'call' : 'text'} requested. Enter the six-digit code within 10 minutes.`});
  } catch (error) {
    console.error('Business verification request failed', {stage,code:error?.code || error?.name || 'UNKNOWN',status:error?.status || null});
    return res.status(503).json({code:'BUSINESS_LOOKUP_UNAVAILABLE',error:'Business verification is temporarily unavailable. Your email account is saved. This is a service problem, not a business-name mismatch; please try again later.'});
  }
}
