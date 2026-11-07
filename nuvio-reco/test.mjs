import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'nuvio-reco-'));
process.env.DATA_DIR=temp;
const core=await import('./core.mjs');
const {handler}=await import('./server.mjs');
const {buildTmdbCatalog,fetchSimklHistory,beginSimklPin,pollSimklPin}=await import('./providers.mjs');
const {newProfile,recommend,loadProfiles,loadCatalog,saveJSON,PROFILE_FILE,CATALOG_FILE,buildManifest}=core;
const a={...newProfile('Cinéma'),favoriteGenres:['Sci-Fi'],recentlyWatchedGenres:['Sci-Fi']};
const b={...newProfile('Comédies'),favoriteGenres:['Romance'],recentlyWatchedGenres:['Romance']};
const catalog=[
{id:'tt0000001',type:'movie',name:'Space',poster:'https://example.com/a.jpg',genres:['Sci-Fi'],rating:8},
{id:'tt0000002',type:'movie',name:'Romance',poster:'https://example.com/b.jpg',genres:['Romance'],rating:8},
{id:'tt0000003',type:'movie',name:'Drama',poster:'https://example.com/c.jpg',genres:['Drama'],rating:5},
{id:'tt0000004',type:'series',name:'Series',poster:'https://example.com/d.jpg',genres:['Drama'],rating:6}];
function hit(url,method='GET'){
 let status,body,headers;
 handler({method,url},{writeHead(s,h){status=s;headers=h;},end(text){body=JSON.parse(text);}});
 return {status,body,headers};
}
test('tokens are generated and distinct',()=>{
 assert.equal(a.token.length,64);assert.notEqual(a.token,b.token);
});
test('separate preferences change the first recommendation',()=>{
 assert.equal(recommend(a,catalog,'movie','for-you')[0].id,'tt0000001');
 assert.equal(recommend(b,catalog,'movie','for-you')[0].id,'tt0000002');
});
test('exclude watched, hidden and unsupported IDs',()=>{
 const result=recommend({...a,watchedIds:['tt0000001'],hiddenIds:['tt0000003']},[...catalog,{id:'tmdb:99',type:'movie',name:'ID',poster:'https://example.com/x'}],'movie','for-you');
 assert.deepEqual(result.map(x=>x.id),['tt0000002']);
});
test('pagination and genre anchor are deterministic',()=>{
 const p={...a,watchedIds:['tt0000001'],recentWatchedIds:['tt0000001']};
 assert.match(buildManifest(p,catalog).catalogs[1].name,/Space/);
 assert.deepEqual(recommend(p,catalog,'movie','daily','2026-11-07',{skip:1}).length,1);
 assert.deepEqual(recommend(p,catalog,'movie','daily','2026-11-07'),recommend(p,catalog,'movie','daily','2026-11-07'));
});
test('profiles and catalog are loaded from private file store',()=>{
 saveJSON(PROFILE_FILE,{profiles:[a,b]});saveJSON(CATALOG_FILE,catalog);
 assert.equal(loadProfiles().profiles.length,2);assert.equal(loadCatalog().length,4);
 assert.equal(fs.statSync(PROFILE_FILE).mode&0o777,0o600);
});
test('manifest exposes catalog names without leaking private profile fields',()=>{
 const r=hit(`/p/${a.token}/manifest.json`);
 assert.equal(r.status,200);assert.equal(r.body.catalogs.length,6);
 assert.equal(JSON.stringify(r.body).includes(a.token),false);
 assert.equal(r.headers['access-control-allow-origin'],'*');
});
test('isolated catalog routes and missing token response',()=>{
 assert.equal(hit(`/p/${a.token}/catalog/movie/for-you.json`).body.metas[0].id,'tt0000001');
 assert.equal(hit(`/p/${b.token}/catalog/movie/for-you.json`).body.metas[0].id,'tt0000002');
 assert.equal(hit(`/p/${'f'.repeat(64)}/manifest.json`).status,404);
 assert.equal(hit(`/p/${a.token}/catalog/movie/for-you/skip=1.json`).body.metas.length,2);
});
test('meta route, health route, and unsupported methods',()=>{
 assert.equal(hit(`/p/${a.token}/meta/movie/tt0000001.json`).body.meta.name,'Space');
 assert.equal(hit(`/p/${a.token}/meta/movie/tt9999999.json`).status,404);
 assert.equal(hit('/health').body.ok,true);
 assert.equal(hit('/health','POST').status,405);
});
test('TMDB importer resolves IMDb IDs and movie/series with controlled mock',async()=>{
 const fetchImpl=async url=>{
  const u=new URL(url);
  if(u.pathname.includes('/genre/'))return {ok:true,json:async()=>({genres:[{id:18,name:'Drama'}]})};
  if(u.pathname.includes('/external_ids'))return {ok:true,json:async()=>({imdb_id:u.pathname.includes('tv')?'tt0000010':'tt0000009'})};
  return {ok:true,json:async()=>({results:[{id:11,poster_path:'/poster.jpg',genre_ids:[18],vote_count:100,
   title:'Movie',name:'Show',vote_average:8,popularity:11,release_date:'2024-01-01'}]})};
 };
 const result=await buildTmdbCatalog({token:'fake',fetchImpl,maxPerType:5});
 assert.equal(result.length,2);assert.deepEqual(result.map(x=>x.type).sort(),['movie','series']);
 assert.equal(result[0].genres[0],'Drama');
});
test('Simkl importer reads per-user watched IDs and never leaks bearer token',async()=>{
 const seen=[];
 const fetchImpl=async(url,opts)=>{seen.push({url,headers:opts.headers});
  if(url.includes('/movies/'))return {ok:true,json:async()=>({movies:[{movie:{ids:{imdb:'tt0000001'}},completed_at:'2026-01-01'}]})};
  return {ok:true,json:async()=>({shows:[{show:{ids:{imdb:'tt0000004'}},completed_at:'2026-01-02'}]})};};
 const result=await fetchSimklHistory({clientId:'app',accessToken:'secret',fetchImpl});
 assert.deepEqual(result.watchedIds,['tt0000004','tt0000001']);
 assert.equal(seen.length,2);assert.equal(seen[0].headers.authorization,'Bearer secret');
});
test('Simkl PIN flow builds expected documented endpoints',async()=>{
 const paths=[];const fetchImpl=async url=>{paths.push(new URL(url).pathname);return {ok:true,json:async()=>({user_code:'ABC'})}};
 await beginSimklPin({clientId:'test',fetchImpl});await pollSimklPin({clientId:'test',userCode:'ABC',fetchImpl});
 assert.deepEqual(paths,['/oauth/pin','/oauth/pin/ABC']);
});
test.after(()=>fs.rmSync(temp,{recursive:true,force:true}));

test('AES-GCM protects OAuth tokens and rejects wrong encryption key',()=>{
 const key='1'.repeat(64),wrong='2'.repeat(64);
 const enc=core.sealSecret('private-oauth-access-token',key);
 assert.equal(JSON.stringify(enc).includes('private-oauth-access-token'),false);
 assert.equal(core.openSecret(enc,key),'private-oauth-access-token');
 assert.throws(()=>core.openSecret(enc,wrong));
 assert.throws(()=>core.sealSecret('token','bad-key'));
});
test('Trakt importer loads movies and series independently',async()=>{
 const {fetchTraktHistory,traktDeviceCode}=await import('./trakt.mjs');
 const fetchImpl=async(url,opts)=>{
  const u=new URL(url);
  if(u.pathname==='/oauth/device/code'){
   assert.equal(opts.method,'POST');
   return {ok:true,status:200,json:async()=>({user_code:'CODE',device_code:'DEVICE'})};
  }
  if(u.pathname.endsWith('/movies')&&u.pathname.includes('/watched/'))return {ok:true,status:200,headers:{get:()=> '1'},json:async()=>[{movie:{ids:{imdb:'tt0000001'}},last_watched_at:'2026-11-07'}]};
  if(u.pathname.endsWith('/shows')&&u.pathname.includes('/watched/'))return {ok:true,status:200,headers:{get:()=> '1'},json:async()=>[{show:{ids:{imdb:'tt0000004'}},last_watched_at:'2026-11-06'}]};
  return {ok:true,status:200,headers:{get:()=> '1'},json:async()=>[]};
 };
 const device=await traktDeviceCode({clientId:'fake',fetchImpl});
 assert.equal(device.user_code,'CODE');
 const history=await fetchTraktHistory({clientId:'fake',accessToken:'tok',fetchImpl});
 assert.deepEqual(history.watchedIds,['tt0000001','tt0000004']);
});
test('Simkl sync uses activity endpoint, then skips unchanged history',async()=>{
 const {syncSimklIfChanged}=await import('./providers.mjs');
 const key='f'.repeat(64);process.env.RECO_SECRET_KEY=key;
 const profiles=loadProfiles();
 profiles.profiles[0].simklTokenEncrypted=core.sealSecret('secret',key);
 saveJSON(PROFILE_FILE,profiles);
 const urls=[];
 const fetchImpl=async(url)=>{
  urls.push(url);
  if(url.includes('activities'))return {ok:true,status:200,json:async()=>({movies:{completed_at:'2026-11-07'}})};
  if(url.includes('movies/'))return {ok:true,status:200,json:async()=>({movies:[{movie:{ids:{imdb:'tt0000001'}},completed_at:'2026-11-07'}]})};
  return {ok:true,status:200,json:async()=>({shows:[]})};
 };
 const first=await syncSimklIfChanged(a.id,{clientId:'app',fetchImpl});
 assert.equal(first.status,'updated');assert.equal(first.mode,'full');
 const next=await syncSimklIfChanged(a.id,{clientId:'app',fetchImpl});
 assert.equal(next.status,'unchanged');
 assert.equal(urls.filter(u=>u.includes('activities')).length,2);
 assert.equal(urls.filter(u=>u.includes('all-items')).length,2);
 delete process.env.RECO_SECRET_KEY;
});


test('Trakt watched pagination follows server page count and includes all films', async()=>{
 const {fetchTraktHistory}=await import('./trakt.mjs');
 const called=[];
 const fetchImpl=async(url)=>{
  const u=new URL(url),page=Number(u.searchParams.get('page'));called.push(`${u.pathname}:${page}`);
  assert.equal(u.searchParams.get('limit'),'250');
  const isMovie=u.pathname==='/sync/watched/movies';
  const rows=isMovie&&page===1?[{movie:{ids:{imdb:'tt0000001'}},last_watched_at:'2026-11-01'}]:
   isMovie&&page===2?[{movie:{ids:{imdb:'tt0000002'}},last_watched_at:'2026-11-06'}]:[];
  const pages=isMovie?'2':'1';
  return {status:200,ok:true,headers:{get:(name)=>name==='x-pagination-page-count'?pages:null},json:async()=>rows};
 };
 const h=await fetchTraktHistory({clientId:'test-app',accessToken:'test-token',fetchImpl});
 assert.deepEqual(h.watchedIds,['tt0000002','tt0000001']);
 assert.deepEqual(called.slice(0,2),['/sync/watched/movies:1','/sync/watched/movies:2']);
 assert.equal(called.includes('/sync/watched/movies:3'),false);
});
test('Trakt pagination without headers fetches until empty page',async()=>{
 const {fetchTraktHistory}=await import('./trakt.mjs');
 const paths=[];
 const fetchImpl=async(url)=>{
  const u=new URL(url),page=Number(u.searchParams.get('page'));
  paths.push(`${u.pathname}:${page}`);
  return {ok:true,status:200,json:async()=>u.pathname==='/sync/watched/movies'&&page===1?
   [{movie:{ids:{imdb:'tt0000001'}}}]:[]};
 };
 const h=await fetchTraktHistory({clientId:'app',accessToken:'token',fetchImpl});
 assert.deepEqual(h.watchedIds,['tt0000001']);
 assert.deepEqual(paths.slice(0,2),['/sync/watched/movies:1','/sync/watched/movies:2']);
});
test('Trakt fails closed on duplicated pages and errors (no partial history)',async()=>{
 const {fetchTraktHistory}=await import('./trakt.mjs');
 const duplicate=async(url)=>({ok:true,status:200,json:async()=>[{movie:{ids:{imdb:'tt0000001'}}}]});
 await assert.rejects(fetchTraktHistory({clientId:'app',accessToken:'token',fetchImpl:duplicate}),/loop detected/);
 const failure=async(url)=>({ok:false,status:429,json:async()=>null});
 await assert.rejects(fetchTraktHistory({clientId:'app',accessToken:'token',fetchImpl:failure}),/429/);
});
test('Trakt token normalization guards missing created_at',async()=>{
 const {normalizeAuth}=await import('./trakt.mjs');
 const now=Math.floor(Date.now()/1000);
 const normalized=normalizeAuth({access_token:'a',refresh_token:'b'});
 assert.ok(normalized.created_at>=now-1);
 assert.equal(normalized.expires_in,604800);
});


test('TMDB adds previously watched Trakt titles as training references',async()=>{
 const recentId='tt8765432';
 const fetchImpl=async(url)=>{
  const u=new URL(url);
  if(u.pathname.includes('/genre/'))return {ok:true,json:async()=>({genres:[{id:878,name:'Science-fiction'},{id:18,name:'Drame'}]})};
  if(u.pathname.includes('/find/'))return {ok:true,json:async()=>({movie_results:[{id:900,poster_path:'/older.jpg',title:'Old watched film',genre_ids:[878],vote_count:400,vote_average:8.3}],tv_results:[]})};
  if(u.pathname.includes('/external_ids'))return {ok:true,json:async()=>({imdb_id:u.pathname.includes('/tv/')?'tt0000010':'tt0000009'})};
  return {ok:true,json:async()=>({results:[{id:1,poster_path:'/movie.jpg',title:'Discovery',name:'Series',genre_ids:[18],vote_count:100,vote_average:7.5}]})};
 };
 const result=await buildTmdbCatalog({token:'fake',fetchImpl,maxPerType:5,profiles:[{recentWatchedIds:[recentId],likedIds:[]}]});
 assert.ok(result.find(x=>x.id===recentId));
 const history=result.find(x=>x.id===recentId);
 assert.deepEqual(history.genres,['Science-fiction']);
 assert.equal(history.name,'Old watched film');
});
test('Trakt sync activity fingerprint avoids extra fetch and isolates profiles',async()=>{
 const {syncTraktIfChanged}=await import('./trakt.mjs');
 const key='a'.repeat(64);
 process.env.RECO_SECRET_KEY=key;
 const profiles=loadProfiles();
 const tracked=profiles.profiles.find(p=>p.id===a.id);
 tracked.traktAuthEncrypted=core.sealSecret(JSON.stringify({access_token:'token',refresh_token:'refresh',created_at:Math.floor(Date.now()/1000),expires_in:604800}),key);
 tracked.historySource='trakt';
 saveJSON(PROFILE_FILE,profiles);
 const urlPaths=[];
 const fetchImpl=async(url)=>{
  const u=new URL(url);urlPaths.push(u.pathname);
  if(u.pathname==='/sync/last_activities')return {ok:true,status:200,json:async()=>({movies:{watched_at:'2026-11-07'}})};
  if(u.pathname==='/sync/watched/movies')return {ok:true,status:200,headers:{get:()=> '1'},json:async()=>[{movie:{ids:{imdb:'tt0000001'}},last_watched_at:'2026-11-06'}]};
  return {ok:true,status:200,headers:{get:()=> '1'},json:async()=>[]};
 };
 const first=await syncTraktIfChanged(a.id,{clientId:'fake',fetchImpl});
 assert.equal(first.status,'updated');
 const second=await syncTraktIfChanged(a.id,{clientId:'fake',fetchImpl});
 assert.equal(second.status,'unchanged');
 assert.deepEqual(loadProfiles().profiles.find(p=>p.id===b.id).watchedIds,[]);
 assert.equal(urlPaths.filter(x=>x.includes('/watched/')).length,2);
 delete process.env.RECO_SECRET_KEY;
});
