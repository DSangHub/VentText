# VentText — Merchant Pre-Seed & Claim Flow

Adapted from Yelp's model: businesses can exist in the database before they've ever logged in, and "claiming" is the verification step that unlocks control.

---

## Why pre-seed at all?

Without this, VentText only works for merchants who've actively signed up — which means a customer's very first complaint about a business that hasn't onboarded yet has nowhere to go. Pre-seeding closes that gap: a merchant record can exist, and start receiving/queuing complaints, before the owner has ever heard of VentText.

This also solves the "shared number, ID-based routing" problem cleanly — every merchant has a record and an ID the moment they're seeded, so a QR code or checkout prompt can reference them immediately, with no setup required on their end first.

---

## The two ways a merchant record gets created

**1. Pre-seeded from public data**
Business name, address, phone number, and category pulled from public business registries or licensing data — same approach Yelp uses. Status: `UNCLAIMED`.

**2. Self-added**
A customer or the merchant themselves adds a business that doesn't exist yet (e.g., texting a complaint about a business with no VentText record triggers a lightweight auto-created listing). Status: `UNCLAIMED`, flagged for light review before it's publicly routable.

---

## What happens with complaints for an unclaimed merchant

This is the part that makes pre-seeding actually useful instead of just a database of dead entries:

1. A complaint comes in for an unclaimed merchant.
2. It doesn't vanish — it goes into a **holding queue** tied to that merchant record.
3. VentText sends an automated notice to the phone number/email on file: *"A customer complaint is waiting for you on VentText — claim your business to respond."*
4. If the merchant claims their profile, every held complaint releases into their new dashboard at once.
5. If they never claim it, the complaint stays queued (with an expiry/escalation path back to the customer, same as the merchant-side timeout logic already designed).

This turns unanswered complaints into your best organic sales tool for merchant acquisition — a business owner's first contact with VentText can be "you have an unhappy customer waiting," which is a much stronger hook than a cold outreach email.

---

## The claim flow itself

1. **Merchant finds their listing** — either via the notification link, or by searching for their business name on VentText directly.
2. **Enter the phone number tied to the listing.**
3. **Verification code sent** via SMS or email to that number/address — proving they actually control it, not just claiming to.
4. **Match confirmed → status becomes `CLAIMED`.**
   - No match (e.g., business changed phone numbers since the record was seeded) → falls back to manual verification: business license upload, utility bill, or similar, reviewed by a human before approval.
5. **Once claimed**, the merchant sets up their actual dashboard controls — coupon ceiling, response SLA, POS integration — and any held complaints release immediately.

---

## Data model implication

Your merchant table needs a `status` field beyond just active/inactive:

```
UNCLAIMED   — pre-seeded or auto-created, no verified owner yet
PENDING     — claim started, verification in progress
CLAIMED     — verified owner, full dashboard access
```

Complaints table needs to reference merchant_id regardless of claim status, so nothing is lost while a merchant is unclaimed — it just sits in a different queue state until claimed.

---

## One risk worth flagging

Yelp has been criticized for listing businesses without permission and not always removing them on request. Since your product actively delegates coupon-issuing authority once claimed, pre-seeding is lower-risk than Yelp's model in one sense (an unclaimed merchant can't have coupons issued in their name — that only activates after verified claim). But you'll still want a clear, easy path for a business to say "I don't want a VentText listing at all" and have that respected, both for goodwill and to avoid the same reputation friction Yelp has faced.
