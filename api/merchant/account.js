import { getDb } from '../../db.js';
import { authenticatedBusinessUser } from '../_lib/business-auth.js';
import { finishClaim } from '../_lib/business-claims.js';
import { sendSms } from '../_lib/twilio.js';

export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if (!['GET','POST'].includes(req.method)) return res.status(405).json({error:'Method not allowed'});
  try {
    const user=await authenticatedBusinessUser(req);
    if (!user) return res.status(401).json({error:'Sign in with a confirmed email first.'});
    const db=getDb();
    if (req.method === 'GET') {
      const {rows:[merchant]}=await db.query('SELECT id,name,status,merchant_code FROM merchants WHERE owner_auth_user_id=$1',[user.id]);
      return res.status(200).json({email:user.email,merchant:merchant || null});
    }
    const code=req.body?.code;
    if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return res.status(400).json({error:'Enter the six-digit verification code.'});
    const result=await finishClaim(db,user,code);
    if (result.error) return res.status(result.status).json({error:result.error});
    let message='Business verified. Your dashboard is ready.';
    if (result.profile.smsConsent) {
      try {
        await sendSms(result.profile.smsPhone,`VentText: Reply YES ${result.merchant.merchant_code} to confirm customer message notifications for your business. Reply STOP to opt out.`);
        message+=' Reply YES with the business code to the separate notification text to enable alerts.';
      } catch { message+=' Notification confirmation could not be sent. Dashboard access is ready; contact VentText for notification setup.'; }
    }
    return res.status(200).json({message,merchant:result.merchant});
  } catch {
    console.error('Business account request failed');
    return res.status(503).json({error:'Account access is temporarily unavailable. Please try again.'});
  }
}
