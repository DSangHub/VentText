// Server-side Google Vision OCR. Receipt text is reduced to business details;
// item lists, totals, payment numbers, and full OCR text are not retained.
const MAX_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const STATES = '(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)';
const cityPattern = new RegExp(`^[a-z][a-z .'-]{1,60},?\\s+${STATES}(?:\\s+\\d{5}(?:-\\d{4})?)?$`, 'i');
const streetPattern = /^\d{1,6}\s+.+\b(?:st|street|ave|avenue|blvd|boulevard|rd|road|dr|drive|ln|lane|way|pkwy|parkway|hwy|highway|ct|court|pl|place)\b/i;
const clean = value => String(value || '').replace(/[\x00-\x1f|]/g, ' ').replace(/\s+/g, ' ').trim();

export function extractReceiptBusiness(text) {
  const raw = String(text || '').slice(0, 12000);
  // Only an explicitly labeled VentText code is accepted, never an order ID.
  const code = raw.match(/\bVENTTEXT\s+(?:BUSINESS\s+)?CODE\s*[:#-]?\s*(VT[A-F0-9]{16})\b/i);
  if (code) return { code: code[1].toUpperCase() };
  const lines = raw.split(/\r?\n/).map(clean).filter(Boolean).slice(0, 18);
  const streetIndex = lines.findIndex(line => streetPattern.test(line));
  if (streetIndex < 1 || streetIndex > 8) return null;
  const city = lines.slice(streetIndex + 1, streetIndex + 4).find(line => cityPattern.test(line));
  if (!city) return null;
  const names = lines.slice(0, streetIndex).filter(line =>
    line.length >= 2 && line.length <= 120 && /[a-z]/i.test(line) && !/\d/.test(line) &&
    !/^(?:welcome|thank|receipt|customer|copy|order|store|tel|phone|www\.|https?:|merchant|sale|cashier|date)\b/i.test(line)
  );
  if (!names.length || names.length > 2) return null;
  const name = names.join(' ');
  const address = clean(`${lines[streetIndex]}, ${city}`);
  return name.length <= 120 && address.length <= 160 ? { name, address } : null;
}

async function boundedImage(response) {
  const type = (response.headers.get('content-type') || '').split(';')[0].toLowerCase();
  if (!IMAGE_TYPES.has(type)) throw new Error('unsupported_image');
  if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('image_too_large');
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BYTES) throw new Error('image_too_large');
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); }
  if (!length) throw new Error('empty_image');
  return { data: Buffer.concat(chunks), contentType: type };
}

export async function downloadReceiptImage({ mediaUrl, messageSid }, fetcher = fetch) {
  const account = process.env.TWILIO_ACCOUNT_SID;
  if (!/^AC[a-f0-9]{32}$/i.test(account || '') || !/^(SM|MM)[a-f0-9]{32}$/i.test(messageSid || '')) throw new Error('invalid_media');
  const url = new URL(mediaUrl);
  const expected = `/2010-04-01/Accounts/${account}/Messages/${messageSid}/Media/`;
  if (url.origin !== 'https://api.twilio.com' || url.username || url.password || url.search || url.hash ||
      !url.pathname.startsWith(expected) || !/^ME[a-f0-9]{32}$/i.test(url.pathname.slice(expected.length))) throw new Error('invalid_media');
  const username = process.env.TWILIO_API_KEY_SID || account;
  const password = process.env.TWILIO_API_KEY_SECRET || process.env.TWILIO_AUTH_TOKEN;
  if (!password) throw new Error('media_unavailable');
  const media = await fetcher(url.href, {
    headers: { Authorization: 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64') },
    redirect: 'error', signal: AbortSignal.timeout(3000),
  });
  if (!media.ok) throw new Error('media_unavailable');
  return boundedImage(media);
}

export async function readReceipt({ mediaUrl, messageSid, contentType }, fetcher = fetch) {
  const key = process.env.GOOGLE_VISION_API_KEY || process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return { status: 'unavailable' };
  if (!IMAGE_TYPES.has(String(contentType || '').toLowerCase())) return { status: 'unsupported' };
  try {
    // Do not follow redirects or forward Twilio credentials to another host.
    const { data } = await downloadReceiptImage({ mediaUrl, messageSid }, fetcher);
    const content = data.toString('base64');
    const response = await fetcher('https://vision.googleapis.com/v1/images:annotate', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key },
      body: JSON.stringify({ requests: [{ image: { content }, features: [{ type: 'DOCUMENT_TEXT_DETECTION' }] }] }),
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) return { status: 'unavailable' };
    const result = (await response.json()).responses?.[0];
    if (!result || result.error) return { status: 'unavailable' };
    const business = extractReceiptBusiness(result.fullTextAnnotation?.text || result.textAnnotations?.[0]?.description);
    return business ? { status: 'needs_confirmation', business } : { status: 'unreadable' };
  } catch (error) {
    return { status: ['unsupported_image', 'image_too_large', 'empty_image'].includes(error.message) ? 'unsupported' : 'unavailable' };
  }
}
