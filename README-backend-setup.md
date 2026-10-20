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
- Code-less follow-ups currently need explicit business routing; see `LAUNCH-READINESS.md`.

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
- **You already ran the old `schema.sql` before:** run `migrations/002_twilio_connect.sql` instead — it adds the new `api_key` column and indexes, and revokes the former public demo credential.

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

Open `https://www.venttext.com/merchant-signup.html`. Business managers create an email/password account with Supabase Auth, confirm their email, and sign in. Enter the exact Google Maps business name, full address, contact person and publicly listed US phone. Explicitly request a verification text or call (calls support landlines), then enter the six-digit code within ten minutes. The verified account connects to the matching merchant record and receives dashboard access automatically. Existing complaints remain attached to that merchant. Businesses already owned by another account require a transfer; the API never silently replaces an owner.

Customers do not register. They text complaints and receipt photos directly; `join.html` now explains the direct-SMS flow.

### One-time business account activation

1. Apply `006_business_accounts.sql` and `007_business_server_policies.sql` in order. Both have been applied to the VentText Supabase project. The backend login needs the specified table grants and RLS policies; browser roles have no access to claim challenges.
2. In Supabase **Authentication → URL Configuration**, set Site URL to `https://www.venttext.com` and add the exact redirect `https://www.venttext.com/merchant-signup.html`. Keep email confirmation enabled. Configure production SMTP in **Authentication → Email**; Supabase's built-in mail sender is for testing and may restrict recipients. These settings were not accessible through the connected management tools and must be checked before launch.
3. Enable Google Places API (New), billing, Text Search and Place Details access for the server key. Place Details uses the `internationalPhoneNumber` field solely for a temporary comparison with the applicant's supplied number. Only the Place ID and applicant-entered profile are stored.
4. Existing Twilio account credentials and sender are used for explicitly requested verification texts/calls. Confirm the sender can make voice calls for landlines. No Twilio Verify service or new private environment variable is required.
5. Test with one consenting business: confirmation email, sign-in, code text/call, code verification, inbox access, password reset, and isolation from a second account. No real messages or calls were sent by the automated tests.

Public Supabase settings are in `auth-config.js`; they intentionally contain only a publishable key. Passwords stay with Supabase Auth. Browser sessions refresh with the locally bundled official Supabase SDK. Rebuild with `npm ci && npm run build:auth` after changing SDK versions. The bundle is committed, so publishing does not depend on a build-time secret. The backend verifies tokens with Supabase Auth and authorizes using `merchants.owner_auth_user_id`, never user-editable metadata.

Challenges are salted hashes, expire in ten minutes, allow five attempts, and are consumed under a database row lock. Persistent limits allow at most one request per minute per account, five per hour per account, three per hour per phone and 100 per hour globally, including failed lookups. Applicants cannot reserve a location before verification. Existing legacy API keys remain accepted for compatibility, but new dashboard access uses business sessions.


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
- **Business account activation tests** — confirm production SMTP, redirect configuration, and real Google/Twilio verification with an authorized business before launch.

## Receipt photo reading (Google Cloud Vision)

Enable **Cloud Vision API** with billing in the Google Cloud project. Add a server-only Production secret `GOOGLE_VISION_API_KEY` restricted to Cloud Vision API, then redeploy. The reader can alternatively reuse `GOOGLE_PLACES_API_KEY` if its Google API restrictions allow both Cloud Vision API and Places API (New). A Places-only key cannot call OCR.

Apply `migrations/005_receipt_reading.sql` to the private `venttext` schema before deploying. It adds only receipt-derived business details/status on messages and prevents duplicate inbound Twilio SIDs. The existing app role needs its existing SELECT/INSERT/UPDATE grants on messages and conversations.

The customer sends a JPEG, PNG, or WebP photo under 5 MB to the VentText number with the complaint as a caption. The server authenticates the Twilio webhook, downloads only media belonging to that signed message from `api.twilio.com`, and runs `DOCUMENT_TEXT_DETECTION`. It keeps only a likely business name/address or explicitly labeled VentText code, never the full OCR text or payment data. There is a 3-photo/hour reading limit per sender.

The customer receives a confirmation such as `YES RECEIPT A1B2C3D4`, valid for 24 hours and only from the sender's phone. They can add ` - what happened`. After confirmation, Google Places must find one exact business/location match, or the OCR code must match an existing merchant. Uncertain results stay unassigned. This does **not** set `receipt_verified` or authorize a coupon. Unclaimed businesses still must join and verify; SMS notices still require confirmed opt-in.

Authenticated merchants can view receipt-derived details and load their own receipt photos from `/api/merchant/receipt`. Twilio credentials remain on the server. Dashboard photo viewing supports images up to 4 MB. OCR/provider failures leave the image saved and return a clear text fallback.

## Google business matching and merchant SMS notifications

Apply `migrations/003_google_business_notifications.sql` to the production VentText schema, then set
`GOOGLE_PLACES_API_KEY` as a **server-only** Vercel Production secret. Enable Places API (New) and billing
in the Google Cloud project, restrict the key to the Places API, and set a budget/usage quota. Redeploy.

Customers can text `BUSINESS: Business Name | City, State | what happened` when no merchant code is
available. A Google Places Text Search checks for one unambiguous business name and location match.
Only the Google Place ID is saved. The name and location in the merchant record come from the
customer's text, not Google content. If there is no exact match, the message is held unassigned
and the customer is asked to correct the business details. The key is optional: code routing still
works without it. Lookup is limited to three inbound messages per sender per hour.

Businesses opt in on the signup form with a separate unchecked SMS choice and a notification mobile
number distinct from the public business phone. Twilio sends a confirmation request to that mobile. A reply of `YES <code>` from that
same number enables a daily, generic notification when customer messages are waiting. `STOP`
withdraws consent. Google-listed phones are used for verification only after an authorized applicant explicitly requests a code at that supplied number. A public listing does not authorize complaint notifications. Business verification and dashboard access are automatic after email and phone confirmation; alerts still require separate opt-in.
Verify the Twilio sender's registration and campaign settings before sending US application texts.
