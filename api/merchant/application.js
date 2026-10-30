import { getDb } from '../../db.js';
import { authenticatedBusinessUser } from '../_lib/business-auth.js';
import { applicationProfile, saveApplication, verifyApplicationPhone, submitApplication } from '../_lib/business-applications.js';
import { newChallenge, reserveVerification } from '../_lib/business-claims.js';
import { sendSms, twilioClient } from '../_lib/twilio.js';

export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if (req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
  try {
    const user=await authenticatedBusinessUser(req);
    if (!user) return res.status(401).json({error:'Sign in with your confirmed email first.'});
    const {action}=req.body || {};
    if (!['save','send_code','verify','submit'].includes(action)) return res.status(400).json({error:'Choose a valid application action.'});
    const db=getDb();
    if (action==='verify') {
      const code=req.body.code;
      if (typeof code!=='string' || !/^\d{6}$/.test(code)) return res.status(400).json({error:'Enter the six-digit verification code.'});
      const result=await verifyApplicationPhone(db,user.id,code);
      return result.error ? res.status(result.status).json({error:result.error}) : res.status(200).json({...result,message:'Phone verified. Submit your business evidence for review to finish setup.'});
    }
    if (action==='submit') {
      const result=await submitApplication(db,user.id);
      return result.error ? res.status(result.status).json({error:result.error}) : res.status(200).json({...result,message:'Business profile submitted for review. Your inbox remains private until approval.'});
    }
    const profile=applicationProfile(req.body,user.email);
    if (!profile) return res.status(400).json({error:'Enter your business name, address, contact person, US phone, and a valid HTTPS business website or business registration details.'});
    if (action==='send_code' && req.body.consent!==true) return res.status(400).json({error:'Request and agree to receive a verification text or call at your business phone.'});
    if (action==='send_code' && !await reserveVerification(db,user.id,profile.phone)) return res.status(429).json({error:'Too many code requests. Wait before requesting another code.'});
    const saved=await saveApplication(db,user,profile);
    if (saved.error) return res.status(saved.status).json({error:saved.error});
    if (action==='save') return res.status(200).json({...saved,message:'Business profile saved. Google Maps is not required. Verify your phone, then submit for review.'});
    const challenge=newChallenge();
    const {rows}=await db.query(`UPDATE business_applications SET code_hash=$2,code_salt=$3,expires_at=now()+interval '10 minutes',attempts=0
      WHERE user_id=$1 AND status='DRAFT' AND profile=$4::jsonb RETURNING user_id`,[user.id,challenge.hash,challenge.salt,JSON.stringify(profile)]);
    if (!rows.length) return res.status(409).json({error:'Your profile changed. Save it and request a new code.'});
    try {
      if (profile.channel==='voice') {
        const digits=challenge.code.split('').join(' ');
        await twilioClient.calls.create({from:process.env.TWILIO_PHONE_NUMBER,to:profile.phone,
          twiml:`<Response><Say>Your Vent Text business phone verification code is ${digits}. Again, ${digits}. Expires in ten minutes. Do not share this code.</Say></Response>`});
      } else {
        await sendSms(profile.phone,`VentText business phone verification code: ${challenge.code}. Expires in 10 minutes. Only enter it at venttext.com. Do not share it. Reply STOP to opt out.`);
      }
    } catch {
      await db.query('UPDATE business_applications SET code_hash=NULL,code_salt=NULL,expires_at=NULL WHERE user_id=$1 AND code_hash=$2',[user.id,challenge.hash]);
      return res.status(502).json({...saved,error:'Your profile is saved, but the verification code could not be delivered. Check the number or choose a call for a landline.'});
    }
    return res.status(200).json({...saved,message:'Verification code requested. Enter it within 10 minutes, then submit your profile for review.'});
  } catch(error) {
    console.error('Business application failed',{code:error?.code || error?.name || 'UNKNOWN'});
    return res.status(503).json({error:'Business profile setup is temporarily unavailable. Please try again.'});
  }
}
