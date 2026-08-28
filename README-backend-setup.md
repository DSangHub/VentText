# VentText Backend — Wiring Guide

This turns the static VentText site into a real, working system: customer texts land in a database, get routed to the right merchant, and a merchant can see and reply to threads from a live dashboard.

---

## What's in this folder

```
venttext-backend/
├── package.json
├── schema.sql                      -- run this once against a fresh database
├── migrations/
│   └── 002_twilio_connect.sql      -- run this instead if you already ran schema.sql before
├── dashboard.html                  -- merchant inbox UI (view threads + reply)
└── api/
    ├── _lib/
    │   ├── db.js                   -- shared Postgres connection
    │   ├── twilio.js               -- shared Twilio client
    │   ├── merchants.js            -- Option B routing: parse/resolve merchant code
    │   ├── auth.js                 -- merchant API-key authentication
    │   ├── pipeline.js             -- rate limiting + severity scoring (receipt = stub)
    │   └── realtime.js             -- Pusher push (no-ops safely if unconfigured)
    ├── webhook/
    │   ├── sms-inbound.js          -- receives customer texts, routes + stores them
    │   └── sms-status.js           -- tracks delivery status
    └── merchant/
        ├── reply.js                -- merchant sends a reply (authenticated)
        ├── conversations.js        -- dashboard inbox list (authenticated)
        └── messages.js             -- one conversation's full thread (authenticated)
```

Because these live in an `/api` folder, **Vercel automatically turns each file into a live serverless endpoint** the moment you deploy — no extra configuration needed. `api/webhook/sms-inbound.js` becomes `https://venttext.com/api/webhook/sms-inbound` automatically.

---

## How routing works (Option B — one shared number)

VentText uses a single shared number for every merchant. The merchant is identified from a **short code on the customer's first text** — e.g. a QR code at checkout opens the SMS app pre-filled with `MARIO123 - `.

- First message starts with a **known code** → routed to that merchant.
- First message starts with an **unknown code** → a lightweight `UNCLAIMED` merchant listing is auto-created so nothing is lost (the "holding queue" from the claim-flow doc), and it can be claimed later.
- **No code** and no open thread → VentText replies asking which business it's about; when the customer replies with the code, that same thread is adopted and routed.
- Follow-up messages continue the existing open thread automatically.

Each inbound message also runs a quick pipeline before a human sees it: a **DB-based rate limit** (per customer+merchant) and a transparent **keyword severity score** (0–100) stored on the conversation. Reseats receipt verification is stubbed in `pipeline.js` until you pick that integration.

---

## Step 1 — Add these files to your existing VentText repo

If you're merging the PR/branch this came from, you're done — skip to Step 2. Otherwise drag the `api/` folder, `migrations/`, `package.json`, `schema.sql`, and `dashboard.html` into the `DSangHub/VentText` repo alongside your existing `index.html`. Commit it; Vercel auto-redeploys.

---

## Step 2 — Get a database and create the tables

You need somewhere for the schema to create tables. Two easy options that connect cleanly to Vercel:

- **Vercel Postgres** — Storage → Create Database → Postgres. Vercel sets `DATABASE_URL` for you.
- **Supabase** — create a project, copy the connection string from Settings → Database, and add it as an env var in Step 3.

Then, in your provider's SQL editor:

- **Fresh database:** paste and run `schema.sql`.
- **You already ran the old `schema.sql` before:** run `migrations/002_twilio_connect.sql` instead — it adds the new `api_key` column and indexes, and seeds a demo merchant.

---

## Step 3 — Set environment variables in Vercel

Go to your VentText project → **Settings → Environment Variables**:

```
DATABASE_URL              (from Step 2, if not auto-set)
TWILIO_ACCOUNT_SID        (from Twilio Console)
TWILIO_AUTH_TOKEN         (from Twilio Console)
TWILIO_PHONE_NUMBER       (the number you bought, e.g. +18885551234)
PUBLIC_BASE_URL           https://venttext.com

# Optional — real-time dashboard push (leave unset to fall back to polling)
PUSHER_APP_ID
PUSHER_KEY
PUSHER_SECRET
PUSHER_CLUSTER

# Optional — rate-limit tuning (defaults: 5 messages / 1 minute)
RATE_MAX_MESSAGES         5
RATE_WINDOW_MINUTES       1
```

Redeploy after adding these — env vars only apply to deployments made after they're set.

---

## Step 4 — Point Twilio at your webhook

In the Twilio Console:
1. Phone Numbers → Manage → Active Numbers → click your VentText number
2. Under "Messaging Configuration," find **"A message comes in"**
3. Set it to: `https://venttext.com/api/webhook/sms-inbound`
4. Method: **HTTP POST**
5. Save

The webhook verifies Twilio's signature on every request, so only genuine Twilio traffic is accepted (this relies on `PUBLIC_BASE_URL` exactly matching your public URL).

---

## Step 5 — Test the customer side

Text your VentText number with a merchant code first, e.g. `MARIO123 - my order was cold`. You should:
1. Get a reply within a few seconds.
2. See rows appear in `customers`, `conversations`, and `messages`, with the conversation's `merchant_id` set and a `severity_score` filled in.

If nothing happens, check the Vercel **Logs** tab — the most common first-run issues are a missing env var or the tables not existing yet.

---

## Step 6 — Log into the merchant dashboard

Open `https://venttext.com/dashboard.html` and enter a merchant's **API key**. If you ran the migration, a demo merchant exists:

```
code:    MARIO123
api_key: vt_live_demo_change_me   ← change this before production
```

You'll see the inbox of open complaints, can open a thread, and reply — each reply goes out as an SMS to the customer from your VentText number. The dashboard polls every 10 seconds; set the `PUSHER_*` vars for instant push instead.

Issue a real API key per merchant when they claim their business, e.g.:

```sql
UPDATE merchants
   SET api_key = 'vt_live_' || encode(gen_random_bytes(16), 'hex'),
       status  = 'CLAIMED'
 WHERE merchant_code = 'MARIO123';
```

---

## What's implemented vs. still TODO

**Implemented now:**
- Merchant identification & routing (Option B), including auto-seeded unclaimed listings and the "prompt for code" fallback.
- Authentication on every `merchant/*` endpoint (per-merchant API key; a merchant can only see/reply to their own threads).
- Rate limiting and severity scoring in the inbound pipeline.
- Real-time push abstraction (Pusher when configured; safe no-op otherwise).
- A working merchant dashboard (inbox list, thread view, reply).

**Still TODO (need external services or product decisions):**
- **Receipt verification** — `pipeline.js` `verifyReceipt()` is a stub until the Reseats integration is chosen.
- **Auto-resolution / coupon issuing** — the schema supports it (`coupon_ceiling_cents`, `coupon_issued_cents`); the decision logic isn't built.
- **SLA escalation job** — `response_deadline` is set on each conversation, but nothing yet fires the overdue-escalation text; add a cron/background job.
- **Full merchant auth/login** — the API-key scheme is real but minimal; swap `auth.js` for a session/login system when you build merchant accounts. The claim/verification flow (SMS/email code) from the claim-flow doc still needs building.
