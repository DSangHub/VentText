import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import twilio from 'twilio';
import { authenticateMerchant } from '../api/_lib/auth.js';

const token='test-signature-secret';
const base='https://example.test';
process.env.TWILIO_AUTH_TOKEN=token;
process.env.PUBLIC_BASE_URL=base;
const response=()=>({setHeader(){return this;},status(code){this.code=code;return this;},send(body){this.body=body;return this;},json(body){this.body=body;return this;},end(){return this;}});
const source=async(path)=>(await readFile(new URL('../'+path,import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace('export default async function handler','async function handler');

test('unsigned status callback cannot mutate delivery records',async()=>{
 let writes=0;
 const handler=new Function('getDb','twilio',await source('api/webhook/sms-status.js')+';return handler;')(()=>({query:async()=>{writes++;}}),twilio);
 const res=response();
 await handler({method:'POST',headers:{},body:{MessageSid:'SM'+'a'.repeat(32),MessageStatus:'delivered'}},res);
 assert.equal(res.code,403);assert.equal(writes,0);
});

test('signed status callback updates outbound records only; invalid status is rejected',async()=>{
 let params;
 const handler=new Function('getDb','twilio',await source('api/webhook/sms-status.js')+';return handler;')(()=>({query:async(q,p)=>{assert.match(q,/direction='outbound'/);params=p;}}),twilio);
 const body={MessageSid:'SM'+'a'.repeat(32),MessageStatus:'delivered'};
 let res=response();
 await handler({method:'POST',headers:{'x-twilio-signature':twilio.getExpectedTwilioSignature(token,base+'/api/webhook/sms-status',body)},body},res);
 assert.equal(res.code,200);assert.deepEqual(params,['delivered',body.MessageSid]);
 body.MessageStatus='made-up';res=response();params=null;
 await handler({method:'POST',headers:{'x-twilio-signature':twilio.getExpectedTwilioSignature(token,base+'/api/webhook/sms-status',body)},body},res);
 assert.equal(res.code,400);assert.equal(params,null);
});

test('public demo key is rejected without querying for a merchant',async()=>{
 const merchant=await authenticateMerchant({headers:{authorization:'Bearer vt_live_demo_change_me'}},{query(){throw Error('public key must not reach DB');}});
 assert.equal(merchant,null);
});

test('merchant replies reject whitespace, objects, oversize bodies and cross-merchant threads',async()=>{
 let sends=0;
 const handler=new Function('getDb','sendSms','authenticateMerchant','newMessageEvent',await source('api/merchant/reply.js')+';return handler;')(
  ()=>({query:async()=>({rows:[{merchant_id:'another-merchant',customer_phone:'test'}]})}),
  async()=>{sends++;},async()=>({id:'authorized-merchant'}),async()=>{}
 );
 const conversationId='aaaaaaaa-0000-4000-8000-000000000000';
 for(const message of [' ',{},'x'.repeat(1601)]){const res=response();await handler({method:'POST',body:{conversationId,message}},res);assert.equal(res.code,400);}
 const res=response();await handler({method:'POST',body:{conversationId,message:'Hello'}},res);assert.equal(res.code,403);assert.equal(sends,0);
});
