import { readReceipt } from './receipt-reader.js';
import { resolveMerchant } from './merchants.js';
import { scoreSeverity } from './pipeline.js';

export async function processReceipt(db, { customerId, messageId, mediaUrl, messageSid, contentType }) {
  const recent = await db.query(
    `SELECT count(*)::int AS count FROM messages m JOIN conversations c ON c.id=m.conversation_id
      WHERE c.customer_id=$1 AND m.direction='inbound' AND m.media_url IS NOT NULL
        AND m.created_at > now() - interval '1 hour'`, [customerId]
  );
  const result = recent.rows[0].count > 3 ? { status: 'rate_limit' }
    : await readReceipt({ mediaUrl, messageSid, contentType });
  await db.query('UPDATE messages SET receipt_read_status=$2, receipt_business=$3 WHERE id=$1',
    [messageId, result.status, result.business || null]);
  if (result.business) {
    const business = result.business;
    const detected = business.code ? `VentText code ${business.code}` : `${business.name}, ${business.address}`;
    return `I read ${detected} on the receipt. Reply YES RECEIPT ${messageId.slice(0, 8).toUpperCase()} if this is correct. You can add " - what happened" to that reply. Otherwise send BUSINESS: Name | Address | What happened.`;
  }
  if (result.status === 'rate_limit') return 'Your receipt photo is saved. Please wait before sending another photo for reading, or text the business name and address.';
  if (result.status === 'unavailable') return 'Your receipt photo is saved, but receipt reading is temporarily unavailable. Please text BUSINESS: Name | Address | What happened.';
  if (result.status === 'unsupported') return 'Your attachment is saved. Receipt reading needs one clear JPEG, PNG, or WebP photo under 5 MB. Please resend the top of the receipt with the business name and address.';
  return 'I could not read the business name and address clearly. Please send a sharper photo of the top of the receipt, or text BUSINESS: Name | Address | What happened.';
}

export function parseReceiptConfirmation(body) {
  const match = String(body || '').trim().match(/^YES\s+RECEIPT\s+([A-F0-9]{8})(?:\s*[-:]\s*([\s\S]{1,1600}))?$/i);
  return match ? { token: match[1].toLowerCase(), complaint: (match[2] || '').trim() } : null;
}

export async function confirmReceipt(db, { customerId, confirmation, body, messageSid }) {
  const pending = await db.query(
    `SELECT m.id, m.conversation_id, m.body, m.receipt_business FROM messages m
       JOIN conversations c ON c.id=m.conversation_id
      WHERE c.customer_id=$1 AND c.merchant_id IS NULL AND c.status!='RESOLVED'
        AND m.receipt_read_status='needs_confirmation' AND left(m.id::text,8)=$2
        AND m.created_at > now() - interval '24 hours' LIMIT 2`, [customerId, confirmation.token]
  );
  if (pending.rows.length !== 1) return { reply: 'That receipt confirmation is expired or already handled. Send a fresh receipt photo, or the business name and address.' };
  const source = pending.rows[0];
  const inserted = await db.query(
    `INSERT INTO messages (conversation_id,direction,sender,body,twilio_sid)
     VALUES ($1,'inbound','customer',$2,$3) ON CONFLICT DO NOTHING RETURNING id`,
    [source.conversation_id, body, messageSid]
  );
  if (!inserted.rows.length) return { duplicate: true };
  const recent = await db.query(
    `SELECT count(*)::int AS count FROM messages m JOIN conversations c ON c.id=m.conversation_id
      WHERE c.customer_id=$1 AND m.direction='inbound' AND m.body ~* '^YES\\s+RECEIPT'
        AND m.created_at > now() - interval '1 hour'`, [customerId]
  );
  if (recent.rows[0].count > 3) return { conversationId: source.conversation_id, reply: 'Your receipt is saved. Please wait before retrying the business match.' };
  const business = source.receipt_business;
  let merchant;
  try {
    if (business && /^VT[A-F0-9]{16}$/.test(business.code || '')) {
      // An OCR code must already exist. Never seed a listing from an order ID.
      merchant = (await db.query('SELECT * FROM merchants WHERE merchant_code=$1', [business.code])).rows[0];
    } else if (business && typeof business.name === 'string' && typeof business.address === 'string' &&
        business.name.length <= 120 && business.address.length <= 160) {
      if (!process.env.GOOGLE_PLACES_API_KEY) throw new Error('places_unavailable');
      merchant = (await resolveMerchant(db, `BUSINESS: ${business.name} | ${business.address} | Receipt photo`))?.merchant;
    }
  } catch {
    return { conversationId: source.conversation_id, reply: 'The receipt is saved, but business matching is temporarily unavailable. Please try that confirmation again later or use the checkout business code.' };
  }
  if (!merchant) return { conversationId: source.conversation_id, reply: 'The receipt is readable, but I could not confidently match that business location. Please text BUSINESS: Exact Name | Address | What happened.' };
  const updated = await db.query(
    `UPDATE conversations SET merchant_id=$2, receipt_source='photo',
       response_deadline=now()+($3 || ' hours')::interval
      WHERE id=$1 AND merchant_id IS NULL RETURNING id`,
    [source.conversation_id, merchant.id, merchant.response_window_hours ?? 48]
  );
  if (!updated.rows.length) return { reply: 'This conversation already has a business. Please send a new message with the correct checkout code.' };
  await db.query("UPDATE messages SET receipt_read_status='confirmed' WHERE id=$1", [source.id]);
  const complaint = confirmation.complaint || source.body?.trim();
  const needsComplaint = !complaint || complaint === 'Receipt photo';
  if (!needsComplaint) await db.query(
    'UPDATE conversations SET severity_score=GREATEST(COALESCE(severity_score,0),$2) WHERE id=$1',
    [source.conversation_id, scoreSeverity(complaint)]
  );
  let reply = `Receipt matched to ${merchant.name}. The photo is saved for review.`;
  if (needsComplaint) reply += ` Tell us what happened by replying ${merchant.merchant_code} - your complaint.`;
  else if (merchant.status !== 'CLAIMED') reply += ' The business can respond after it joins and verifies its profile.';
  else reply += ' Your message is in the business dashboard.';
  return { reply, conversationId: source.conversation_id, merchantId: merchant.id, notify: !needsComplaint };
}
