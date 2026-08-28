// api/webhook/sms-inbound.js
// Twilio calls this every time a customer texts your VentText number.
// Configure this URL in Twilio Console -> Phone Numbers -> your number -> "A message comes in"
//   https://venttext.com/api/webhook/sms-inbound
//
// Flow: verify signature -> find/create customer -> identify merchant (Option B,
// shared number + embedded code) -> thread the conversation -> run the pipeline
// (rate limit + severity) -> store -> push realtime event -> reply to customer.

import twilio from 'twilio';
import { getDb } from '../_lib/db.js';
import { sendSms } from '../_lib/twilio.js';
import { resolveMerchant } from '../_lib/merchants.js';
import { checkRateLimit, scoreSeverity } from '../_lib/pipeline.js';
import { newMessageEvent } from '../_lib/realtime.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // 1. Verify the request genuinely came from Twilio.
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
    // 2. Find or create the customer.
    let customer = await db.query('SELECT * FROM customers WHERE phone = $1', [fromNumber]);
    if (customer.rows.length === 0) {
      customer = await db.query(
        'INSERT INTO customers (phone) VALUES ($1) RETURNING *',
        [fromNumber]
      );
    }
    const customerId = customer.rows[0].id;

    // 3. Identify which merchant this is for (Option B). A merchant code on the
    //    first message resolves (or auto-seeds) the merchant.
    const resolved = await resolveMerchant(db, body);
    const merchant = resolved ? resolved.merchant : null;

    // 4. Pick the conversation to append to.
    const { conversationId, merchantId, promptForCode } =
      await selectConversation(db, customerId, merchant);

    // 5. Store the inbound message.
    const complaintText = resolved && resolved.rest ? resolved.rest : body;
    const inserted = await db.query(
      `INSERT INTO messages (conversation_id, direction, sender, body, media_url, twilio_sid)
       VALUES ($1, 'inbound', 'customer', $2, $3, $4)
       RETURNING id, created_at`,
      [conversationId, body, mediaUrl, sid]
    );

    // 6. Pipeline: severity scoring + rate limiting.
    const severity = scoreSeverity(complaintText);
    await db.query(
      `UPDATE conversations
          SET severity_score = GREATEST(COALESCE(severity_score, 0), $2)
        WHERE id = $1`,
      [conversationId, severity]
    );
    const { limited } = await checkRateLimit(db, conversationId);

    // 7. Real-time push so a subscribed merchant dashboard updates live.
    if (merchantId) {
      await newMessageEvent(merchantId, conversationId, {
        id: inserted.rows[0].id,
        direction: 'inbound',
        sender: 'customer',
        body,
        media_url: mediaUrl,
        severity_score: severity,
        created_at: inserted.rows[0].created_at,
      });
    }

    // 8. Reply to the customer (unless rate-limited, to avoid a reply storm).
    if (!limited) {
      await sendSms(fromNumber, ackMessage({ promptForCode, merchant }));
    }

    // 9. Twilio expects a response; empty TwiML is fine since we replied via the API.
    res.set('Content-Type', 'text/xml');
    return res.status(200).send('<Response></Response>');
  } catch (err) {
    console.error('Inbound webhook error:', err);
    return res.status(500).send('Internal error');
  }
}

/**
 * Decide which conversation an inbound message belongs to.
 * - Known merchant: continue an open (customer, merchant) thread, or adopt an
 *   unassigned open thread (the customer was just prompted for a code), else start one.
 * - No merchant code: continue the customer's most recent open thread if any,
 *   otherwise open an unassigned thread and prompt them for the business code.
 */
async function selectConversation(db, customerId, merchant) {
  if (merchant) {
    // Existing open thread for this exact (customer, merchant) pair?
    const open = await db.query(
      `SELECT id FROM conversations
        WHERE customer_id = $1 AND merchant_id = $2 AND status != 'RESOLVED'
        ORDER BY created_at DESC LIMIT 1`,
      [customerId, merchant.id]
    );
    if (open.rows.length > 0) {
      return { conversationId: open.rows[0].id, merchantId: merchant.id, promptForCode: false };
    }

    // Adopt a still-unassigned open thread (customer replied with the code after a prompt).
    const unassigned = await db.query(
      `SELECT id FROM conversations
        WHERE customer_id = $1 AND merchant_id IS NULL AND status != 'RESOLVED'
        ORDER BY created_at DESC LIMIT 1`,
      [customerId]
    );
    if (unassigned.rows.length > 0) {
      await db.query(
        `UPDATE conversations
            SET merchant_id = $2,
                response_deadline = now() + ($3 || ' hours')::interval
          WHERE id = $1`,
        [unassigned.rows[0].id, merchant.id, merchant.response_window_hours ?? 48]
      );
      return { conversationId: unassigned.rows[0].id, merchantId: merchant.id, promptForCode: false };
    }

    // Start a fresh thread for this merchant.
    const created = await db.query(
      `INSERT INTO conversations (customer_id, merchant_id, status, response_deadline)
       VALUES ($1, $2, 'NEW', now() + ($3 || ' hours')::interval)
       RETURNING id`,
      [customerId, merchant.id, merchant.response_window_hours ?? 48]
    );
    return { conversationId: created.rows[0].id, merchantId: merchant.id, promptForCode: false };
  }

  // No merchant code present — continue any open thread, else open an unassigned one.
  const anyOpen = await db.query(
    `SELECT id, merchant_id FROM conversations
      WHERE customer_id = $1 AND status != 'RESOLVED'
      ORDER BY created_at DESC LIMIT 1`,
    [customerId]
  );
  if (anyOpen.rows.length > 0) {
    return {
      conversationId: anyOpen.rows[0].id,
      merchantId: anyOpen.rows[0].merchant_id,
      promptForCode: false,
    };
  }

  const created = await db.query(
    `INSERT INTO conversations (customer_id, status) VALUES ($1, 'NEW') RETURNING id`,
    [customerId]
  );
  return { conversationId: created.rows[0].id, merchantId: null, promptForCode: true };
}

function ackMessage({ promptForCode, merchant }) {
  if (promptForCode) {
    return "Thanks for reaching out. Which business is this about? Reply with the code shown at checkout (e.g. MARIO123) so we can route this to them.";
  }
  if (merchant && merchant.status !== 'CLAIMED') {
    // Holding-queue case: the business hasn't claimed VentText yet.
    return "Got it — we've logged your complaint and are notifying the business. They'll follow up once they respond.";
  }
  return "Got it — we're on it. We'll follow up shortly.";
}
