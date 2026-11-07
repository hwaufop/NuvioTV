import crypto from 'node:crypto';
import fs from 'node:fs';
import {loadProfiles,loadCatalog,saveJSON,PROFILE_FILE,CATALOG_FILE,openSecret} from './core.mjs';
const TMDB='https://api.themoviedb.org/3';
const SIMKL='https://api.simkl.com';
async function getJson(fetchImpl,url,headers={}){
 const resp=await fetchImpl(url,{headers:{accept:'application/json',...headers},signal:AbortSignal.timeout(20000)});
 if(!resp.ok) throw new Error(`Provider HTTP ${resp.status} from ${new URL(url).hostname}`);
 return await resp.json();
}
async function parallelLimit(arr,limit,fn){
 const output=new Array(arr.length);let next=0;
 await Promise.all(Array.from({length:Math.min(limit,arr.length)},async()=>{
  while(next<arr.length){const index=next++;output[index]=await fn(arr[index]);}
 }));return output;
}
export async function buildTmdbCatalog({token=process.env.TMDB_READ_TOKEN,fetchImpl=fetch,language='fr-FR',maxPerType=60}={}){
 if(!token)throw new Error('TMDB_READ_TOKEN required to refresh the catalog');
 const h={authorization:`Bearer ${token}`};
 const api=(endpoint,params={})=>getJson(fetchImpl,`${TMDB}${endpoint}?${new URLSearchParams({language,...params})}`,h);
 const genres={};
 for (const type of ['movie','tv']){
  const data=await api(`/genre/${type}/list`);
  genres[type]=Object.fromEntries((data.genres||[]).map(x=>[x.id,x.name]));
 }
 const tasks=[];
 for(const type of ['movie','tv']){
  // Top rated gives good evergreen picks; trending adds recent discoveries.
  const pages=await Promise.all([
   api(`/trending/${type}/week`,{page:'1'}),
   api(`/${type}/top_rated`,{page:'1'}),
   api(`/${type}/popular`,{page:'1'})
  ]);
  const found=new Map();
  for (const page of pages) for(const item of page.results||[]){
   if(item.id && item.poster_path && item.vote_count>=20) found.set(item.id,item);
  }
  for(const item of [...found.values()].slice(0,maxPerType))tasks.push({type,item});
 }
 // TMDB IDs are not guaranteed to work with existing stream addons; resolve IMDb IDs.
 const results=await parallelLimit(tasks,4,async({type,item})=>{
  try{
   const ext=await api(`/${type}/${item.id}/external_ids`);
   const id=ext.imdb_id;
   if(!/^tt\d{5,12}$/.test(id||''))return null;
   return {id,type:type==='tv'?'series':'movie',name:item.title||item.name||item.original_name,
    poster:`https://image.tmdb.org/t/p/w500${item.poster_path}`,
    ...(item.backdrop_path?{background:`https://image.tmdb.org/t/p/w1280${item.backdrop_path}`}:{}) ,
    description:item.overview||'',genres:(item.genre_ids||[]).map(g=>genres[type][g]).filter(Boolean),
    rating:item.vote_average||0,voteCount:item.vote_count||0,popularity:item.popularity||0,
    year:Number((item.release_date||item.first_air_date||'').slice(0,4))||null};
  }catch(e){console.error('TMDB ID resolution failed:',item.id,e.message);return null;}
 });
 return [...new Map(results.filter(Boolean).map(item=>[item.type+':'+item.id,item])).values()];
}
export async function refreshTmdb(options={}){
 const items=await buildTmdbCatalog(options);
 if(items.length<10)throw new Error('TMDB returned fewer than 10 usable titles; existing cache retained');
 saveJSON(CATALOG_FILE,items);
 return {titles:items.length};
}
function simklIds(row){
 const ids=row?.movie?.ids||row?.show?.ids||row?.anime?.ids||{};
 const imdb=ids.imdb;
 return /^tt\d{5,12}$/.test(imdb||'')?imdb:null;
}
export async function fetchSimklHistory({clientId=process.env.SIMKL_CLIENT_ID,accessToken,fetchImpl=fetch,since=null}={}){
 if(!clientId||!accessToken)throw new Error('Simkl client ID and user access token required');
 const h={'simkl-api-key':clientId,authorization:`Bearer ${accessToken}`};
 // Explicit import. Continuous polling must use /sync/activities + date_from per Simkl rules.
 const suffix=since?`?date_from=${encodeURIComponent(since)}`:'';
 const [movies,shows]=await Promise.all([
  getJson(fetchImpl,`${SIMKL}/sync/all-items/movies/completed${suffix}`,h),
  getJson(fetchImpl,`${SIMKL}/sync/all-items/shows/completed${suffix}`,h)
 ]);
 const all=[...(movies?.movies||[]),...(shows?.shows||[])];
 const ordered=all.map(row=>({id:simklIds(row),when:row.last_watched_at||row.completed_at||row.last_watched||''})).filter(x=>x.id);
 ordered.sort((a,b)=>String(b.when).localeCompare(String(a.when)));
 const liked=all.filter(row=>Number(row.user_rating||row.rating||0)>=8).map(simklIds).filter(Boolean);
 return {watchedIds:[...new Set(ordered.map(x=>x.id))],recentWatchedIds:[...new Set(ordered.slice(0,30).map(x=>x.id))],likedIds:[...new Set(liked)]};
}
export async function importSimklProfile(profileId,opts={}){
 const data=loadProfiles(),profile=data.profiles.find(p=>p.id===profileId||p.name===profileId);
 if(!profile) throw new Error('Unknown profile');
 if(!profile.simklTokenEncrypted)throw new Error('Profile is not connected to Simkl');
 const history=await fetchSimklHistory({...opts,accessToken:openSecret(profile.simklTokenEncrypted)});
 profile.watchedIds=history.watchedIds;profile.recentWatchedIds=history.recentWatchedIds;
 profile.likedIds=history.likedIds;profile.lastHistoryImport=new Date().toISOString();
 // Infer recent genres from titles also present in locally cached TMDB catalog.
 const catalog=loadCatalog();const recent=new Set(profile.recentWatchedIds);
 profile.recentlyWatchedGenres=[...new Set(catalog.filter(t=>recent.has(t.id)).flatMap(t=>t.genres||[]))].slice(0,15);
 saveJSON(PROFILE_FILE,data);
 return {profile:profile.name,watched:profile.watchedIds.length};
}
export async function beginSimklPin({clientId=process.env.SIMKL_CLIENT_ID,fetchImpl=fetch}={}){
 if(!clientId)throw new Error('SIMKL_CLIENT_ID required');
 return getJson(fetchImpl,`${SIMKL}/oauth/pin?client_id=${encodeURIComponent(clientId)}`);
}
export async function pollSimklPin({clientId=process.env.SIMKL_CLIENT_ID,userCode,fetchImpl=fetch}={}){
 if(!clientId||!userCode) throw new Error('SIMKL_CLIENT_ID and userCode required');
 return getJson(fetchImpl,`${SIMKL}/oauth/pin/${encodeURIComponent(userCode)}?client_id=${encodeURIComponent(clientId)}`);
}

function findRemovedMarker(activities){
 const markers=[];
 function visit(obj,pre=''){
  if(!obj||typeof obj!=='object')return;
  for(const [k,v] of Object.entries(obj)){
   if(k==='removed_from_list')markers.push(pre+':'+String(v));
   else if(v && typeof v==='object')visit(v,pre+'/'+k);
  }
 }
 visit(activities);
 return crypto.createHash('sha256').update(markers.join(';')).digest('hex');
}
export async function syncSimklIfChanged(profileId,{clientId=process.env.SIMKL_CLIENT_ID,fetchImpl=fetch}={}){
 const data=loadProfiles(),profile=data.profiles.find(p=>p.id===profileId||p.name===profileId);
 if(!profile || !profile.simklTokenEncrypted || !clientId)return {status:'not_configured'};
 const accessToken=openSecret(profile.simklTokenEncrypted);
 const headers={'simkl-api-key':clientId,authorization:`Bearer ${accessToken}`};
 const activities=await getJson(fetchImpl,`${SIMKL}/sync/activities`,headers);
 const fingerprint=crypto.createHash('sha256').update(JSON.stringify(activities)).digest('hex');
 if(profile.simklActivityFingerprint===fingerprint && profile.lastHistoryImport)return {status:'unchanged',profile:profile.name};
 const removedMarker=findRemovedMarker(activities);
 const forceFull=!profile.lastHistoryImport || (profile.simklRemovedMarker && profile.simklRemovedMarker!==removedMarker);
 const since=forceFull?null:profile.lastHistoryImport;
 const history=await fetchSimklHistory({clientId,accessToken,fetchImpl,since});
 profile.watchedIds=forceFull?history.watchedIds:[...new Set([...(profile.watchedIds||[]),...history.watchedIds])];
 profile.recentWatchedIds=[...new Set([...history.recentWatchedIds,...(profile.recentWatchedIds||[])])].slice(0,30);
 profile.likedIds=forceFull?history.likedIds:[...new Set([...(profile.likedIds||[]),...history.likedIds])];
 profile.lastHistoryImport=new Date().toISOString();
 profile.simklActivityFingerprint=fingerprint;
 profile.simklRemovedMarker=removedMarker;
 const catalog=loadCatalog(),recent=new Set(profile.recentWatchedIds);
 profile.recentlyWatchedGenres=[...new Set(catalog.filter(t=>recent.has(t.id)).flatMap(t=>t.genres||[]))].slice(0,15);
 saveJSON(PROFILE_FILE,data);
 return {status:'updated',profile:profile.name,watched:profile.watchedIds.length,mode:forceFull?'full':'delta'};
}
export async function syncAll({fetchImpl=fetch}={}){
 const summary={catalog:'skipped',profiles:[]};
 if(process.env.TMDB_READ_TOKEN){
  const stale=(()=>{try{return Date.now()-fs.statSync(CATALOG_FILE).mtimeMs>24*3600*1000;}catch{return true;}})();
  if(stale){try{summary.catalog=(await refreshTmdb({fetchImpl}));}catch(e){summary.catalog='error: '+e.message;}}
 }
 if(process.env.SIMKL_CLIENT_ID || process.env.TRAKT_CLIENT_ID){
  for(const p of loadProfiles().profiles){
   if(p.historySource==='trakt' && process.env.TRAKT_CLIENT_ID){
    try{const {syncTraktIfChanged}=await import('./trakt.mjs');summary.profiles.push(await syncTraktIfChanged(p.id,{fetchImpl}));}
    catch(e){summary.profiles.push({profile:p.name,status:'error',reason:e.message});}
    continue;
   }
   if(!p.simklTokenEncrypted || !process.env.SIMKL_CLIENT_ID)continue;
   try{summary.profiles.push(await syncSimklIfChanged(p.id,{fetchImpl}));}
   catch(e){summary.profiles.push({profile:p.name,status:'error',reason:e.message});}
  }
 }
 return summary;
}
