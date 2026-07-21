# VentText Backend — Wiring Guide

This turns the static VentText site into a real, working system: customer texts land in a database, and a merchant can reply back out.

---

## What's in this folder

```
venttext-backend/
├── package.json
├── schema.sql                      -- run this once against your database
└── api/
    ├── _lib/
    │   ├── db.js                   -- shared Postgres connection
    │   └── twilio.js               -- shared Twilio client
    ├── webhook/
    │   ├── sms-inbound.js          -- receives customer texts
    │   └── sms-status.js           -- tracks delivery status
    └── merchant/
        └── reply.js                -- merchant dashboard sends a reply
```

Because these live in an `/api` folder, **Vercel automatically turns each file into a live serverless endpoint** the moment you deploy — no extra configuration needed. `api/webhook/sms-inbound.js` becomes `https://venttext.com/api/webhook/sms-inbound` automatically.

---

## Step 1 — Add these files to your existing VentText repo

Same upload flow you already know: drag the `api/` folder, `package.json`, and `schema.sql` into the `DSangHub/VentText` repo alongside your existing `index.html` etc. GitHub's upload allows nested folders when dragged from a real (extracted) folder, so the `api/webhook/` and `api/merchant/` structure will preserve correctly.

Commit it. Vercel will auto-redeploy, and now your project has both the static site **and** live API endpoints.

---

## Step 2 — Get a database

You need somewhere for `schema.sql` to actually create tables. Two easy options that connect cleanly to Vercel:

- **Vercel Postgres** — click "Storage" in your Vercel project → Create Database → Postgres. Vercel automatically sets the `DATABASE_URL` environment variable for you.
- **Supabase** (generous free tier, slightly more setup) — create a project at supabase.com, copy the connection string from Settings → Database, and add it manually as an environment variable (see Step 3).

Once you have a database, run `schema.sql` against it — most providers have a "SQL Editor" in their dashboard where you can paste and run it directly.

---

## Step 3 — Set environment variables in Vercel

Go to your VentText project → **Settings → Environment Variables**, and add:

```
DATABASE_URL              (from Step 2, if not auto-set)
TWILIO_ACCOUNT_SID        (from Twilio Console)
TWILIO_AUTH_TOKEN         (from Twilio Console)
TWILIO_PHONE_NUMBER       (the number you bought, e.g. +18885551234)
PUBLIC_BASE_URL           https://venttext.com
```

Redeploy after adding these — environment variables only apply to deployments made after they're set.

---

## Step 4 — Point Twilio at your new webhook

In the Twilio Console:
1. Phone Numbers → Manage → Active Numbers → click your VentText number
2. Under "Messaging Configuration," find **"A message comes in"**
3. Set it to: `https://venttext.com/api/webhook/sms-inbound`
4. Method: **HTTP POST**
5. Save

Now, any text sent to that number hits your live serverless function.

---

## Step 5 — Test it

Text your VentText number from your own phone. You should:
1. See a message come back ("Got it — we're on it...") within a few seconds
2. Check your database — a row should exist in `customers`, `conversations`, and `messages`

If nothing happens, check the Vercel project's **Logs** tab (real-time function logs) for errors — most common first-run issues are a missing environment variable or the database tables not existing yet.

---

## What's intentionally left as TODO

This is a working starting point, not a finished product. Before this goes anywhere near real customers:

- **Merchant identification** — `sms-inbound.js` currently doesn't determine *which merchant* a text is for. That's the Option A/B routing decision from the architecture doc — needs to be built in before this is usable with more than one merchant.
- **Authentication** on `merchant/reply.js` — right now anyone who finds that URL could send a text as if they were the merchant. Needs a real session/auth check before deploying for real.
- **Real-time push to the dashboard** — the inbound webhook has a `// TODO` where a Pusher/Ably event should fire so new messages appear live, instead of the merchant having to refresh.
- **Rate limiting, sentiment scoring, receipt verification** — the pipeline steps from the architecture doc aren't implemented yet, just noted as the next things to add.
- **The merchant dashboard itself** — this scaffold only builds the API layer. There's no actual UI yet for a merchant to see and reply to threads.

Reasonable next step: pick one of those TODOs and build it out next, rather than all at once.
