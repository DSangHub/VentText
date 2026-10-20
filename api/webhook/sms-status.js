// api/webhook/sms-status.js
// Twilio calls this to report delivery status for messages you sent.
// Set automatically via the statusCallback param in sendSms() — no manual config needed.

import { getDb } from '../_lib/db.js';
import twilio from 'twilio';

const STATUSES = new Set(['accepted','scheduled','canceled','queued','sending','sent','delivered','undelivered','failed','read']);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const base = process.env.PUBLIC_BASE_URL?.replace(/\/$/, '');
    const token = process.env.TWILIO_AUTH_TOKEN;
    const signature = req.headers?.['x-twilio-signature'];
    if (!base || !token || !signature || !twilio.validateRequest(token, signature,
        `${base}/api/webhook/sms-status`, req.body || {})) return res.status(403).send('Invalid signature');
    const { MessageSid: sid, MessageStatus: status } = req.body || {};
    if (!/^(SM|MM)[a-f0-9]{32}$/i.test(sid || '') || !STATUSES.has(status)) return res.status(400).send('Invalid status');
    const db = getDb();
    await db.query("UPDATE messages SET status = $1 WHERE twilio_sid = $2 AND direction='outbound'", [status, sid]);
    return res.status(200).end();
  } catch (err) {
    console.error('Status webhook error:', err);
    return res.status(500).end();
  }
}
