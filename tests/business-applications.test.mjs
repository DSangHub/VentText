import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {applicationProfile,applicationSummary,saveApplication,verifyApplicationPhone,submitApplication} from '../api/_lib/business-applications.js';
import {newChallenge} from '../api/_lib/business-claims.js';
const user={id:'aaaaaaaa-0000-4000-8000-000000000000',email:'test@example.invalid'};
const profileInput={name:'Unlisted Test Business',address:'123 Main St, Fresno, CA',contactPerson:'Manager',phone:'5595550100',website:'https://example.com',channel:'sms'};
const profile=applicationProfile(profileInput,user.email);
const response=()=>({setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;}});
const source=async path=>(await readFile(new URL('../'+path,import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace('export default async function handler','async function handler');
async function handler(overrides={}) {
 const dependencies={getDb:()=>({}),authenticatedBusinessUser:async()=>user,applicationProfile,
  saveApplication:async()=>({application:{status:'DRAFT',profile}}),verifyApplicationPhone:async()=>({application:{status:'PHONE_VERIFIED'}}),submitApplication:async()=>({application:{status:'REVIEW_PENDING'}}),newChallenge:()=>({code:'123456',salt:'salt',hash:'hash'}),reserveVerification:async()=>true,sendSms:async()=>{},twilioClient:{calls:{create:async()=>{}}},...overrides};
 return new Function(...Object.keys(dependencies),await source('api/merchant/application.js')+';return handler;')(...Object.values(dependencies));
}

test('unlisted profile can be saved without Google, SMS consent or notification opt-in',()=>{
 assert.equal(profile.phone,'+15595550100');assert.equal(profile.email,user.email);assert.equal(profile.smsConsent,false);
 assert.equal(applicationProfile({...profileInput,email:'attacker@example.invalid'},user.email).email,user.email);
 const registration=applicationProfile({...profileInput,website:'',registration:'Business registration 123, State agency'},user.email);
 assert.ok(registration);
 for(const patch of [{website:'',registration:''},{website:'javascript:alert(1)'},{website:'https://user:pass@example.com'},{website:'https://127.0.0.1'},{website:'https://host.local'},{registration:'x'.repeat(501)},{notes:'x'.repeat(1001)}])assert.equal(applicationProfile({...profileInput,...patch},user.email),null);
});

test('application summaries never expose verification secrets',()=>{
 const result=applicationSummary({status:'DRAFT',profile,code_hash:'secret-hash',code_salt:'secret-salt',expires_at:new Date(Date.now()+600000),attempts:0});
 assert.equal(result.codePending,true);assert.equal(result.code_hash,undefined);assert.equal(result.code_salt,undefined);assert.equal(result.expires_at,undefined);
});

test('anonymous application actions cannot read/write or send anything',async()=>{
 const fail=()=>{throw Error('must not be called');};
 const fn=await handler({authenticatedBusinessUser:async()=>null,getDb:fail,sendSms:fail});
 for(const action of ['save','send_code','verify','submit']){const res=response();await fn({method:'POST',body:{action}},res);assert.equal(res.code,401);}
});

test('saving an application uses the authenticated owner and sends no verification message',async()=>{
 const fail=()=>{throw Error('must not send');};let saved;
 const fn=await handler({reserveVerification:fail,sendSms:fail,twilioClient:{calls:{create:fail}},saveApplication:async(db,owner,p)=>{saved={owner,p};return {application:{status:'DRAFT',profile:p}};}});
 const res=response();await fn({method:'POST',body:{...profileInput,action:'save',userId:'another-user',status:'APPROVED'}},res);
 assert.equal(res.code,200);assert.equal(saved.owner.id,user.id);assert.equal(res.body.application.status,'DRAFT');
});

test('explicit phone-code consent and shared rate limits run before any send',async()=>{
 let saved=0,sends=0;const fn=await handler({saveApplication:async()=>{saved++;},sendSms:async()=>{sends++;},reserveVerification:async()=>false});
 let res=response();await fn({method:'POST',body:{...profileInput,action:'send_code'}},res);assert.equal(res.code,400);
 res=response();await fn({method:'POST',body:{...profileInput,action:'send_code',consent:true}},res);assert.equal(res.code,429);
 assert.equal(saved,0);assert.equal(sends,0);
});

test('unlisted business requests can send SMS or voice without a Google lookup',async()=>{
 for(const channel of ['sms','voice']) {
  const sends=[],writes=[];const fn=await handler({getDb:()=>({query:async(sql,params)=>{writes.push({sql,params});return {rows:[{user_id:user.id}]};}}),sendSms:async(to,body)=>sends.push({to,body}),twilioClient:{calls:{create:async message=>sends.push(message)}}});
  const res=response();await fn({method:'POST',body:{...profileInput,action:'send_code',consent:true,channel}},res);
  assert.equal(res.code,200);assert.equal(sends.length,1);assert.equal(sends[0].to,'+15595550100');assert.equal(writes[0].params.includes('123456'),false);
 }
});

test('a failed phone send preserves the draft and invalidates only its challenge',async()=>{
 const writes=[];const fn=await handler({getDb:()=>({query:async(sql,params)=>{writes.push({sql,params});return {rows:[{user_id:user.id}]};}}),sendSms:async()=>{throw Error('provider');}});
 const res=response();await fn({method:'POST',body:{...profileInput,action:'send_code',consent:true}},res);
 assert.equal(res.code,502);assert.equal(res.body.application.status,'DRAFT');assert.ok(writes.some(w=>w.sql.includes('code_hash=NULL')&&w.params[1]==='hash'));
});

function dbForPhone(row) {
 let attempts=row?.attempts || 0;const writes=[];
 return {writes,connect:async()=>({release(){},async query(sql,params){writes.push({sql,params});
  if(sql.startsWith('SELECT *'))return {rows:row?[{...row,attempts}]:[]};
  if(sql.includes('SET attempts=attempts+1'))attempts++;
  if(sql.includes("status='PHONE_VERIFIED'")){row.status='PHONE_VERIFIED';row.phone_verified_at=new Date();row.code_hash=null;return {rows:[row]};}
  return {rows:[]};}})};
}

test('phone proof is single-use, expires, limits guesses, and never grants merchant ownership',async()=>{
 const challenge=newChallenge(),row={status:'DRAFT',profile,code_hash:challenge.hash,code_salt:challenge.salt,expires_at:new Date(Date.now()+600000),attempts:0};
 for(const invalid of [null,{...row,expires_at:new Date(0)},{...row,attempts:5},{...row,status:'REVIEW_PENDING'}]){const db=dbForPhone(invalid);assert.equal((await verifyApplicationPhone(db,user.id,challenge.code)).status,400);}
 const db=dbForPhone({...row});const result=await verifyApplicationPhone(db,user.id,challenge.code);assert.equal(result.application.status,'PHONE_VERIFIED');assert.equal(result.application.phoneVerified,true);
 assert.equal((await verifyApplicationPhone(db,user.id,challenge.code)).status,400);
 assert.equal(db.writes.some(w=>/INSERT INTO merchants|UPDATE merchants/.test(w.sql)),false);
 const guesses=dbForPhone({...row});const wrong=challenge.code==='123456'?'654321':'123456';
 for(let i=0;i<5;i++)assert.equal((await verifyApplicationPhone(guesses,user.id,wrong)).status,400);
 assert.equal((await verifyApplicationPhone(guesses,user.id,challenge.code)).status,400);
});

test('submitting a saved draft without phone proof cannot reach review or grant inbox access',async()=>{
 const writes=[];const db={query:async(sql,params)=>{writes.push({sql,params});return {rows:sql.startsWith('SELECT')?[{status:'DRAFT',profile}]:[]};}};
 const result=await submitApplication(db,user.id);assert.equal(result.status,400);assert.match(writes[0].sql,/phone_verified_at IS NOT NULL/);
 assert.ok(writes.every(w=>w.params[0]===user.id));assert.equal(writes.some(w=>/merchants/.test(w.sql)),false);
});

test('approved businesses cannot be overwritten through profile save',async()=>{
 const writes=[];const db={connect:async()=>({release(){},query:async(sql,params)=>{writes.push({sql,params});return {rows:sql.startsWith('SELECT')?[{id:'already-owned'}]:[]};}})};
 const result=await saveApplication(db,user,profile);assert.equal(result.status,409);assert.equal(writes.some(w=>w.sql.startsWith('INSERT')),false);
});

test('applicants cannot call an approve action or choose another applicant for review',async()=>{
 let submitted;
 const fn=await handler({submitApplication:async(db,owner)=>{submitted=owner;return {application:{status:'REVIEW_PENDING'}};}});
 let res=response();await fn({method:'POST',body:{action:'approve'}},res);assert.equal(res.code,400);
 res=response();await fn({method:'POST',body:{action:'submit',userId:'someone-else',merchantId:'victim'}},res);assert.equal(res.code,200);assert.equal(submitted,user.id);
});
