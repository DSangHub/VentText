// api/merchant/reply.js
// The merchant dashboard POSTs here when a merchant types a reply.
// Body: { conversationId: string, message: string }

import { getDb } from '../_lib/db.js';
import { sendSms } from '../_lib/twilio.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // TODO: authenticate the merchant session before trusting this request.
  // This starter omits auth entirely — do not deploy as-is.

  const { conversationId, message } = req.body;
  if (!conversationId || !message) {
    return res.status(400).json({ error: 'conversationId and message are required' });
  }

  const db = getDb();

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

    const { customer_phone } = convo.rows[0];

    const sent = await sendSms(customer_phone, message);

    await db.query(
      `INSERT INTO messages (conversation_id, direction, sender, body, twilio_sid)
       VALUES ($1, 'outbound', 'merchant', $2, $3)`,
      [conversationId, message, sent.sid]
    );

    await db.query(
      `UPDATE conversations SET status = 'AWAITING_MERCHANT' WHERE id = $1`,
      [conversationId]
    );

    return res.status(200).json({ success: true, sid: sent.sid });
  } catch (err) {
    console.error('Merchant reply error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
