import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { extractReceiptBusiness, readReceipt } from '../api/_lib/receipt-reader.js';
import { parseReceiptConfirmation, confirmReceipt } from '../api/_lib/receipt-flow.js';

const account = 'AC' + '1'.repeat(32);
const sid = 'MM' + '2'.repeat(32);
const mediaUrl = `https://api.twilio.com/2010-04-01/Accounts/${account}/Messages/${sid}/Media/ME${'3'.repeat(32)}`;
process.env.TWILIO_ACCOUNT_SID = account;
process.env.TWILIO_AUTH_TOKEN = 'test-auth-only';
process.env.GOOGLE_VISION_API_KEY = 'test-vision-only';

test('receipt header extraction excludes payment/item content and requires a location', () => {
  assert.deepEqual(extractReceiptBusiness("ROSA'S\nPIZZERIA\n123 N Blackstone Ave\nFresno, CA 93710\nVISA 1234\nTOTAL 19.95"), { name: "ROSA'S PIZZERIA", address: '123 N Blackstone Ave, Fresno, CA 93710' });
  assert.equal(extractReceiptBusiness('Receipt\nOrder 12345\nTotal 19.95'), null);
  assert.deepEqual(extractReceiptBusiness('VentText Code: VT1234567890ABCDEF\nOrder 78395'), { code: 'VT1234567890ABCDEF' });
});

test('authenticated media download then Vision OCR returns only a confirmation candidate', async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push([url, options]);
    if (calls.length === 1) return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } });
    return Response.json({ responses: [{ fullTextAnnotation: { text: "ROSA'S\n123 N Blackstone Ave\nFresno CA 93710\nCARD 1234" } }] });
  };
  const result = await readReceipt({ mediaUrl, messageSid: sid, contentType: 'image/jpeg' }, fetcher);
  assert.equal(result.status, 'needs_confirmation');
  assert.equal(result.business.name, "ROSA'S");
  assert.equal(calls[0][1].redirect, 'error');
  assert.match(calls[0][1].headers.Authorization, /^Basic /);
  assert.equal(calls[1][1].headers.Authorization, undefined);
  const payload = JSON.parse(calls[1][1].body);
  assert.equal(payload.requests[0].features[0].type, 'DOCUMENT_TEXT_DETECTION');
  assert(!JSON.stringify(result).includes('CARD'));
});

test('foreign/redirect media and unsupported files never receive credentials', async () => {
  let calls = 0;
  const fetcher = async () => { calls++; throw Error('no network expected'); };
  await readReceipt({ mediaUrl: 'https://example.com/receipt.jpg', messageSid: sid, contentType: 'image/jpeg' }, fetcher);
  await readReceipt({ mediaUrl, messageSid: 'MM' + '4'.repeat(32), contentType: 'image/jpeg' }, fetcher);
  await readReceipt({ mediaUrl, messageSid: sid, contentType: 'application/pdf' }, fetcher);
  assert.equal(calls, 0);
});

test('provider errors and unreadable photos fall back without assigning a business', async () => {
  let calls = 0;
  const fetcher = async () => ++calls === 1
    ? new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/png' } })
    : new Response('', { status: 403 });
  assert.deepEqual(await readReceipt({ mediaUrl, messageSid: sid, contentType: 'image/png' }, fetcher), { status: 'unavailable' });
  calls = 0;
  const noText = async () => ++calls === 1
    ? new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/png' } })
    : Response.json({ responses: [{}] });
  assert.deepEqual(await readReceipt({ mediaUrl, messageSid: sid, contentType: 'image/png' }, noText), { status: 'unreadable' });
});

test('receipt confirmations have a distinct token and accept complaint details', () => {
  assert.deepEqual(parseReceiptConfirmation('YES RECEIPT ABCD1234 - Food was cold'), { token: 'abcd1234', complaint: 'Food was cold' });
  assert.equal(parseReceiptConfirmation('YES VT1234567890ABCDEF'), null);
  assert.equal(parseReceiptConfirmation('YES RECEIPT'), null);
});

test('an expired or other-sender receipt token cannot assign or notify', async () => {
  const calls = [];
  const db = { query: async (query, args) => { calls.push([query,args]); return { rows: [] }; } };
  const result = await confirmReceipt(db, { customerId:'sender-only', confirmation:{token:'abcd1234'}, body:'YES RECEIPT ABCD1234', messageSid:sid });
  assert.match(result.reply, /expired/);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][1], ['sender-only','abcd1234']);
  assert.match(calls[0][0], /c.customer_id=\$1/);
  assert.match(calls[0][0], /24 hours/);
  assert.equal(result.merchantId, undefined);
});

test('confirmed existing code assigns the saved photo, retains caption, and never verifies purchase', async () => {
  const calls = [];
  const responses = [
    {rows:[{id:'abcd1234-0000-4000-8000-000000000000',conversation_id:'photo-thread',body:'Food was cold',receipt_business:{code:'VT1234567890ABCDEF'}}]},
    {rows:[{id:'reply-id'}]}, {rows:[{count:1}]},
    {rows:[{id:'business-id',name:"Rosa's",merchant_code:'VT1234567890ABCDEF',status:'CLAIMED'}]},
    {rows:[{id:'photo-thread'}]}, {rows:[]}, {rows:[]},
  ];
  const db = {query:async(q,a)=>{calls.push([q,a]);assert(responses.length);return responses.shift();}};
  const result = await confirmReceipt(db,{customerId:'sender',confirmation:{token:'abcd1234',complaint:''},body:'YES RECEIPT ABCD1234',messageSid:sid});
  assert.equal(result.merchantId,'business-id');
  assert.equal(result.conversationId,'photo-thread');
  assert.equal(result.notify,true);
  assert(!calls.some(([q])=>q.includes('receipt_verified')));
  assert(!calls.some(([q])=>q.includes('INSERT INTO merchants')));
  assert.match(result.reply,/dashboard/);
});

test('an oversized media response is rejected before an OCR charge', async () => {
  let calls = 0;
  const result = await readReceipt({mediaUrl,messageSid:sid,contentType:'image/jpeg'},async()=>{
    calls++;
    return new Response(new Uint8Array([1]),{headers:{'content-type':'image/jpeg','content-length':String(6*1024*1024)}});
  });
  assert.equal(result.status,'unsupported');
  assert.equal(calls,1);
});

test('dashboard photo access requires auth and enforces merchant ownership', async () => {
  const source = (await readFile(new URL('../api/merchant/receipt.js',import.meta.url),'utf8'))
    .replace(/^import .*;\n/gm,'').replace('export default async function handler','async function handler');
  let downloadCount=0;
  let merchant=null;
  const handler=new Function('getDb','authenticateMerchant','downloadReceiptImage',source+';return handler;')(
    ()=>({query:async(q,args)=>{assert.match(q,/c.merchant_id=\$2/);assert.equal(args[1],'merchant-owner');return {rows:[]};}}),
    async()=>merchant,
    async()=>{downloadCount++;throw Error('must not download');}
  );
  const req={method:'GET',query:{messageId:'abcd1234-0000-4000-8000-000000000000'}};
  const res={status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
  await handler(req,res);assert.equal(res.code,401);
  merchant={id:'merchant-owner'};
  await handler(req,res);assert.equal(res.code,404);
  assert.equal(downloadCount,0);
});
