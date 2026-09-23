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
    await getDb().query(
      `INSERT INTO merchants (name, address, contact_person, phone, email, merchant_code, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'PENDING')`,
      [name.trim(), address.trim(), contactPerson.trim(), phone.trim(), email.trim().toLowerCase(), code]
    );
    return res.status(201).json({ message: 'Business profile received. We will contact you to verify it before dashboard access is enabled.' });
  } catch (error) {
    console.error('Business signup failed:', error);
    return res.status(500).json({ error: 'We could not save your business profile. Please try again.' });
  }
}
