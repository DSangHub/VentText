# VentText — SMS-to-Chat Architecture

How a customer's text lands as a live, resolvable thread in a merchant's "Bad Experience" chat inbox.

---

## The Core Components

| Layer | Role | Likely tool |
|---|---|---|
| SMS Gateway | Sends/receives the actual text messages | Twilio (Programmable Messaging) |
| Backend API | Receives webhooks, runs business logic, sends replies | Node/Express, Python/FastAPI, Rails — any |
| Database | Stores merchants, customers, conversations, messages | Postgres |
| Real-time layer | Pushes new messages into the dashboard instantly | Pusher, Ably, or Socket.io |
| Background jobs | Rate limiting, SLA timeouts, escalation reminders | BullMQ, Sidekiq, or a simple cron |
| Merchant Dashboard | Where merchants see and reply to threads | Your web app frontend |

---

## Step-by-step path

### 1. Customer texts in
They send a message to your VentText number (or a merchant-specific number/extension — see the numbering decision below).

### 2. Twilio receives it, fires a webhook
Twilio doesn't store or route messages for you — it just forwards every inbound message to a webhook URL you configure, e.g.:
```
POST https://api.venttext.com/webhook/sms/inbound
```
The payload includes the sender's number (`From`), your number (`To`), and the message body (`Body`).

### 3. Backend identifies the conversation
This is the key routing decision. Your backend checks: **does an open conversation already exist for this phone number + merchant pair?**
- **If yes** (customer already mid-conversation): append the message to that existing thread.
- **If no** (first message): create a new Conversation record.

### 4. Identifying *which merchant* this is for
Two architectural options:

**Option A — Dedicated number per merchant**
Each merchant gets their own VentText number or extension. Simple routing: whichever number was texted *is* the merchant. Cleaner, but costs more (Twilio charges per number) and doesn't scale cheaply to thousands of small merchants.

**Option B — Shared number + embedded merchant ID**
One central VentText number for everyone. The merchant is identified from context on the *first* message — e.g., a QR code at checkout opens the SMS app pre-filled with `"MARIO123 - "` as a prefix, or a deep link passes a merchant code your backend parses out before the customer even types anything.

Most complaint-routing products at your stage use **Option B** — one number, context-based routing — since it's dramatically cheaper to operate as you add merchants. Worth confirming this is the direction before building.

### 5. The message runs through a quick pipeline
Before it ever reaches a human, the backend:
- Checks rate limits (has this number complained to this merchant recently?)
- Runs sentiment/severity scoring
- Checks Reseats for a matching receipt tied to that phone number
- Stores the message in the `messages` table, linked to the `conversation`

### 6. Real-time push to the dashboard
This is what makes it feel like a live chat instead of an email inbox. The backend publishes an event ("new_message", conversation_id) to a real-time channel. The merchant's dashboard is subscribed to that channel and updates instantly — no refresh needed, the same way Slack or Intercom messages appear live.

### 7. Merchant replies
The merchant types a reply directly in the dashboard. This hits your backend, which calls Twilio's API to send that text back out to the customer's phone. From the customer's side, it just looks like a normal text conversation — they never see "dashboard," just replies coming from the same number they texted.

### 8. Resolution or escalation
- If the complaint qualifies for **auto-resolution** (verified, under the merchant's coupon ceiling), the backend can skip the "wait for a human" step entirely and fire the coupon immediately.
- If it needs a human and the merchant doesn't respond within the agreed SLA window, a background job fires the escalation text to the customer and flags the thread in the dashboard as overdue.
- Once resolved, the conversation is marked `RESOLVED` and moves out of the active inbox.

---

## Why this shape works

- **The customer never leaves texting.** Every step — vent, verify, resolve — happens in their normal SMS app. No login, no app download.
- **The merchant gets a real inbox, not raw text messages.** The dashboard is where the actual "chat" UI lives, threaded, searchable, with status and SLA tracking — SMS is just the transport layer underneath it.
- **The real-time layer is what makes it feel alive.** Without it, this would just be an email-like system with a refresh button. WebSockets/Pusher are what make a new complaint *pop up* the moment it's texted in.

---

## Open decision before building
**Option A vs. B on merchant identification** is the one architectural fork that meaningfully changes cost and complexity as you scale past a handful of pilot merchants. Worth deciding before writing any code — switching later means migrating every merchant's routing setup.
