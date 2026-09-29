import { sendSms } from './twilio.js';

// Atomic 24-hour throttle. A failed send releases the reservation for retry.
export async function notifyMerchantIfSubscribed(db, merchantId) {
  const waiting = await db.query(
    `SELECT 1 FROM conversations WHERE merchant_id = $1 AND status != 'RESOLVED' LIMIT 1`,
    [merchantId]
  );
  if (!waiting.rows.length) return false;
  const reserved = await db.query(
    `UPDATE merchants SET notice_sent_at = now()
       WHERE id = $1 AND sms_confirmed_at IS NOT NULL AND sms_opted_out_at IS NULL
         AND phone IS NOT NULL
         AND (notice_sent_at IS NULL OR notice_sent_at < now() - interval '24 hours')
       RETURNING phone, notice_sent_at`,
    [merchantId]
  );
  if (!reserved.rows.length) return false;
  const { phone, notice_sent_at: sentAt } = reserved.rows[0];
  try {
    await sendSms(phone,
      'VentText: A customer message is waiting for your business. We will contact you to verify dashboard access. Reply STOP to opt out.');
    return true;
  } catch (error) {
    await db.query('UPDATE merchants SET notice_sent_at = NULL WHERE id = $1 AND notice_sent_at = $2',
      [merchantId, sentAt]);
    throw error;
  }
}
