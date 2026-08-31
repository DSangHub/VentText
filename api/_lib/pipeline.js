// api/_lib/pipeline.js
// The quick pre-human pipeline from the architecture doc (step 5):
// rate limiting, severity scoring, and receipt verification.
//
// Rate limiting and severity are fully implemented with no external services.
// Receipt verification (Reseats) is left as a documented stub because it needs a
// third-party integration you haven't picked yet.

const RATE_WINDOW_MINUTES = Number(process.env.RATE_WINDOW_MINUTES || 1);
const RATE_MAX_MESSAGES = Number(process.env.RATE_MAX_MESSAGES || 5);

/**
 * Simple DB-based rate limit: how many inbound messages this customer has sent
 * to this merchant within the recent window. Returns { limited, count }.
 * Counts messages, so it works across serverless invocations with no extra infra.
 */
export async function checkRateLimit(db, conversationId) {
  const r = await db.query(
    `SELECT count(*)::int AS c
       FROM messages
      WHERE conversation_id = $1
        AND direction = 'inbound'
        AND created_at > now() - ($2 || ' minutes')::interval`,
    [conversationId, RATE_WINDOW_MINUTES]
  );
  const count = r.rows[0].c;
  return { limited: count > RATE_MAX_MESSAGES, count };
}

// Lightweight keyword severity scoring (0-100). This is a transparent heuristic
// meant as a starting point / extension seam — swap in a real sentiment model or
// an LLM call here later without changing any callers.
const SEVERITY_KEYWORDS = [
  { re: /\b(sick|ill|vomit|poison|allerg|hospital|ambulance|injur|hurt|unsafe|dangerous)\b/i, weight: 40 },
  { re: /\b(rude|disrespect|insult|discriminat|racist|harass)\b/i, weight: 30 },
  { re: /\b(refund|charged|overcharged|scam|fraud|stolen|money back)\b/i, weight: 20 },
  { re: /\b(dirty|cold|wrong|late|slow|rude|broken|stale|spoiled|hair)\b/i, weight: 10 },
  { re: /\b(never again|worst|terrible|awful|disgusting|furious|angry|unacceptable)\b/i, weight: 15 },
  { re: /[A-Z]{6,}/, weight: 5 }, // shouting
];

/** Score 0-100. Higher = more severe / more likely to need escalation. */
export function scoreSeverity(body) {
  if (!body) return 0;
  let score = 0;
  for (const { re, weight } of SEVERITY_KEYWORDS) {
    if (re.test(body)) score += weight;
  }
  return Math.min(100, score);
}

/**
 * Receipt verification via Reseats (architecture doc step 5).
 * STUB: needs the Reseats API. Returns { verified:false, source:null } for now so
 * the pipeline runs end-to-end. Implement the real lookup here when ready.
 */
export async function verifyReceipt(/* phone, merchantId */) {
  return { verified: false, source: null };
}
