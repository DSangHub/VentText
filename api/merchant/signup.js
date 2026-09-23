import { randomBytes } from 'node:crypto';
import { getDb } from '../../db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { name, address, contactPerson, phone, email } = req.body || {};
  const fields = [name, address, contactPerson, phone, email];
  if (fields.some(value => typeof value !== 'string' || !value.trim() || value.length > 255) ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^[+\d()\s.-]{7,25}$/.test(phone)) {
    return res.status(400).json({ error: 'Enter a valid business name, address, contact person, phone number, and email.' });
  }
  try {
    const code = 'VT' + randomBytes(8).toString('hex').toUpperCase();
    const db = getDb();
    const insert = () => db.query(
      `INSERT INTO merchants (name, address, contact_person, phone, email, merchant_code, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'PENDING')`,
      [name.trim(), address.trim(), contactPerson.trim(), phone.trim(), email.trim().toLowerCase(), code]
    );
    try {
      await insert();
    } catch (error) {
      // Older production databases predate the business profile migration.
      // Apply its two additive columns once, then retry this signup.
      if (error.code !== '42703' ||
          !/column "(?:address|contact_person)" of relation "merchants" does not exist/.test(error.message)) {
        throw error;
      }
      await db.query(`ALTER TABLE merchants
        ADD COLUMN IF NOT EXISTS address TEXT,
        ADD COLUMN IF NOT EXISTS contact_person TEXT`);
      await insert();
    }
    return res.status(201).json({ message: 'Business profile received. We will contact you to verify it before dashboard access is enabled.' });
  } catch (error) {
    console.error('Business signup failed:', error);
    return res.status(500).json({ error: 'We could not save your business profile. Please try again.' });
  }
}
