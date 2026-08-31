// api/merchant/messages.js
// GET — fetch the full message thread for one conversation the merchant owns.
// Auth: Authorization: Bearer <merchant api_key>
// Query: ?conversationId=<uuid>

import { getDb } from '../_lib/db.js';
import { authenticateMerchant } from '../_lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const db = getDb();
  const merchant = await authenticateMerchant(req, db);
  if (!merchant) return res.status(401).json({ error: 'Unauthorized' });

  const conversationId = req.query?.conversationId;
  if (!conversationId) {
    return res.status(400).json({ error: 'conversationId is required' });
  }

  try {
    // Verify the conversation belongs to this merchant before returning anything.
    const convo = await db.query(
      `SELECT c.id, c.status, c.severity_score, c.response_deadline,
              cu.phone AS customer_phone, cu.name AS customer_name
         FROM conversations c
         JOIN customers cu ON cu.id = c.customer_id
        WHERE c.id = $1 AND c.merchant_id = $2`,
      [conversationId, merchant.id]
    );
    if (convo.rows.length === 0) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const messages = await db.query(
      `SELECT id, direction, sender, body, media_url, status, twilio_sid, created_at
         FROM messages
        WHERE conversation_id = $1
        ORDER BY created_at ASC`,
      [conversationId]
    );

    return res.status(200).json({
      conversation: convo.rows[0],
      messages: messages.rows,
    });
  } catch (err) {
    console.error('Fetch messages error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
