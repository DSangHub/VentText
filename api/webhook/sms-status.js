// api/webhook/sms-status.js
// Twilio calls this to report delivery status for messages you sent.
// Set automatically via the statusCallback param in sendSms() — no manual config needed.

import { getDb } from '../_lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { MessageSid: sid, MessageStatus: status } = req.body;
  const db = getDb();

  try {
    await db.query('UPDATE messages SET status = $1 WHERE twilio_sid = $2', [status, sid]);
    return res.status(200).end();
  } catch (err) {
    console.error('Status webhook error:', err);
    return res.status(500).end();
  }
}
