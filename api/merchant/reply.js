// api/merchant/reply.js
// The merchant dashboard POSTs here when a merchant types a reply.
// Body: { conversationId: string, message: string }
// Auth: Authorization: Bearer <merchant api_key>

import { getDb } from '../_lib/db.js';
import { sendSms } from '../_lib/twilio.js';
import { authenticateMerchant } from '../_lib/auth.js';
import { newMessageEvent } from '../_lib/realtime.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const db = getDb();

  // Authenticate the merchant. Rejects anyone without a valid, claimed API key.
  const merchant = await authenticateMerchant(req, db);
  if (!merchant) return res.status(401).json({ error: 'Unauthorized' });

  const { conversationId, message } = req.body || {};
  if (!conversationId || !message) {
    return res.status(400).json({ error: 'conversationId and message are required' });
  }

  try {
    const convo = await db.query(
      `SELECT c.*, cu.phone AS customer_phone
       FROM conversations c
       JOIN customers cu ON cu.id = c.customer_id
       WHERE c.id = $1`,
      [conversationId]
    );

    if (convo.rows.length === 0) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    // Authorization: a merchant may only reply on their OWN conversations.
    if (convo.rows[0].merchant_id !== merchant.id) {
      return res.status(403).json({ error: 'This conversation belongs to another merchant' });
    }

    const { customer_phone } = convo.rows[0];

    const sent = await sendSms(customer_phone, message);

    const inserted = await db.query(
      `INSERT INTO messages (conversation_id, direction, sender, body, twilio_sid)
       VALUES ($1, 'outbound', 'merchant', $2, $3)
       RETURNING id, created_at`,
      [conversationId, message, sent.sid]
    );

    await db.query(
      `UPDATE conversations SET status = 'AWAITING_MERCHANT' WHERE id = $1`,
      [conversationId]
    );

    // Reflect the merchant's own message back to any other open dashboard sessions.
    await newMessageEvent(merchant.id, conversationId, {
      id: inserted.rows[0].id,
      direction: 'outbound',
      sender: 'merchant',
      body: message,
      twilio_sid: sent.sid,
      created_at: inserted.rows[0].created_at,
    });

    return res.status(200).json({ success: true, sid: sent.sid });
  } catch (err) {
    console.error('Merchant reply error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
