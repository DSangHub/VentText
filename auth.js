// api/_lib/auth.js
// Minimal, real merchant authentication for the dashboard API.
//
// Each merchant row has an `api_key` (a random secret generated when the
// business is claimed). The dashboard sends it as a Bearer token:
//
//     Authorization: Bearer vt_live_xxxxxxxx
//
// This is intentionally simple but NOT a no-op: an unauthenticated request, or
// one whose key doesn't match a claimed merchant, is rejected. When you add a
// full session/login system later, swap this one function out — every protected
// endpoint goes through it.

import { getMerchantByApiKey } from './merchants.js';

/** Extract the Bearer token from an incoming request, or null. */
export function getBearerToken(req) {
  const header = req.headers['authorization'] || req.headers['Authorization'];
  if (!header) return null;
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

/**
 * Authenticate a merchant from the request.
 * Returns the merchant row on success, or null if the caller should be rejected.
 * Only CLAIMED merchants may act (an unclaimed listing has no verified owner).
 */
export async function authenticateMerchant(req, db) {
  const token = getBearerToken(req);
  if (!token) return null;
  const merchant = await getMerchantByApiKey(db, token);
  if (!merchant) return null;
  if (merchant.status !== 'CLAIMED') return null;
  return merchant;
}
