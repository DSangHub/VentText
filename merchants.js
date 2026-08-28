// api/_lib/merchants.js
// Option B routing: one shared VentText number, merchant identified by a short
// code embedded on the customer's FIRST message (e.g. a QR code opens the SMS
// app pre-filled with "MARIO123 - "). See venttext-sms-to-chat-architecture.md.

// A merchant code is a short alphanumeric token, e.g. MARIO123. We look for it
// at the very start of the message, optionally followed by a separator and the
// real complaint text. We require at least one digit so ordinary opening words
// ("Hello - the food was cold") aren't mistaken for a code.
const CODE_RE = /^\s*([A-Za-z][A-Za-z0-9]{2,23})\s*(?:[-:|]\s*|\s+)([\s\S]*)$/;

/**
 * Pull a merchant code off the front of an inbound message body.
 * Returns { code, rest } when a plausible code is present, else null.
 */
export function parseMerchantCode(body) {
  if (!body) return null;
  const m = body.match(CODE_RE);
  if (!m) return null;
  const token = m[1];
  // Must contain a digit to qualify as a code (avoids matching plain words).
  if (!/[0-9]/.test(token)) return null;
  return { code: token.toUpperCase(), rest: (m[2] || '').trim() };
}

/**
 * Resolve the merchant a message is for.
 *
 * 1. If the body starts with a known merchant code -> that merchant.
 * 2. If it starts with an UNKNOWN code -> auto-seed a lightweight UNCLAIMED
 *    listing for it (per venttext-merchant-claim-flow.md, "self-added"), so the
 *    complaint has somewhere to live and can be claimed later.
 * 3. Otherwise -> null (caller should fall back to any existing open thread, or
 *    prompt the customer for the business code).
 *
 * Returns { merchant, autoSeeded } or null.
 */
export async function resolveMerchant(db, body) {
  const parsed = parseMerchantCode(body);
  if (!parsed) return null;

  const existing = await db.query(
    'SELECT * FROM merchants WHERE merchant_code = $1',
    [parsed.code]
  );
  if (existing.rows.length > 0) {
    return { merchant: existing.rows[0], autoSeeded: false, rest: parsed.rest };
  }

  // Unknown code: auto-seed an UNCLAIMED listing so nothing is lost.
  const seeded = await db.query(
    `INSERT INTO merchants (name, merchant_code, status)
     VALUES ($1, $2, 'UNCLAIMED')
     ON CONFLICT (merchant_code) DO UPDATE SET merchant_code = EXCLUDED.merchant_code
     RETURNING *`,
    [`Unclaimed business (${parsed.code})`, parsed.code]
  );
  return { merchant: seeded.rows[0], autoSeeded: true, rest: parsed.rest };
}

/** Look up a merchant by their dashboard API key (used for auth). */
export async function getMerchantByApiKey(db, apiKey) {
  if (!apiKey) return null;
  const r = await db.query('SELECT * FROM merchants WHERE api_key = $1', [apiKey]);
  return r.rows[0] || null;
}
