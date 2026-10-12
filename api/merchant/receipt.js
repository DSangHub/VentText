import { getDb } from '../_lib/db.js';
import { authenticateMerchant } from '../_lib/auth.js';
import { downloadReceiptImage } from '../_lib/receipt-reader.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  const messageId = req.query?.messageId;
  if (typeof messageId !== 'string' || !/^[a-f0-9-]{36}$/i.test(messageId)) return res.status(400).json({ error: 'A message ID is required.' });
  try {
    const db = getDb();
    const merchant = await authenticateMerchant(req, db);
    if (!merchant) return res.status(401).json({ error: 'Unauthorized' });
    const row = (await db.query(
      `SELECT m.media_url,m.twilio_sid FROM messages m JOIN conversations c ON c.id=m.conversation_id
        WHERE m.id=$1 AND c.merchant_id=$2 AND m.direction='inbound'`, [messageId, merchant.id]
    )).rows[0];
    if (!row?.media_url) return res.status(404).json({ error: 'Receipt not found.' });
    const image = await downloadReceiptImage({ mediaUrl: row.media_url, messageSid: row.twilio_sid });
    // Stay below Vercel's buffered response limit.
    if (image.data.length > 4 * 1024 * 1024) return res.status(413).json({ error: 'Photo is too large for dashboard viewing.' });
    res.setHeader('Content-Type', image.contentType);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.status(200).send(image.data);
  } catch {
    return res.status(502).json({ error: 'Receipt photo is temporarily unavailable.' });
  }
}
