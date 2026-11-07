import { LANES, normalizeTmdb, rankCandidates, toStremioMeta } from './scoring.mjs';
import {setupHtml,setupScript} from './setup-ui.mjs';
import { getWatched, getTmdb, parsedHistory, redeemDeviceCode, refreshTraktToken, requestDeviceCode } from './providers.mjs';

const enc = new TextEncoder();
const dec = new TextDecoder();
const CORS = { 'access-control-allow-origin':'*', 'access-control-allow-methods':'GET, OPTIONS' };
const VALID_TOKEN = /^[a-f0-9]{64}$/;
const LANES_SET = new Set(LANES.map(([id])=>id));
const WEB_TYPES = new Set(['movie','series']);
const LIMIT = 9;
const NOW = () => new Date().toISOString();

function respond(obj, status=200, publicData=false) {
  return Response.json(obj,{status,headers:{
    ...(publicData?CORS:{}),
    'cache-control':publicData?'private, max-age=180':'no-store',
    'x-content-type-options':'nosniff',
    'referrer-policy':'no-referrer',
  }});
}
function bytesHex(bytes) {return [...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');}
function fromHex(hex) {if(!/^[a-f0-9]{64}$/.test(hex))throw Error('Invalid ENCRYPTION_KEY'); return new Uint8Array(hex.match(/../g).map(b=>parseInt(b,16)));}
function b64(bytes) {return btoa(String.fromCharCode(...bytes)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');}
function unb64(value) {const s=value.replace(/-/g,'+').replace(/_/g,'/');return Uint8Array.from(atob(s.padEnd(Math.ceil(s.length/4)*4,'=')),c=>c.charCodeAt(0));}
function randomToken() {const array=new Uint8Array(32); crypto.getRandomValues(array);return bytesHex(array);}
async function sha(value) {return bytesHex(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(value))));}
async function aesKey(env) {return crypto.subtle.importKey('raw',fromHex(env.ENCRYPTION_KEY||''),'AES-GCM',false,['encrypt','decrypt']);}
async function seal(env,value) {
  const iv=new Uint8Array(12);crypto.getRandomValues(iv);
  const cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},await aesKey(env),enc.encode(JSON.stringify(value))));
  return `${b64(iv)}.${b64(cipher)}`;
}
async function openBox(env,value) {
  const [iv,data]=(value||'').split('.'); if(!iv||!data)throw Error('Invalid encrypted data');
  return JSON.parse(dec.decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(iv)},await aesKey(env),unb64(data))));
}
function constantEquals(a,b) {
  if(!a||!b || typeof a!=='string' || typeof b!=='string' || a.length!==b.length) return false;
  let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;
}
function allowedAdmin(request,env) {
  return typeof env.ADMIN_TOKEN==='string' && env.ADMIN_TOKEN.length>=32 && constantEquals(request.headers.get('authorization'),`Bearer ${env.ADMIN_TOKEN}`);
}
function baseUrl(request) {return new URL(request.url).origin;}
function installUrl(base,token) {return `${base}/p/${token}/manifest.json`;}
async function one(db,sql,...values) {return db.prepare(sql).bind(...values).first();}
async function run(db,sql,...values) {return db.prepare(sql).bind(...values).run();}
async function byId(env,id) {return one(env.DB,'SELECT * FROM profiles WHERE id = ?',id);}
async function publicProfile(env,token) {
  if(!VALID_TOKEN.test(token))return null;
  return one(env.DB,'SELECT id,name,reason_title FROM profiles WHERE token_sha256 = ?',await sha(token));
}
async function createProfile(env,name,origin) {
  if(!name || typeof name!=='string'||name.trim().length>50) return null;
  const token=randomToken(),id=crypto.randomUUID();
  await run(env.DB,'INSERT INTO profiles (id,name,token_sha256,token_box) VALUES (?,?,?,?)',id,name.trim(),await sha(token),await seal(env,token));
  return {id,name:name.trim(),installUrl:installUrl(origin,token),status:'unlinked'};
}
async function listProfiles(env,origin) {
  const {results=[]}=await env.DB.prepare('SELECT * FROM profiles ORDER BY created_at').bind().all();
  const output=[];
  for (const p of results) {
    const token=await openBox(env,p.token_box);
    output.push({id:p.id,name:p.name,status:p.status,syncedAt:p.synced_at,installUrl:installUrl(origin,token)});
  }
  return output;
}
function toManifest(profile) {
  return {id:`org.nuvio.reco.${profile.id}`,version:'0.4.0',name:`Nuvio Reco — ${profile.name}`,
    description:'Recommandations personnalisées à partir de Trakt',resources:['catalog','meta'],types:['movie','series'],
    catalogs:['movie','series'].flatMap(type=>LANES.map(([id,name])=>({id,type,name:id==='because-watched'&&profile.reason_title?`Parce que vous avez regardé ${String(profile.reason_title).slice(0,45)}`:name}))),
    idPrefixes:['tt','tmdb:'],behaviorHints:{configurable:false}};
}
function safePathId(id){return /^tt\d+$/.test(id)||/^tmdb:\d+$/.test(id);}
async function catalogFor(env,profileId,type,lane) {
  const row=await one(env.DB,'SELECT metas_json FROM catalogs WHERE profile_id=? AND type=? AND lane=?',profileId,type,lane);
  return row ? JSON.parse(row.metas_json) : [];
}
function normaliseMovieOrSeriesHistory(type,events) {return parsedHistory(events,type);}
function accessNeedsRefresh(token) {
  const created=Number(token.created_at||0),expires=Number(token.expires_in||604800);
  return !created || Date.now()/1000 > created + expires - 3600;
}
async function getAuthToken(env,profile,fetcher) {
  if(!profile.trakt_box)throw Error('Trakt account is not connected');
  let auth=await openBox(env,profile.trakt_box);
  if(accessNeedsRefresh(auth)) {
    if(!auth.refresh_token)throw Error('Missing Trakt refresh token: reconnect required');
    const next=await refreshTraktToken(env,auth,fetcher);
    if(!next?.access_token||!next?.refresh_token)throw Error('Trakt refresh failed: reconnect required');
    auth=next;
    // Persist replacement immediately: Trakt refresh tokens are single use.
    await run(env.DB,'UPDATE profiles SET trakt_box = ? WHERE id = ?',await seal(env,auth),profile.id);
  }
  return auth.access_token;
}

async function buildAndStore(env,profile,fetcher=fetch) {
  if(!env.TMDB_READ_TOKEN)throw Error('TMDB_READ_TOKEN missing');
  const token=await getAuthToken(env,profile,fetcher);
  // Maximum 3 watched-summary pages per media type: bounds Workers Free subrequest usage.
  const [movieHistory,seriesHistory]=await Promise.all([
    getWatched(env,token,'movies',{fetcher,maxPages:3}),getWatched(env,token,'shows',{fetcher,maxPages:3})
  ]);
  const movies=normaliseMovieOrSeriesHistory('movie',movieHistory.events);
  const series=normaliseMovieOrSeriesHistory('series',seriesHistory.events);
  const recent=[...movies.slice(0,2),...series.slice(0,2)].sort((a,b)=>b.date.localeCompare(a.date));
  const genreWeights={movie:{},series:{}};
  const reasonGenres={movie:[],series:[]};
  const recommended={movie:[],series:[]};

  // Recent completed titles reveal tastes. TMDB details are requested for at most 4 watches.
  for(const [kind,list] of [['movie',movies.slice(0,2)],['series',series.slice(0,2)]]) {
    for(const [idx,w] of list.entries()) {
      const tmdbPath=kind==='movie'?'movie':'tv';
      try {
        const detail=await getTmdb(env,`/${tmdbPath}/${w.tmdbId}`,fetcher);
        const ids=(detail.genres||[]).map(g=>Number(g.id));
        if(idx===0)reasonGenres[kind]=ids;
        for(const genre of ids)genreWeights[kind][genre]=(genreWeights[kind][genre]||0)+(idx===0?4:2);
      } catch { /* An unavailable title should not invalidate a full sync. */ }
    }
    const tmdbKind=kind==='movie'?'movie':'tv';
    // Collect trending & established titles, plus taste-based recommendations.
    for(const url of [`/trending/${tmdbKind}/week`,`/discover/${tmdbKind}?sort_by=popularity.desc&vote_count.gte=50`]){
      const page=await getTmdb(env,url,fetcher);
      recommended[kind].push(...(page.results||[]));
    }
    if(list[0]?.tmdbId) {
      try {
        const similar=await getTmdb(env,`/${tmdbKind}/${list[0].tmdbId}/recommendations`,fetcher);
        recommended[kind].push(...(similar.results||[]));
      }catch{/* Continue with trending pool. */}
    }
  }
  const watched={movie:movies.map(x=>x.tmdbId),series:series.map(x=>x.tmdbId)};
  const reasonTitle=recent[0]?.name||null;
  const day=NOW().slice(0,10);
  const output=[];
  for(const type of ['movie','series']) {
    const unique=new Map();
    for(const raw of recommended[type]) {
      const item=normalizeTmdb(raw,type);
      if(item && !unique.has(item.tmdbId))unique.set(item.tmdbId,item);
    }
    const preliminary=rankCandidates({candidates:[...unique.values()],type,lane:'for-you',profileId:profile.id,day,
      watched:watched[type],genreWeights:genreWeights[type],reasonGenres:reasonGenres[type]}).slice(0,LIMIT);
    // IMDb IDs are preferred for interoperability with existing Nuvio playback addons.
    for(const row of preliminary) {
      if(row.imdbId)continue;
      try {
        const prefix=type==='movie'?'movie':'tv';
        const details=await getTmdb(env,`/${prefix}/${row.tmdbId}${type==='series'?'?append_to_response=external_ids':''}`,fetcher);
        const imdbId=details.imdb_id||details.external_ids?.imdb_id;
        if(typeof imdbId==='string'&&/^tt\d+$/.test(imdbId))row.imdbId=imdbId;
      }catch { /* TMDB fallback id may not resolve in every stream addon. */ }
    }
    // Use the same enriched pool to keep recommendation rows consistent and bounded.
    for(const lane of LANES_SET) {
      const ranked=rankCandidates({candidates:preliminary,type,lane,profileId:profile.id,day,watched:watched[type],
        genreWeights:genreWeights[type],reasonGenres:reasonGenres[type]}).map(toStremioMeta);
      output.push({type,lane,metas:ranked});
    }
  }
  // Staging completes before replacing a profile's cache; errors preserve old catalogs.
  // D1 batch executes these writes atomically.
  const updates=output.map(c=>env.DB.prepare('INSERT INTO catalogs (profile_id,type,lane,metas_json,generated_at) VALUES (?,?,?,?,?) ON CONFLICT(profile_id,type,lane) DO UPDATE SET metas_json=excluded.metas_json,generated_at=excluded.generated_at')
    .bind(profile.id,c.type,c.lane,JSON.stringify(c.metas),NOW()));
  updates.push(env.DB.prepare('UPDATE profiles SET watched_json=?,reason_title=?,status=?,synced_at=? WHERE id=?')
    .bind(JSON.stringify(watched),reasonTitle,'connected',NOW(),profile.id));
  await env.DB.batch(updates);
  return {profileId:profile.id,movies:movies.length,series:series.length,catalogs:output.length,
    incompleteHistory:movieHistory.truncated||seriesHistory.truncated,reasonTitle};
}

async function adminRequest(request,env,url,fetcher) {
  if(!allowedAdmin(request,env))return respond({error:'unauthorized'},401);
  if(!env.DB || !env.ENCRYPTION_KEY) return respond({error:'server_not_configured'},503);
  const path=url.pathname;
  if(path==='/admin/status' && request.method==='GET') {
    return respond({ready:!!env.TRAKT_CLIENT_ID&&!!env.TMDB_READ_TOKEN,provider:'Trakt',database:'D1',deployment:'Cloudflare Workers'});
  }
  if(path==='/admin/profiles') {
    if(request.method==='GET')return respond({profiles:await listProfiles(env,url.origin)});
    if(request.method==='POST') {
      const body=await request.json().catch(()=>null);
      const profile=await createProfile(env,body?.name,url.origin);
      return profile?respond(profile,201):respond({error:'invalid_name'},400);
    }
  }
  const matched=/^\/admin\/profiles\/([a-f0-9-]{36})\/(device\/start|device\/complete|sync|rotate|disconnect)$/.exec(path);
  if(!matched)return respond({error:'not_found'},404);
  const id=matched[1],action=matched[2];
  const profile=await byId(env,id);
  if(!profile)return respond({error:'not_found'},404);
  if(request.method!=='POST')return respond({error:'method_not_allowed'},405);
  if(action==='device/start') {
    const challenge=await requestDeviceCode(env,fetcher);
    const box=await seal(env,{device_code:challenge.device_code,expiresAt:Date.now()+challenge.expires_in*1000,interval:Number(challenge.interval||5),lastPolledAt:0});
    await run(env.DB,'UPDATE profiles SET pending_device_box=? WHERE id=?',box,id);
    return respond({userCode:challenge.user_code,verificationUrl:challenge.verification_url,
      expiresIn:challenge.expires_in,interval:challenge.interval});
  }
  if(action==='device/complete') {
    if(!profile.pending_device_box)return respond({error:'device_not_started'},409);
    const pending=await openBox(env,profile.pending_device_box);
    if(Date.now()>pending.expiresAt)return respond({error:'device_expired'},410);
    if(Date.now() - pending.lastPolledAt < pending.interval*1000)return respond({status:'wait',retryAfterSeconds:pending.interval},202);
    pending.lastPolledAt=Date.now();
    await run(env.DB,'UPDATE profiles SET pending_device_box=? WHERE id=?',await seal(env,pending),id);
    try {
      const tokens=await redeemDeviceCode(env,pending.device_code,fetcher);
      if(!tokens?.access_token||!tokens?.refresh_token)throw Error('Incomplete Trakt response');
      await run(env.DB,'UPDATE profiles SET trakt_box=?,pending_device_box=NULL,status=? WHERE id=?',await seal(env,tokens),'linked',id);
      return respond({status:'linked'});
    } catch(error) {
      if([400,404,409,410,418,428,429].includes(error.status))return respond({status:'pending',retryAfterSeconds:pending.interval},202);
      throw error;
    }
  }
  if(action==='sync')return respond(await buildAndStore(env,profile,fetcher));
  if(action==='rotate') {
    const token=randomToken();
    await run(env.DB,'UPDATE profiles SET token_sha256=?,token_box=? WHERE id=?',await sha(token),await seal(env,token),id);
    return respond({installUrl:installUrl(url.origin,token)});
  }
  if(action==='disconnect') {
    await run(env.DB,'UPDATE profiles SET trakt_box=NULL,pending_device_box=NULL,watched_json=?,status=?,synced_at=NULL WHERE id=?',JSON.stringify({movie:[],series:[]}), 'unlinked',id);
    await run(env.DB,'DELETE FROM catalogs WHERE profile_id=?',id);
    return respond({status:'unlinked'});
  }
  return respond({error:'not_found'},404);
}

export async function handle(request,env,fetcher=fetch) {
  const url=new URL(request.url),path=url.pathname;
  try {
    if(path==='/health' && request.method==='GET')return respond({ok:true,service:'nuvio-reco-cloudflare'},200,true);
    if(path==='/setup' && request.method==='GET')return new Response(setupHtml,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'"}});
    if(path==='/setup.js' && request.method==='GET')return new Response(setupScript,{headers:{'content-type':'application/javascript; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
    if(path.startsWith('/admin/'))return adminRequest(request,env,url,fetcher);
    if(request.method==='OPTIONS' && path.startsWith('/p/'))return new Response(null,{status:204,headers:CORS});
    if(request.method!=='GET')return respond({error:'method_not_allowed'},405,true);
    const match=/^\/p\/([a-f0-9]{64})\/(manifest\.json|catalog\/(movie|series)\/(for-you|because-watched|daily)\.json|meta\/(movie|series)\/([^/]+)\.json)$/.exec(path);
    if(!match)return respond({error:'not_found'},404,true);
    const profile=await publicProfile(env,match[1]);
    if(!profile)return respond({error:'not_found'},404,true);
    if(match[2]==='manifest.json')return respond(toManifest(profile),200,true);
    if(match[3])return respond({metas:await catalogFor(env,profile.id,match[3],match[4])},200,true);
    if(match[5] && safePathId(match[6])){
      for(const [id] of LANES){
        const metas=await catalogFor(env,profile.id,match[5],id);
        const title=metas.find(m=>m.id===match[6]);
        if(title)return respond({meta:title},200,true);
      }
    }
    return respond({error:'not_found'},404,true);
  } catch(error) {
    // API details (including OAuth tokens) must never appear in public HTTP responses.
    console.error('nuvio-reco worker error:',error.message?.slice(0,100)||'unknown');
    return respond({error:'operation_failed',hint:path.startsWith('/admin/')?'Check Cloudflare logs and provider configuration':undefined},503);
  }
}

export async function scheduledSync(env,fetcher=fetch) {
  if(!env.DB||!env.TMDB_READ_TOKEN||!env.TRAKT_CLIENT_ID||!env.ENCRYPTION_KEY)return {skipped:'not_configured'};
  const p=await one(env.DB,"SELECT * FROM profiles WHERE trakt_box IS NOT NULL AND (synced_at IS NULL OR datetime(synced_at) < datetime('now', '-6 hours')) ORDER BY COALESCE(synced_at,'1970-01-01') ASC LIMIT 1");
  return p?buildAndStore(env,p,fetcher):{skipped:'up_to_date'};
}

export default {
  fetch(request,env){return handle(request,env);},
  scheduled(_event,env,ctx){ctx.waitUntil(scheduledSync(env).catch(e=>console.error('nuvio-reco scheduled sync failed:',e.message?.slice(0,100)||'unknown')));},
};
