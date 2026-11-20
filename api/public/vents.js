import { getDb } from '../_lib/db.js';

// Only explicitly published excerpts are returned. Private SMS, receipts,
// phone numbers, customer IDs and merchant contact details never leave here.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=30');
  if (req.method !== 'GET') return res.status(405).end();
  const zip = String(req.query?.zip || '').trim();
  if (!/^\d{5}$/.test(zip)) return res.status(400).json({ error: 'Enter a five-digit ZIP code.' });
  try {
    const result = await getDb().query(
      `SELECT m.name AS business, c.category, c.zip_code AS zip,
              c.public_excerpt AS text, c.public_consent_at AS posted_at, c.status
         FROM conversations c JOIN merchants m ON m.id=c.merchant_id
        WHERE c.zip_code=$1 AND c.public_consent_at IS NOT NULL
          AND c.public_excerpt IS NOT NULL
        ORDER BY c.public_consent_at DESC LIMIT 50`, [zip]
    );
    return res.status(200).json({ vents: result.rows });
  } catch (error) {
    console.error('Local feed error:', error);
    return res.status(500).json({ error: 'The local feed is temporarily unavailable.' });
  }
}
