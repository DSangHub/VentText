# Businesses without a Google Maps listing

At `/merchant-signup.html`, choose **My business is not on Google Maps / use another method**. A confirmed email account can save its business profile, contact person, address, US phone, HTTPS website and/or registration details. Saving does not send a message and does not require Google credentials. The signed-in owner can reopen the saved profile.

To continue, explicitly request a text or voice code at the business phone, enter the code, then **Submit business for review**. Text/call delivery uses the existing Twilio sender. The same persistent account, phone and global code-request limits apply to both Google and alternative verification. Codes expire in ten minutes, allow five attempts, and are consumed under a row lock. Code delivery and phone control are separate from approval of the business.

Statuses are `DRAFT`, `PHONE_VERIFIED`, `REVIEW_PENDING`, `APPROVED` and `REJECTED`. Every save replaces the applicant's evidence snapshot and resets phone verification and review. Pending/rejected profiles have no merchant inbox authorization. Applicants cannot approve themselves, select another applicant, or select an existing merchant's inbox. Website addresses are stored for human review, never fetched by the backend.

## Reviewer workflow

Use the **venttext.com** Supabase project and its SQL editor as a trusted database operator. This release uses a private database review queue, not a public admin page. Applicants see decisions and review notes on the signup page; no email notification of a decision is sent automatically.

```sql
select user_id, profile->>'name' as business_name, profile->>'address' as address,
       profile->>'email' as email, profile->>'website' as website,
       profile->>'registration' as registration, profile->>'notes' as notes,
       phone, phone_verified_at, submitted_at
from venttext.business_applications
where status='REVIEW_PENDING'
order by submitted_at;
```

Independently verify the business exists, the website or issuing authority supports the supplied details, and the applicant is authorized to manage it. A verified phone, website URL, or registration number alone is not proof of ownership. Do not approve fabricated/test businesses or unverifiable claims. Put the actual basis for the decision in the review note; notes are visible to the applicant.

Use the exact `user_id` returned by the queue; substitute it for `USER_ID_FROM_QUEUE` below. Approval creates a new merchant, a checkout code/QR and inbox authorization for that account, without requiring a Google Place ID:

```sql
select venttext.review_business_application(
  'USER_ID_FROM_QUEUE'::uuid,
  true,
  'Record the evidence actually checked and the reviewer decision here.'
);
```

If there are already complaints for the same real business, first inspect the existing merchant and independently verify the association. Pass its exact ID as the fourth parameter to attach that unclaimed inbox instead of creating a duplicate:

```sql
select venttext.review_business_application(
  'USER_ID_FROM_QUEUE'::uuid,
  true,
  'Record evidence supporting both ownership and this existing location.',
  'EXISTING_UNCLAIMED_MERCHANT_ID'::uuid
);
```

The function refuses to replace an existing owner or claimed business. It also refuses applications that are not submitted, have no phone proof, have no evidence, or whose confirmed email changed after submission. Application and ownership changes are atomic. Use a separate ownership-transfer process for already-owned businesses.

To reject or request corrections:

```sql
select venttext.review_business_application(
  'USER_ID_FROM_QUEUE'::uuid,
  false,
  'Explain what evidence is missing or could not be independently verified.'
);
```

After approval, the owner refreshes the signup page or signs in at `/dashboard.html`. Customers can use the new checkout code/QR even though the business is not on Google Maps. Receipt-to-Google routing still requires a Google match; unlisted businesses should distribute their VentText checkout code. The owner can send a goodwill coupon/discount in a dashboard reply and honor it manually at checkout; automatic coupon issuance and redemption are not implemented. This alternative path does not automatically subscribe the supplied phone to complaint alerts.

## Deployment and access

Apply `supabase/migrations/20261030211642_business_alternative_verification.sql` before deploying the API. The private application table has RLS and grants only the backend login access. The review function is `SECURITY INVOKER`, has a fixed search path, and grants execution only to `postgres`; `PUBLIC`, browser roles, the service role and `venttext_app` cannot execute it. There is no new secret or Google dependency for alternative signup.

Validation covers profile/evidence validation, owner isolation, explicit delivery consent, rate limits, failed sends, code expiry/reuse/guess limits, and keeping complaints locked before approval. A rollback-only database test exercises approval, rejection, email confirmation, linking an unclaimed inbox, and blocking takeover of an owned location. A mobile browser check covers save/reload, phone code/reload, submission/reload and the pending dashboard gate using mocked providers. No test email, SMS or call was sent.

A Supabase Auth advisor also reports leaked-password protection disabled; this is an Auth configuration setting, separate from application-table permissions.
