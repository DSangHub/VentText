// api/merchant/conversations.js
// GET — list the authenticated merchant's conversations for the dashboard inbox.
// Auth: Authorization: Bearer <merchant api_key>
// Query: ?status=open (default, excludes RESOLVED) | all

import { getDb } from '../_lib/db.js';
import { authenticateMerchant } from '../_lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const db = getDb();
  const merchant = await authenticateMerchant(req, db);
  if (!merchant) return res.status(401).json({ error: 'Unauthorized' });

  const showAll = (req.query?.status || 'open') === 'all';

  try {
    const rows = await db.query(
      `SELECT c.id,
              c.status,
              c.severity_score,
              c.response_deadline,
              c.created_at,
              cu.phone AS customer_phone,
              cu.name  AS customer_name,
              lm.body  AS last_message,
              lm.created_at AS last_message_at
         FROM conversations c
         JOIN customers cu ON cu.id = c.customer_id
    LEFT JOIN LATERAL (
              SELECT body, created_at FROM messages m
               WHERE m.conversation_id = c.id
               ORDER BY m.created_at DESC LIMIT 1
         ) lm ON true
        WHERE c.merchant_id = $1
          AND ($2 OR c.status != 'RESOLVED')
        ORDER BY COALESCE(lm.created_at, c.created_at) DESC
        LIMIT 200`,
      [merchant.id, showAll]
    );

    return res.status(200).json({
      merchant: { id: merchant.id, name: merchant.name, status: merchant.status },
      conversations: rows.rows,
    });
  } catch (err) {
    console.error('List conversations error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
