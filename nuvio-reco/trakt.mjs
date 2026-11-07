import crypto from 'node:crypto';
import {loadProfiles,loadCatalog,saveJSON,PROFILE_FILE,sealSecret,openSecret} from './core.mjs';
const API='https://api.trakt.tv';
async function request(fetchImpl,path,{clientId=process.env.TRAKT_CLIENT_ID,token,method='GET',payload}={}){
 if(!clientId)throw new Error('TRAKT_CLIENT_ID is required');
 const headers={'content-type':'application/json','trakt-api-version':'2','trakt-api-key':clientId};
 if(token)headers.authorization=`Bearer ${token}`;
 const response=await fetchImpl(API+path,{method,headers,...(payload?{body:JSON.stringify(payload)}:{}),signal:AbortSignal.timeout(20000)});
 const data=await response.json().catch(()=>null);
 return {status:response.status,ok:response.ok,data};
}
export async function traktDeviceCode({clientId=process.env.TRAKT_CLIENT_ID,fetchImpl=fetch}={}){
 const r=await request(fetchImpl,'/oauth/device/code',{clientId,method:'POST',payload:{client_id:clientId}});
 if(!r.ok)throw new Error(`Trakt device code HTTP ${r.status}`);
 return r.data;
}
export async function traktDeviceToken({clientId=process.env.TRAKT_CLIENT_ID,clientSecret=process.env.TRAKT_CLIENT_SECRET,deviceCode,fetchImpl=fetch}={}){
 const payload={client_id:clientId,code:deviceCode};
 if(clientSecret)payload.client_secret=clientSecret;
 return request(fetchImpl,'/oauth/device/token',{clientId,method:'POST',payload});
}
export async function refreshTraktAuth(auth,{clientId=process.env.TRAKT_CLIENT_ID,clientSecret=process.env.TRAKT_CLIENT_SECRET,fetchImpl=fetch}={}){
 const payload={client_id:clientId,grant_type:'refresh_token',refresh_token:auth.refresh_token};
 if(clientSecret)payload.client_secret=clientSecret;
 const r=await request(fetchImpl,'/oauth/token',{clientId,method:'POST',payload});
 if(!r.ok||!r.data?.access_token)throw new Error(`Trakt token refresh failed (HTTP ${r.status}); reconnect the profile`);
 return r.data;
}
function imdb(row){
 const id=row?.movie?.ids?.imdb||row?.show?.ids?.imdb;
 return /^tt\d{5,12}$/.test(id||'')?id:null;
}
export async function fetchTraktHistory({clientId=process.env.TRAKT_CLIENT_ID,accessToken,fetchImpl=fetch}={}){
 if(!accessToken)throw new Error('Trakt user access token required');
 const paths=['/sync/watched/movies','/sync/watched/shows','/sync/ratings/movies','/sync/ratings/shows'];
 const results=await Promise.all(paths.map(path=>request(fetchImpl,path,{clientId,token:accessToken})));
 for(let i=0;i<2;i++)if(!results[i].ok)throw new Error(`Trakt watched history HTTP ${results[i].status}`);
 const watched=[...(results[0].data||[]),...(results[1].data||[])].map(row=>({id:imdb(row),when:row.last_watched_at||''})).filter(row=>row.id);
 watched.sort((a,b)=>String(b.when).localeCompare(String(a.when)));
 const liked=results.slice(2).filter(r=>r.ok).flatMap(r=>r.data||[]).filter(r=>Number(r.rating)>=8).map(imdb).filter(Boolean);
 return {watchedIds:[...new Set(watched.map(x=>x.id))],recentWatchedIds:[...new Set(watched.slice(0,30).map(x=>x.id))],likedIds:[...new Set(liked)]};
}
export async function syncTraktIfChanged(profileId,{clientId=process.env.TRAKT_CLIENT_ID,fetchImpl=fetch,force=false}={}){
 const data=loadProfiles(),profile=data.profiles.find(p=>p.id===profileId||p.name===profileId);
 if(!profile?.traktAuthEncrypted || !clientId)return {status:'not_configured'};
 let auth=JSON.parse(openSecret(profile.traktAuthEncrypted));
 if(!auth.access_token||!auth.refresh_token)throw new Error('Incomplete Trakt OAuth data');
 const expiry=(Number(auth.created_at)||0)*1000+(Number(auth.expires_in)||604800)*1000;
 if(Date.now()>=expiry-60000){
  auth=await refreshTraktAuth(auth,{clientId,fetchImpl});
  profile.traktAuthEncrypted=sealSecret(JSON.stringify(auth));
  // Save the new single-use refresh token immediately.
  saveJSON(PROFILE_FILE,data);
 }
 const r=await request(fetchImpl,'/sync/last_activities',{clientId,token:auth.access_token});
 if(!r.ok)throw new Error(`Trakt activity HTTP ${r.status}`);
 const fingerprint=crypto.createHash('sha256').update(JSON.stringify(r.data)).digest('hex');
 if(!force&&profile.traktActivityFingerprint===fingerprint&&profile.lastHistoryImport) return {status:'unchanged',profile:profile.name};
 const h=await fetchTraktHistory({clientId,accessToken:auth.access_token,fetchImpl});
 profile.watchedIds=h.watchedIds;profile.recentWatchedIds=h.recentWatchedIds;profile.likedIds=h.likedIds;
 profile.lastHistoryImport=new Date().toISOString();profile.traktActivityFingerprint=fingerprint;
 const catalog=loadCatalog(),recent=new Set(h.recentWatchedIds);
 profile.recentlyWatchedGenres=[...new Set(catalog.filter(t=>recent.has(t.id)).flatMap(t=>t.genres||[]))].slice(0,15);
 saveJSON(PROFILE_FILE,data);
 return {status:'updated',profile:profile.name,watched:h.watchedIds.length};
}
