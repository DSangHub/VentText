// api/webhook/sms-inbound.js
// Twilio calls this every time a customer texts your VentText number.
// Configure this URL in Twilio Console -> Phone Numbers -> your number -> "A message comes in"
//   https://venttext.com/api/webhook/sms-inbound

import twilio from 'twilio';
import { getDb } from '../_lib/db.js';
import { sendSms } from '../_lib/twilio.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // 1. Verify the request genuinely came from Twilio
  const isValid = twilio.validateRequest(
    process.env.TWILIO_AUTH_TOKEN,
    req.headers['x-twilio-signature'],
    `${process.env.PUBLIC_BASE_URL}/api/webhook/sms-inbound`,
    req.body
  );
  if (!isValid) return res.status(403).send('Invalid signature');

  const { From: fromNumber, Body: body, MessageSid: sid, NumMedia } = req.body;
  const mediaUrl = Number(NumMedia) > 0 ? req.body.MediaUrl0 : null;

  const db = getDb();

  try {
    // 2. Find or create the customer
    let customer = await db.query('SELECT * FROM customers WHERE phone = $1', [fromNumber]);
    if (customer.rows.length === 0) {
      customer = await db.query(
        'INSERT INTO customers (phone) VALUES ($1) RETURNING *',
        [fromNumber]
      );
    }
    const customerId = customer.rows[0].id;

    // 3. Find the most recent open conversation for this customer, or start a new one.
    //    NOTE: merchant identification (parsing a merchant_code out of the first message,
    //    or resolving it from a prior QR-code deep link session) happens here.
    //    This starter treats every new thread as unassigned until that logic is added.
    let convo = await db.query(
      `SELECT * FROM conversations
       WHERE customer_id = $1 AND status != 'RESOLVED'
       ORDER BY created_at DESC LIMIT 1`,
      [customerId]
    );

    let conversationId;
    if (convo.rows.length > 0) {
      conversationId = convo.rows[0].id;
    } else {
      const newConvo = await db.query(
        `INSERT INTO conversations (customer_id, status) VALUES ($1, 'NEW') RETURNING id`,
        [customerId]
      );
      conversationId = newConvo.rows[0].id;
    }

    // 4. Store the message
    await db.query(
      `INSERT INTO messages (conversation_id, direction, sender, body, media_url, twilio_sid)
       VALUES ($1, 'inbound', 'customer', $2, $3, $4)`,
      [conversationId, body, mediaUrl, sid]
    );

    // 5. TODO: publish a real-time event here so the merchant dashboard updates live
    //    e.g. await pusher.trigger(`merchant-${merchantId}`, 'new-message', { conversationId })

    // 6. Send an acknowledgment reply (swap in your real onboarding script)
    await sendSms(fromNumber, "Got it — we're on it. We'll follow up shortly.");

    // 7. Twilio expects a response; empty TwiML is fine since we sent the reply via the API above
    res.set('Content-Type', 'text/xml');
    return res.status(200).send('<Response></Response>');
  } catch (err) {
    console.error('Inbound webhook error:', err);
    return res.status(500).send('Internal error');
  }
}
