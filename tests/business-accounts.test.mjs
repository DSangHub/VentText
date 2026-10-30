import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {authenticatedBusinessUser} from '../api/_lib/business-auth.js';
import {businessProfile,newChallenge,codeMatches,finishClaim,reserveVerification} from '../api/_lib/business-claims.js';
import {matchesListedPhone} from '../api/_lib/google-places.js';
const user={id:'aaaaaaaa-0000-4000-8000-000000000000',email:'test@example.invalid',email_confirmed_at:new Date().toISOString()};
const req={headers:{authorization:'Bearer header.payload.signature'}};
const response=()=>({setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;}});
const source=async path=>(await readFile(new URL('../'+path,import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace('export default async function handler','async function handler');

test('Auth service verification is required; unconfirmed and anonymous accounts cannot claim',async()=>{
 assert.equal(await authenticatedBusinessUser({headers:{}},()=>{throw Error('must not call');}),null);
 assert.equal(await authenticatedBusinessUser(req,async()=>({ok:false})),null);
 for(const invalid of [{...user,email_confirmed_at:null},{...user,is_anonymous:true},{id:user.id,user_metadata:{email_confirmed_at:true}}]) {
  assert.equal(await authenticatedBusinessUser(req,async()=>({ok:true,json:async()=>invalid})),null);
 }
 assert.deepEqual(await authenticatedBusinessUser(req,async(url,opts)=>{
  assert.equal(new URL(url).pathname,'/auth/v1/user');assert.equal(opts.headers.Authorization,req.headers.authorization);
  return {ok:true,json:async()=>user};
 }),user);
});

test('profile requires explicit verification consent and keeps notification opt-in separate',()=>{
 const valid={name:'Test Cafe',address:'123 Main St, Fresno, CA',contactPerson:'Test',phone:'5595550100',channel:'voice',consent:true};
 const profile=businessProfile(valid,user.email);assert.equal(profile.phone,'+15595550100');assert.equal(profile.smsConsent,false);assert.equal(profile.smsPhone,null);
 for(const invalid of [{...valid,consent:false},{...valid,channel:'email'},{...valid,phone:'123'},{...valid,smsConsent:true},{...valid,name:'x'.repeat(121)}])assert.equal(businessProfile(invalid,user.email),null);
});

test('only a Google-listed phone matching the supplied number can receive a code',async()=>{
 process.env.GOOGLE_PLACES_API_KEY='test';
 const fetcher=async(url,opts)=>{assert.equal(opts.headers['X-Goog-FieldMask'],'internationalPhoneNumber');return {ok:true,json:async()=>({internationalPhoneNumber:'+1 559-555-0100'})};};
 assert.equal(await matchesListedPhone('place','+15595550100',fetcher),true);
 assert.equal(await matchesListedPhone('place','+15595550199',fetcher),false);
});

function fakeDb(claim,merchant={id:'merchant',merchant_code:'VT123'}) {
 const writes=[];let attempts=claim?.attempts || 0;
 const client={release(){},async query(sql,params){
  writes.push({sql,params});
  if(sql.startsWith('SELECT * FROM business_claims'))return {rows:claim?[{...claim,attempts}]:[]};
  if(sql.startsWith('UPDATE business_claims SET attempts'))attempts++;
  if(sql.startsWith('INSERT INTO merchants'))return {rows:merchant?[merchant]:[]};
  if(sql.startsWith('UPDATE business_claims SET verified_at')){claim.verified_at=new Date();claim.code_hash=null;}
  return {rows:[]};
 }};
 return {writes,connect:async()=>client};
}
const challengeClaim=()=>{const c=newChallenge();return {code:c.code,claim:{profile:{name:'Test',address:'123 Main',contactPerson:'Test',phone:'+15595550100',smsConsent:false},google_place_id:'place',code_salt:c.salt,code_hash:c.hash,expires_at:new Date(Date.now()+600000),attempts:0}};};

test('challenge codes are salted and never stored as plaintext',()=>{
 const a=newChallenge(),b=newChallenge();assert.match(a.code,/^\d{6}$/);assert.notEqual(a.salt,b.salt);assert.notEqual(a.hash,a.code);
 assert.equal(codeMatches({code_hash:a.hash,code_salt:a.salt},a.code),true);
 assert.equal(codeMatches({code_hash:a.hash,code_salt:b.salt},a.code),false);
});

test('expired, missing, exhausted and reused challenges cannot attach a business',async()=>{
 const {code,claim}=challengeClaim();
 for(const invalid of [null,{...claim,expires_at:new Date(0)},{...claim,attempts:5},{...claim,verified_at:new Date()}]){
  const db=fakeDb(invalid);assert.equal((await finishClaim(db,user,code)).status,400);
  assert.equal(db.writes.some(w=>w.sql.startsWith('INSERT INTO merchants')),false);
 }
 const db=fakeDb(claim);assert.equal((await finishClaim(db,user,code)).merchant.id,'merchant');
 assert.equal((await finishClaim(db,user,code)).status,400);
});

test('wrong codes consume attempts; fifth failed attempt blocks even the correct code',async()=>{
 const {code,claim}=challengeClaim(),db=fakeDb(claim);
 const wrong=code==='123456'?'654321':'123456';
 for(let i=0;i<5;i++)assert.equal((await finishClaim(db,user,wrong)).status,400);
 assert.equal((await finishClaim(db,user,code)).status,400);
 assert.equal(db.writes.some(w=>w.sql.startsWith('INSERT INTO merchants')),false);
});

test('a verified claim cannot transfer a business already owned by another account',async()=>{
 const {code,claim}=challengeClaim(),db=fakeDb(claim,null);
 assert.equal((await finishClaim(db,user,code)).status,409);
 const insert=db.writes.find(w=>w.sql.startsWith('INSERT INTO merchants'));
 assert.match(insert.sql,/owner_auth_user_id IS NULL AND merchants.status <> 'CLAIMED'/);
 assert.match(insert.sql,/owner_auth_user_id=EXCLUDED.owner_auth_user_id/);
 assert.equal(db.writes.some(w=>w.sql.startsWith('UPDATE business_claims SET verified_at')),false);
});

test('rate limits reject account, phone, global and immediate resend before sending',async()=>{
 for(const counts of [{total:100},{account:5},{phone:3},{recent:1}]){
  const writes=[];const db={connect:async()=>({release(){},query:async sql=>{writes.push(sql);return {rows:[{total:0,account:0,phone:0,recent:0,...counts}]};}})};
  assert.equal(await reserveVerification(db,user.id,'+15595550100'),false);
  assert.equal(writes.some(sql=>sql.startsWith('INSERT')),false);assert.ok(writes.includes('ROLLBACK'));
 }
});

test('unauthenticated signup/account requests cannot write, query Google or send messages',async()=>{
 const fail=()=>{throw Error('must not call external services');};
 const signup=new Function('getDb','authenticatedBusinessUser','businessProfile','newChallenge','reserveVerification','findBusinessPlace','matchesListedPhone','sendSms','twilioClient',await source('api/merchant/signup.js')+';return handler;')(fail,async()=>null,fail,fail,fail,fail,fail,fail,{});
 let res=response();await signup({method:'POST',body:{}},res);assert.equal(res.code,401);
 const account=new Function('getDb','authenticatedBusinessUser','finishClaim','sendSms',await source('api/merchant/account.js')+';return handler;')(fail,async()=>null,fail,fail);
 for(const method of ['GET','POST']){res=response();await account({method},res);assert.equal(res.code,401);}
});

test('Google mismatch never creates a challenge or sends a text/call',async()=>{
 const fail=()=>{throw Error('must not send');};
 const db={query:async()=>({rows:[]})};
 const signup=new Function('getDb','authenticatedBusinessUser','businessProfile','newChallenge','reserveVerification','findBusinessPlace','matchesListedPhone','sendSms','twilioClient',await source('api/merchant/signup.js')+';return handler;')(()=>db,async()=>user,()=>({name:'Test',address:'Test',phone:'+15595550100'}),fail,async()=>true,async()=>null,fail,fail,{calls:{create:fail}});
 const res=response();await signup({method:'POST',body:{}},res);assert.equal(res.code,422);
});

test('authorized text and voice requests send only to the matched phone; plaintext code is not saved',async()=>{
 for(const channel of ['sms','voice']) {
  const writes=[],sends=[];
  const db={query:async(sql,params)=>{writes.push({sql,params});return {rows:[]};}};
  const profile={name:'Test',address:'123 Main',phone:'+15595550100',channel};
  const signup=new Function('getDb','authenticatedBusinessUser','businessProfile','newChallenge','reserveVerification','findBusinessPlace','matchesListedPhone','sendSms','twilioClient',await source('api/merchant/signup.js')+';return handler;')(()=>db,async()=>user,()=>profile,()=>({code:'123456',hash:'hash',salt:'salt'}),async()=>true,async()=>'place',async()=>true,async(to,body)=>sends.push({to,body}),{calls:{create:async opts=>sends.push(opts)}});
  const res=response();await signup({method:'POST',body:{}},res);assert.equal(res.code,200);
  assert.equal(sends.length,1);assert.equal(sends[0].to,profile.phone);
  assert.equal(writes.find(w=>w.sql.startsWith('INSERT INTO business_claims')).params.includes('123456'),false);
  if(channel==='voice') assert.match(sends[0].twiml,/1 2 3 4 5 6/);
 }
});

test('failed provider send invalidates the challenge and returns a recoverable error',async()=>{
 const writes=[],db={query:async(sql,params)=>{writes.push({sql,params});return {rows:[]};}};
 const signup=new Function('getDb','authenticatedBusinessUser','businessProfile','newChallenge','reserveVerification','findBusinessPlace','matchesListedPhone','sendSms','twilioClient',await source('api/merchant/signup.js')+';return handler;')(()=>db,async()=>user,()=>({phone:'+15595550100',channel:'sms'}),()=>({code:'123456',hash:'hash',salt:'salt'}),async()=>true,async()=>'place',async()=>true,async()=>{throw Error('provider');},{});
 const res=response();await signup({method:'POST',body:{}},res);assert.equal(res.code,502);
 assert.ok(writes.some(w=>w.sql.includes('SET code_hash=NULL') && w.params[1]==='hash'));
});

test('a matched business with a different public phone receives a specific error and no code',async()=>{
 const fail=()=>{throw Error('must not send or create a code');};
 const signup=new Function('getDb','authenticatedBusinessUser','businessProfile','newChallenge','reserveVerification','findBusinessPlace','matchesListedPhone','sendSms','twilioClient',await source('api/merchant/signup.js')+';return handler;')(()=>({query:async()=>({rows:[]})}),async()=>user,()=>({phone:'+15595550100'}),fail,async()=>true,async()=>'place',async()=>false,fail,{});
 const res=response();await signup({method:'POST',body:{}},res);assert.equal(res.code,422);assert.equal(res.body.code,'BUSINESS_PHONE_MISMATCH');
});

test('provider failures do not tell a legitimate business that its listing is missing',async()=>{
 const fail=()=>{throw Error('must not send');};
 const signup=new Function('getDb','authenticatedBusinessUser','businessProfile','newChallenge','reserveVerification','findBusinessPlace','matchesListedPhone','sendSms','twilioClient',await source('api/merchant/signup.js')+';return handler;')(()=>({query:async()=>({rows:[]})}),async()=>user,()=>({phone:'+15595550100'}),fail,async()=>true,async()=>{throw Error('provider unavailable');},fail,fail,{});
 const res=response();await signup({method:'POST',body:{}},res);assert.equal(res.code,503);assert.equal(res.body.code,'BUSINESS_LOOKUP_UNAVAILABLE');
});
