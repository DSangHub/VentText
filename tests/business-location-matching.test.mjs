import test from 'node:test';
import assert from 'node:assert/strict';
import {findBusinessPlace} from '../api/_lib/google-places.js';

const place={id:'place-123',displayName:{text:"Rosa’s Cafe, LLC"},formattedAddress:'123 North Blackstone Avenue, Fresno, CA 93710, USA',businessStatus:'OPERATIONAL'};
const results=places=>async()=>({ok:true,json:async()=>({places})});
process.env.GOOGLE_PLACES_API_KEY='mock-only';
const lookup=(name,address,places=[place])=>findBusinessPlace(name,address,results(places),{businessSignup:true});

test('business signup accepts apostrophes, legal suffixes, street abbreviations and full state names',async()=>{
 for(const address of ['123 N Blackstone Ave, Fresno, California 93710','123 North Blackstone Avenue, Fresno, CA 93710','123 N Blackstone Ave Fresno CA','123 N Blackstone Ave, Fresno, CA 93710-1234']) {
  assert.equal(await lookup('Rosas Cafe',address),'place-123',address);
 }
});

test('address tokens cannot match a substring of another street number or street name',async()=>{
 for(const address of ['23 N Blackstone Ave, Fresno, CA','123 N Blackstone Ave, Clovis, CA','123 N Blackstone Ave, Fresno, NV','123 N Blackstone Ave, Fresno, CA 93711','123 N Blackstone Ave, Fresno, CA, Suite 9']) {
  assert.equal(await lookup('Rosas Cafe',address),null,address);
 }
 assert.equal(await lookup('Rosas Cafe','123 N Blackstone Ave, Fresno, CA',[{...place,formattedAddress:'1123 N Blackstone Ave, Fresno, CA 93710, USA'}]),null);
});

test('different businesses, permanently closed locations and ambiguous branches stay unassigned',async()=>{
 const address='123 N Blackstone Ave, Fresno, CA';
 assert.equal(await lookup('Different Cafe',address),null);
 assert.equal(await lookup('Rosas Cafe',address,[{...place,businessStatus:'CLOSED_PERMANENTLY'}]),null);
 assert.equal(await lookup('Rosas Cafe',address,[place,{...place,id:'second-place'}]),null);
});

test('existing customer complaint routing retains its strict matching behavior',async()=>{
 const name="Rosa’s Cafe, LLC",address='123 North Blackstone Avenue, Fresno, CA 93710';
 assert.equal(await findBusinessPlace(name,address,results([place])),'place-123');
 assert.equal(await findBusinessPlace('Rosas Cafe','123 N Blackstone Ave, Fresno, California',results([place])),null);
});

test('missing provider configuration is a service failure during signup, never a false mismatch',async()=>{
 const previous=process.env.GOOGLE_PLACES_API_KEY;
 delete process.env.GOOGLE_PLACES_API_KEY;
 try {
  await assert.rejects(lookup('Test','123 Main St'),/not configured/);
  assert.equal(await findBusinessPlace('Test','123 Main St',()=>{throw Error('should not fetch');}),null);
 } finally {process.env.GOOGLE_PLACES_API_KEY=previous;}
});
