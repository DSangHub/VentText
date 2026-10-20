import { businessAuth, businessToken } from '../vendor/business-session.js';
const $=id=>document.getElementById(id);
let mode='signin', recovering=new URLSearchParams(location.hash.slice(1)).get('type')==='recovery';
const status=message=>{$('status').textContent=message;};
async function request(path,body) {
  const token=await businessToken();
  if (!token) throw Error('Sign in first.');
  const response=await fetch(path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},...(body?{body:JSON.stringify(body)}:{})});
  const result=await response.json();
  if (!response.ok) throw Error(result.error || 'Please try again.');
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
  else { $('businessCard').hidden=false;$('signedEmail').textContent='Signed in as '+data.email; }
}
async function busy(form,work) {
  const button=form.querySelector('button');button.disabled=true;
  try { await work(); } catch(error) { status(error.message || 'Please try again.'); }
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
$('businessForm').onsubmit=e=>{e.preventDefault();busy(e.target,async()=>{
  const profile=Object.fromEntries(['name','address','contactPerson','phone','channel','smsPhone'].map(id=>[id,$(id).value.trim()]));
  const result=await request('/api/merchant/signup',{...profile,consent:$('consent').checked,smsConsent:$('smsConsent').checked});
  status(result.message);$('codeForm').hidden=false;$('code').focus();
});};
$('codeForm').onsubmit=e=>{e.preventDefault();busy(e.target,async()=>{
  const result=await request('/api/merchant/account',{code:$('code').value.trim()});
  status(result.message);$('code').value='';await view();
});};
$('signOut').onclick=async()=>{await businessAuth.signOut();location.replace('/merchant-signup.html');};
businessAuth.onAuthStateChange(event=>{
  if(event==='PASSWORD_RECOVERY') {recovering=true;setTimeout(()=>view().catch(e=>status(e.message)),0);}
});
const error=new URLSearchParams(location.hash.slice(1)).get('error_description');
try { await view();if(error)status(error);else status(''); } catch(e){status(e.message);}
