import { authUrl, authKey } from '../../auth-config.js';

// The Auth service verifies the session and email; never authorize using user_metadata.
export async function authenticatedBusinessUser(req, fetcher = fetch) {
  const token = String(req.headers?.authorization || '').match(/^Bearer (.+)$/i)?.[1];
  if (!token || token.length > 8192 || token.split('.').length !== 3) return null;
  const response = await fetcher(`${authUrl}/auth/v1/user`, {
    headers: { apikey: authKey, Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) return null;
  const user = await response.json();
  return /^[0-9a-f-]{36}$/i.test(user.id) && user.email_confirmed_at && user.email && !user.is_anonymous ? user : null;
}
