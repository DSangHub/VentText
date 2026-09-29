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
import { notifyMerchantIfSubscribed } from '../_lib/merchant-notifications.js';

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

  const { From: fromNumber, Body: inboundBody, MessageSid: sid, NumMedia } = req.body;
  const body = String(inboundBody || '');
  const mediaUrl = Number(NumMedia) > 0 ? req.body.MediaUrl0 : null;

  const db = getDb();

  try {
    // A business confirms the number it entered on the signup form by replying
    // from that number. STOP withdraws its notification consent.
    if (/^STOP\s*$/i.test(body.trim())) {
      await db.query(
        `UPDATE merchants SET sms_confirmed_at = NULL, sms_opted_out_at = now()
          WHERE sms_phone = $1 AND sms_consent_at IS NOT NULL`, [fromNumber]
      );
      return res.status(200).set('Content-Type', 'text/xml').send('<Response></Response>');
    }
    if (/^START\s*$/i.test(body.trim())) {
      const restarted = await db.query(
        `UPDATE merchants SET sms_opted_out_at = NULL, sms_confirmed_at = now()
          WHERE sms_phone = $1 AND sms_consent_at IS NOT NULL AND sms_opted_out_at IS NOT NULL
          RETURNING id`, [fromNumber]
      );
      for (const merchant of restarted.rows) {
        try { await notifyMerchantIfSubscribed(db, merchant.id); }
        catch (error) { console.error('Merchant notice failed:', error); }
      }
      return res.status(200).set('Content-Type', 'text/xml').send('<Response></Response>');
    }
    const confirmation = body.trim().match(/^YES\s+(VT[A-F0-9]{16})$/i);
    if (confirmation) {
      const updated = await db.query(
        `UPDATE merchants SET sms_confirmed_at = now(), sms_opted_out_at = NULL
          WHERE sms_phone = $1 AND merchant_code = $2 AND sms_consent_at IS NOT NULL
          RETURNING id`, [fromNumber, confirmation[1].toUpperCase()]
      );
      if (updated.rows.length) {
        await sendSms(fromNumber, 'VentText: Your business message notifications are on. Reply STOP to opt out.');
        try { await notifyMerchantIfSubscribed(db, updated.rows[0].id); }
        catch (error) { console.error('Merchant notice failed:', error); }
      }
      return res.status(200).set('Content-Type', 'text/xml').send('<Response></Response>');
    }

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
    let resolved = null;
    const structured = /^\s*BUSINESS:/i.test(body);
    try {
      if (structured) {
        // A real Twilio sender may still repeat requests; cap paid Google lookups.
        const recent = await db.query(
          `SELECT count(*)::int AS count FROM messages m
             JOIN conversations c ON c.id = m.conversation_id
             JOIN customers cu ON cu.id = c.customer_id
            WHERE cu.phone = $1 AND m.direction = 'inbound'
              AND m.created_at > now() - interval '1 hour'`, [fromNumber]
        );
        if (recent.rows[0].count < 3) resolved = await resolveMerchant(db, body);
      } else {
        resolved = await resolveMerchant(db, body);
      }
    } catch (error) { console.error('Merchant lookup failed:', error); }
    const merchant = resolved ? resolved.merchant : null;

    // 4. Pick the conversation to append to.
    const { conversationId, merchantId, promptForCode } =
      await selectConversation(db, customerId, merchant, structured && !merchant);

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
      try { await notifyMerchantIfSubscribed(db, merchantId); }
      catch (error) { console.error('Merchant notice failed:', error); }
    }

    // 8. Reply to the customer (unless rate-limited, to avoid a reply storm).
    if (!limited) {
      await sendSms(fromNumber, ackMessage({ promptForCode, merchant, body }));
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
async function selectConversation(db, customerId, merchant, forceUnassigned = false) {
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
  if (forceUnassigned) {
    const created = await db.query(
      `INSERT INTO conversations (customer_id, status) VALUES ($1, 'NEW') RETURNING id`,
      [customerId]
    );
    return { conversationId: created.rows[0].id, merchantId: null, promptForCode: true };
  }
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

function ackMessage({ promptForCode, merchant, body }) {
  if (promptForCode) {
    if (/^\s*BUSINESS:/i.test(body)) {
      return 'We saved your message but could not match that business. Please check the name and location, then text BUSINESS: Name | City, State | what happened.';
    }
    return 'Thanks for reaching out. Reply with the code shown at checkout, or text BUSINESS: Name | City, State | what happened.';
  }
  if (merchant && merchant.status !== 'CLAIMED') {
    return "Got it — we've logged your message. The business can respond after it joins and verifies its profile.";
  }
  return "Got it — we're on it. We'll follow up shortly.";
}
