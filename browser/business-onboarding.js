import { businessAuth, businessToken } from '../vendor/business-session.js';
const $=id=>document.getElementById(id);
let mode='signin', recovering=new URLSearchParams(location.hash.slice(1)).get('type')==='recovery';
const status=message=>{$('status').textContent=message;};
async function request(path,body) {
  const token=await businessToken();
  if (!token) throw Error('Sign in first.');
  const response=await fetch(path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},...(body?{body:JSON.stringify(body)}:{})});
  const result=await response.json();
  if (!response.ok) throw Object.assign(Error(result.error || 'Please try again.'),{data:result});
  return result;
}
async function view() {
  for(const id of ['accountCard','resetCard','businessCard','readyCard','signOut']) $(id).hidden=true;
  const token=await businessToken();
  if (!token) { $('accountCard').hidden=false;return; }
  $('signOut').hidden=false;
  if (recovering) { $('resetCard').hidden=false;return; }
  const data=await request('/api/merchant/account');
  if (data.merchant?.status==='CLAIMED') { $('readyCard').hidden=false;$('readyName').textContent=data.merchant.name; }
  else {
    $('businessCard').hidden=false;$('signedEmail').textContent='Signed in as '+data.email;
    if (data.application) {
      $('verificationMethod').value='manual';
      for (const id of ['name','address','contactPerson','phone','channel','website','registration','notes']) $(id).value=data.application.profile[id] || (id==='channel'?'sms':'');
      renderApplication(data.application);
      $('codeForm').hidden=!data.application.codePending;
    }
    selectMethod();
  }
}
async function busy(form,work) {
  const button=form.querySelector('button[type="submit"]') || form.querySelector('button:not([type])') || form.querySelector('button');button.disabled=true;
  try { await work(); } catch(error) { if(error.data?.application)renderApplication(error.data.application);status(error.message || 'Please try again.'); }
  finally { button.disabled=false; }
}
$('switchMode').onclick=()=>{
  mode=mode==='signin'?'signup':'signin';
  $('accountTitle').textContent=mode==='signup'?'Create your business account':'Sign in';
  $('accountSubmit').textContent=mode==='signup'?'Create account':'Sign in';
  $('switchMode').textContent=mode==='signup'?'Already registered? Sign in':'Create a business account';
  $('password').autocomplete=mode==='signup'?'new-password':'current-password';
  status('');
};
$('accountForm').onsubmit=e=>{e.preventDefault();busy(e.target,async()=>{
  const credentials={email:$('email').value.trim(),password:$('password').value};
  const result=mode==='signup'?await businessAuth.signUp({...credentials,options:{emailRedirectTo:location.origin+'/merchant-signup.html'}}):await businessAuth.signInWithPassword(credentials);
  if(result.error) throw result.error;
  $('password').value='';
  status(result.data.session?'Signed in.':'Check your email to confirm your account, then return here and sign in.');
  await view();
});};
$('forgot').onclick=async()=>{
  if(!$('email').reportValidity())return;
  $('forgot').disabled=true;
  try {
    const {error}=await businessAuth.resetPasswordForEmail($('email').value.trim(),{redirectTo:location.origin+'/merchant-signup.html'});
    if(error)throw error;
    status('If this email has an account, a password reset link will arrive shortly.');
  } catch(error){status(error.message);} finally{$('forgot').disabled=false;}
};
$('resetForm').onsubmit=e=>{e.preventDefault();busy(e.target,async()=>{
  const {error}=await businessAuth.updateUser({password:$('newPassword').value});
  if(error)throw error;
  $('newPassword').value='';recovering=false;status('Password updated.');await view();
});};
function selectMethod() {
  const manual=$('verificationMethod').value==='manual';
  $('manualEvidence').hidden=!manual;$('notificationFields').hidden=manual;
  for (const el of $('manualEvidence').querySelectorAll('input')) el.disabled=!manual;
  for (const el of $('notificationFields').querySelectorAll('input')) el.disabled=manual;
  $('applicationStatus').hidden=!manual || !$('applicationState').textContent;
  $('methodHelp').textContent=manual?'Google Maps is not required. Save your profile, verify this business phone, then submit a business website or registration details for review.':'Use the business name, address and listed phone shown on Google Maps.';
}
function profileData() {
  return {...Object.fromEntries(['name','address','contactPerson','phone','channel','smsPhone','website','registration','notes'].map(id=>[id,$(id).value.trim()])),consent:$('consent').checked,smsConsent:$('smsConsent').checked};
}
function renderApplication(application) {
  const descriptions={DRAFT:'Profile saved. Verify your phone to continue.',PHONE_VERIFIED:'Phone verified. Your business is ready to submit for review.',REVIEW_PENDING:'Submitted — awaiting business review. Customer complaints are not accessible yet.',REJECTED:'Review needs attention. Update your evidence, verify your phone again and resubmit.',APPROVED:'Business approved. Open your dashboard.'};
  $('applicationStatus').hidden=false;
  $('applicationState').textContent=descriptions[application.status] || application.status;
  $('reviewNote').textContent=application.reviewNote ? 'Review note: '+application.reviewNote : '';
  $('submitApplication').disabled=application.status!=='PHONE_VERIFIED';
}
$('verificationMethod').onchange=()=>{$('codeForm').hidden=true;selectMethod();};
$('businessForm').addEventListener('input',()=>{
  $('codeForm').hidden=true;
  if($('verificationMethod').value==='manual') {
    $('submitApplication').disabled=true;
    if($('applicationState').textContent)$('applicationState').textContent='Unsaved changes. Save and verify the updated profile before submitting for review.';
  }
});
$('saveApplication').onclick=()=>busy($('manualEvidence'),async()=>{
  const result=await request('/api/merchant/application',{action:'save',...profileData()});
  renderApplication(result.application);$('codeForm').hidden=true;status(result.message);
});
$('businessForm').onsubmit=e=>{e.preventDefault();busy(e.target,async()=>{
  const manual=$('verificationMethod').value==='manual';
  const result=await request(manual?'/api/merchant/application':'/api/merchant/signup',{...(manual?{action:'send_code'}:{}),...profileData()});
  if(result.application)renderApplication(result.application);
  status(result.message);$('codeForm').hidden=false;$('code').focus();
});};
$('codeForm').onsubmit=e=>{e.preventDefault();busy(e.target,async()=>{
  const manual=$('verificationMethod').value==='manual';
  const result=await request(manual?'/api/merchant/application':'/api/merchant/account',{...(manual?{action:'verify'}:{}),code:$('code').value.trim()});
  status(result.message);$('code').value='';await view();
});};
$('submitApplication').onclick=async()=>{
  $('submitApplication').disabled=true;
  try {const result=await request('/api/merchant/application',{action:'submit'});renderApplication(result.application);status(result.message);}
  catch(error){status(error.message);$('submitApplication').disabled=false;}
};
$('signOut').onclick=async()=>{await businessAuth.signOut();location.replace('/merchant-signup.html');};
businessAuth.onAuthStateChange(event=>{
  if(event==='PASSWORD_RECOVERY') {recovering=true;setTimeout(()=>view().catch(e=>status(e.message)),0);}
});
const error=new URLSearchParams(location.hash.slice(1)).get('error_description');
try { await view();if(error)status(error);else status(''); } catch(e){status(e.message);}
