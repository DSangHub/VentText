# VentText launch audit — October 20, 2026

**Decision: not ready for a full public launch.** Core storage and protected routes exist, but several advertised functions are incomplete and live provider delivery remains unverified. A manually supervised pilot requires a verified business, a newly issued private dashboard key, confirmed SMS opt-in, and successful phone/receipt tests first.

## Verified evidence

| Function | Finding |
| --- | --- |
| Deployment | Main deployment passed Vercel; public home and report pages respond. |
| Database | Private Supabase schema is reachable. App role has SELECT/INSERT/UPDATE on all four core tables; security advisors report no lints. |
| Business signup | Valid live POST returned 201 and persisted one PENDING profile in Supabase. SMS consent was false; the test avoided Google lookup and sent no SMS. The temporary row was removed. Empty signup returns 400. |
| API authorization | Unauthenticated inbox, messages, and reply requests return 401. Photo endpoint authorization and ownership are covered by automated tests. |
| Inbound webhook | An unsigned request returns 403. Real incoming SMS was previously stored; latest stored message is September 30. |
| Receipt reader | Nine automated cases cover extraction, media access, size bounds, provider errors, token ownership, and confirmation. No production receipt uploads exist, so OCR/phone behavior is unverified. |
| Security tests | Four additional cases cover signed status updates, rejection of unsigned callbacks, demo credential rejection, and invalid/cross-merchant reply attempts. All 13 tests pass. |
| Dependencies | Patched Axios, follow-redirects, and qs within existing semver ranges. npm production audit reports zero vulnerabilities at audit time. |

## Security fixes delivered by this audit

- Revoked the active, publicly documented demo dashboard credential directly in Supabase. Authentication also rejects that credential, and the old migration no longer seeds it.
- Delivery-status callbacks now require a valid Twilio signature, a valid message SID and known status, and update outbound records only. The original live endpoint accepted an unsigned synthetic status callback (zero real records affected).
- Escaped customer names and delivery/status fields in dashboard HTML to prevent stored script injection.
- Stopped logging message payloads when realtime is disabled. Pusher messages now use private channels; the browser continues using authenticated polling.
- Limited merchant replies to valid conversation UUIDs and nonempty strings of at most 1,600 characters.

## Remaining launch blockers and gaps

| Area | Required before treating it as ready |
| --- | --- |
| Customer signup | `join.html` only changes browser content; it does not call an API or save a signup/consent record. Replace the false success flow with real enrollment or a clearly labeled direct-SMS flow. |
| Business access | Signup creates PENDING records. There is no staff approval/invitation API, email verification, password login, or password recovery. The current dashboard requires manually issued bearer keys after business verification. No active real-business dashboard keys were demonstrated in this audit. |
| Anonymous signup abuse | Public merchant signup can request a confirmation SMS without account verification or an atomic sender/mobile throttle. Add abuse controls before opening it broadly. |
| Customer follow-up routing | Plain follow-up texts without a code are kept unassigned, even after an assigned conversation. A bare checkout code alone also fails the parser. Complete and test conversation continuation without reviving an old or ambiguous business thread. |
| Receipt/Google activation | Confirm Cloud Vision and Places are enabled, the production key restrictions permit both, and a real photo can be downloaded/read/confirmed/matched. Existing mock tests do not establish this. |
| Business alerts | Production has zero SMS-confirmed businesses. Test opt-in, merchant alert delivery, STOP/START/HELP behavior, and a dashboard reply on consenting test phones. HELP is not currently a dedicated command handler; STOP handling covers only the exact word in app state. |
| Receipt authenticity | OCR reads a business header; `verifyReceipt()` remains a stub. There is no live POS/Reseats transaction verification. Do not market OCR as proof of purchase. |
| Coupons/credits | Schema fields exist, but automatic coupon decisions, issuance, spend caps, redemption, and resolution APIs are not implemented. |
| Follow-ups/escalation | Deadlines are saved, but there is no overdue reminder/escalation job. |
| Paid plans | No subscription checkout, payment webhook, or plan enforcement exists despite advertised paid pricing. |
| Public promises | Pages still claim OTP verification, automated coupons, POS matching, spend controls, and overdue follow-ups. Implement these or remove/label the claims before launch. |
| Provider visibility | Connected Vercel account cannot locate `county-count/vent-text` (404; scoped project search empty). Production env values, runtime logs, Google API restrictions, Twilio registration/webhook configuration, and current SMS delivery could not be inspected. Restore the correct Vercel account/team access. |

## Launch acceptance test

1. Verify one real business and issue its private dashboard key. Confirm it can read only its own inbox and receipt photos.
2. On consenting test phones: register/confirm business alerts; send a checkout-code complaint; continue the conversation; reply from dashboard; verify delivered status and STOP/START/HELP.
3. Send a real receipt with a complaint caption; confirm the detected details; verify the exact business assignment and photo access. Confirm unreadable/ambiguous photos do not route.
4. Finish or remove each advertised paid/automatic feature, then repeat the relevant production flow. No real outbound SMS was sent by this audit.
