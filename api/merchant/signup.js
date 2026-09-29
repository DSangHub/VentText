import { randomBytes } from 'node:crypto';
import { getDb } from '../../db.js';
import { findBusinessPlace } from '../_lib/google-places.js';
import { sendSms } from '../_lib/twilio.js';

function usMobileNumber(value) {
  const digits = value.replace(/\D/g, '');
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { name, address, contactPerson, phone, email, smsConsent } = req.body || {};
  const fields = [name, address, contactPerson, phone, email];
  if (fields.some(value => typeof value !== 'string' || !value.trim() || value.length > 255) ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^[+\d()\s.-]{7,25}$/.test(phone)) {
    return res.status(400).json({ error: 'Enter a valid business name, address, contact person, phone number, and email.' });
  }
  const normalizedPhone = usMobileNumber(phone);
  if (!normalizedPhone) return res.status(400).json({ error: 'Enter a valid US phone number.' });
  try {
    const code = 'VT' + randomBytes(8).toString('hex').toUpperCase();
    const db = getDb();
    let placeId = null;
    try { placeId = await findBusinessPlace(name.trim(), address.trim()); }
    catch (error) { console.error('Signup place lookup failed:', error); }
    const values = [name.trim(), address.trim(), contactPerson.trim(), normalizedPhone,
      email.trim().toLowerCase(), code, smsConsent === true, placeId];
    let saved;
    if (placeId) {
      saved = await db.query(
        `INSERT INTO merchants (name, address, contact_person, phone, email, merchant_code, status,
                                sms_consent_at, sms_consent_source, google_place_id)
         VALUES ($1,$2,$3,$4,$5,$6,'PENDING', CASE WHEN $7 THEN now() END,
                 CASE WHEN $7 THEN 'merchant_signup' END,$8)
         ON CONFLICT (google_place_id) DO UPDATE SET
           name = EXCLUDED.name, address = EXCLUDED.address, contact_person = EXCLUDED.contact_person,
           phone = EXCLUDED.phone, email = EXCLUDED.email, status = 'PENDING',
           sms_consent_at = EXCLUDED.sms_consent_at, sms_consent_source = EXCLUDED.sms_consent_source,
           sms_confirmed_at = NULL, sms_opted_out_at = NULL
         WHERE merchants.status = 'UNCLAIMED'
         RETURNING merchant_code`, values
      );
      if (!saved.rows.length) return res.status(409).json({ error: 'This business already has a profile. Contact VentText for help.' });
    } else {
      saved = await db.query(
        `INSERT INTO merchants (name, address, contact_person, phone, email, merchant_code, status,
                                sms_consent_at, sms_consent_source)
         VALUES ($1,$2,$3,$4,$5,$6,'PENDING', CASE WHEN $7 THEN now() END,
                 CASE WHEN $7 THEN 'merchant_signup' END)
         RETURNING merchant_code`, values.slice(0, 7)
      );
    }
    let message = 'Business profile received. We will contact you to verify it before dashboard access is enabled.';
    if (smsConsent === true) {
      try {
        await sendSms(normalizedPhone,
          `VentText: Reply YES ${saved.rows[0].merchant_code} to confirm customer message notifications for your business. Reply STOP to opt out.`);
        message += ' Check your phone and reply YES with the code shown in our text to confirm notifications.';
      } catch (error) {
        console.error('Business SMS confirmation failed:', error);
        message += ' We could not send the SMS confirmation; contact VentText to finish setup.';
      }
    }
    return res.status(201).json({ message });
  } catch (error) {
    console.error('Business signup failed:', error);
    return res.status(500).json({ error: 'We could not save your business profile. Please try again.' });
  }
}
