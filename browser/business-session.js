import { createClient } from '@supabase/supabase-js';
import { authUrl, authKey } from '../auth-config.js';
export const businessAuth = createClient(authUrl, authKey, {
  auth: { storageKey:'vt_business_auth', persistSession:true, autoRefreshToken:true, detectSessionInUrl:true, flowType:'implicit' }
}).auth;
export async function businessToken() {
  const {data,error}=await businessAuth.getSession();
  if (error) throw error;
  return data.session?.access_token || null;
}
