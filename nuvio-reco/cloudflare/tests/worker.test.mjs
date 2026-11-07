import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {handle,scheduledSync} from '../src/worker.mjs';
import {getHistory, getWatched, parsedHistory} from '../src/providers.mjs';
import {normalizeTmdb,rankCandidates,toStremioMeta} from '../src/scoring.mjs';

class MockD1 {
  constructor() {this.db=new DatabaseSync(':memory:');this.db.exec(fs.readFileSync(new URL('../migrations/0001_init.sql',import.meta.url),'utf8'));}
  prepare(sql){const db=this.db;return {bind(...values){const s=db.prepare(sql);return {
    first:async()=>s.get(...values)||null,
    all:async()=>({results:s.all(...values)}),
    run:async()=>s.run(...values),
    exec:()=>s.run(...values)
  };}};
  }
  async batch(statements){this.db.exec('BEGIN');try{const values=statements.map(s=>s.exec());this.db.exec('COMMIT');return values;}catch(e){this.db.exec('ROLLBACK');throw e;}}
}
const cfg=()=>({DB:new MockD1(),ADMIN_TOKEN:'Z'.repeat(48),ENCRYPTION_KEY:'a'.repeat(64),TRAKT_CLIENT_ID:'fake-trakt-app',TMDB_READ_TOKEN:'fake-tmdb-token'});
const admin=(path,options={})=>new Request('https://nuvio.example'+path,{method:options.method||'GET',headers:{authorization:'Bearer '+ 'Z'.repeat(48),...(options.body?{'content-type':'application/json'}:{})},...(options.body?{body:JSON.stringify(options.body)}:{})});
async function call(req,env,fetcher){const r=await handle(req,env,fetcher);return {status:r.status,body:await r.json()};}
const poster='/poster.jpg';
function movie(id,name,genres=[878]){return {id,title:name,name,poster_path:poster,genre_ids:genres,vote_average:8,vote_count:100,overview:'Sample'};}
function mockProvider(url,options={}){
  const u=String(url);const json=(body,headers={})=>new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json',...headers}});
  if(u.endsWith('/oauth/device/code'))return json({device_code:'code-private',user_code:'CODETEST',verification_url:'https://trakt.tv/activate',expires_in:600,interval:5});
  if(u.endsWith('/oauth/device/token'))return json({access_token:'secret-access',refresh_token:'secret-refresh',created_at:Math.floor(Date.now()/1000),expires_in:604800});
  if(u.includes('/sync/watched/movies')||u.includes('/sync/history/movies'))return json([{watched_at:'2026-10-01T01:00:00Z',movie:{ids:{tmdb:100,imdb:'tt0000100'},title:'Film déjà vu'}}],{'X-Pagination-Page-Count':'1'});
  if(u.includes('/sync/watched/shows')||u.includes('/sync/history/shows'))return json([{watched_at:'2026-10-02T01:00:00Z',show:{ids:{tmdb:300,imdb:'tt0000300'},title:'Série déjà vue'}}],{'X-Pagination-Page-Count':'1'});
  if(u.includes('/movie/100'))return json({...movie(100,'Film déjà vu'),genres:[{id:878}]});
  if(u.includes('/tv/300'))return json({...movie(300,'Série déjà vue',[18]),genres:[{id:18}]});
  if(u.includes('/trending/movie'))return json({results:[movie(101,'Science',[878]),movie(102,'Romance',[10749])]});
  if(u.includes('/discover/movie'))return json({results:[movie(103,'Fantasy',[14])]});
  if(u.includes('/movie/100/recommendations'))return json({results:[]});
  if(u.includes('/trending/tv'))return json({results:[movie(301,'TV Drama',[18])]});
  if(u.includes('/discover/tv'))return json({results:[movie(302,'TV Comedy',[35])]});
  if(u.includes('/tv/300/recommendations'))return json({results:[]});
  if(u.includes('/movie/')) { const id=Number((u.match(/\/movie\/(\d+)/)||[])[1]);return json({...movie(id,'TMDB Movie '+id),imdb_id:'tt'+String(id).padStart(7,'0')});}
  if(u.includes('/tv/')) { const id=Number((u.match(/\/tv\/(\d+)/)||[])[1]);return json({...movie(id,'TMDB Show '+id),external_ids:{imdb_id:'tt'+String(id).padStart(7,'0')}});}
  throw Error('Unexpected mock request '+u);
}

test('genre-aware sorting and already-watched exclusion',()=>{
  const arr=[normalizeTmdb(movie(101,'Sci-Fi',[878]),'movie'),normalizeTmdb(movie(102,'Rom-Com',[10749]),'movie')];
  const a=rankCandidates({candidates:arr,type:'movie',lane:'for-you',profileId:'a',day:'2026-11-07',genreWeights:{878:5},reasonGenres:[878]});
  const b=rankCandidates({candidates:arr,type:'movie',lane:'for-you',profileId:'b',day:'2026-11-07',genreWeights:{10749:5},reasonGenres:[10749]});
  assert.equal(a[0].tmdbId,101); assert.equal(b[0].tmdbId,102);
  assert.equal(rankCandidates({candidates:arr,type:'movie',lane:'for-you',profileId:'a',day:'2026-11-07',watched:[101]}).length,1);
  assert.equal(toStremioMeta(a[0]).id,'tmdb:101');
});

test('Trakt paging follows response headers and stops correctly',async()=>{
  const calls=[];
  const fetcher=async url=>{const page=Number(new URL(url).searchParams.get('page'));calls.push(page);return new Response(JSON.stringify([{watched_at:'2026-01-01',movie:{ids:{tmdb:page},title:'Test'}}]),{headers:{'X-Pagination-Page-Count':'2'}});};
  const r=await getHistory(cfg(),'token','movies',{fetcher,maxPages:4});
  assert.deepEqual(calls,[1,2]); assert.equal(r.truncated,false);
  assert.deepEqual(parsedHistory(r.events,'movie').map(x=>x.tmdbId),[1,2]);
});

test('Trakt paging reports truncation at the free-worker request budget',async()=>{
  const fetcher=async()=>new Response(JSON.stringify([{watched_at:'2026-01-01',movie:{ids:{tmdb:999},title:'Test'}}]),{headers:{'X-Pagination-Page-Count':'10'}});
  const r=await getHistory(cfg(),'token','movies',{fetcher,maxPages:2});
  assert.equal(r.truncated,true);
});

test('per-profile install tokens and unauthorized routes',async()=>{
  const env=cfg();
  const denied=await call(new Request('https://nuvio.example/admin/profiles'),env);
  assert.equal(denied.status,401);
  const a=await call(admin('/admin/profiles',{method:'POST',body:{name:'Cinema'}}),env);
  const b=await call(admin('/admin/profiles',{method:'POST',body:{name:'Series'}}),env);
  assert.equal(a.status,201);assert.equal(b.status,201);
  assert.notEqual(a.body.installUrl,b.body.installUrl);
  const m=await call(new Request(a.body.installUrl),env);
  assert.equal(m.status,200);assert.equal(m.body.catalogs.length,6);
  assert.equal(m.body.resources.includes('meta'),true);
  assert.equal((await call(new Request(a.body.installUrl.replace(/\/p\/[0-9a-f]{64}/, '/p/'+'f'.repeat(64))),env)).status,404);
  const list=await call(admin('/admin/profiles'),env);
  assert.equal(list.body.profiles.length,2);
});

test('OAuth device linking, encrypted storage and full sync with catalog and metadata',async()=>{
  const env=cfg();const create=await call(admin('/admin/profiles',{method:'POST',body:{name:'Main'}}),env);
  const id=create.body.id;
  const start=await call(admin(`/admin/profiles/${id}/device/start`,{method:'POST'}),env,mockProvider);
  assert.equal(start.status,200);assert.equal(start.body.userCode,'CODETEST');
  const complete=await call(admin(`/admin/profiles/${id}/device/complete`,{method:'POST'}),env,mockProvider);
  assert.equal(complete.status,200);assert.equal(complete.body.status,'linked');
  const stored=env.DB.db.prepare('SELECT * FROM profiles WHERE id=?').get(id);
  assert.equal(stored.trakt_box.includes('secret-access'),false);
  const sync=await call(admin(`/admin/profiles/${id}/sync`,{method:'POST'}),env,mockProvider);
  assert.equal(sync.status,200,JSON.stringify(sync.body));
  assert.equal(sync.body.movies,1);
  assert.equal(sync.body.series,1);
  const url=create.body.installUrl.replace('manifest.json','catalog/movie/for-you.json');
  const movies=await call(new Request(url),env);
  assert.equal(movies.status,200);assert.equal(movies.body.metas[0].id,'tt0000101');
  assert.ok(movies.body.metas.every(x=>x.id!=='tt0000100'));
  const series=await call(new Request(create.body.installUrl.replace('manifest.json','catalog/series/for-you.json')),env);
  assert.ok(series.body.metas.length>0);
  const meta=await call(new Request(create.body.installUrl.replace('manifest.json','meta/movie/tt0000101.json')),env);
  assert.equal(meta.body.meta.name,'Science');
});

test('rotate profile token invalidates old installation URL',async()=>{
  const env=cfg();const p=await call(admin('/admin/profiles',{method:'POST',body:{name:'Owner'}}),env);
  const rotated=await call(admin(`/admin/profiles/${p.body.id}/rotate`,{method:'POST'}),env);
  assert.equal(rotated.status,200);
  assert.equal((await call(new Request(p.body.installUrl),env)).status,404);
  assert.equal((await call(new Request(rotated.body.installUrl),env)).status,200);
});

test('disconnect revokes Trakt connection and clears cached recommendations',async()=>{
  const env=cfg();const p=await call(admin('/admin/profiles',{method:'POST',body:{name:'Owner'}}),env);
  const action=await call(admin(`/admin/profiles/${p.body.id}/disconnect`,{method:'POST'}),env);
  assert.equal(action.body.status,'unlinked');
  assert.deepEqual((await call(new Request(p.body.installUrl.replace('manifest.json','catalog/movie/for-you.json')),env)).body.metas,[]);
});

test('scheduled cron does not expose any data before Trakt linking',async()=>{
  const env=cfg();await call(admin('/admin/profiles',{method:'POST',body:{name:'Unlinked'}}),env);
  const result=await scheduledSync(env,mockProvider);
  assert.equal(result.skipped,'up_to_date');
});

test('Trakt watched summary uses explicit pagination',async()=>{
  const pages=[];
  const fetcher=async url=>{pages.push(new URL(url).searchParams.get('page'));
    return new Response(JSON.stringify([{last_watched_at:'2026-02-01',movie:{ids:{tmdb:Number(pages.length)},title:'Watch'}}]),
      {headers:{'X-Pagination-Page-Count':'2'}});
  };
  const out=await getWatched(cfg(),'token','movies',{fetcher,maxPages:5});
  assert.deepEqual(pages,['1','2']);
  assert.equal(out.truncated,false);
  assert.equal(parsedHistory(out.events,'movie').length,2);
});

test('simple setup interface is available without exposing secrets',async()=>{
  const env=cfg();
  const r=await handle(new Request('https://nuvio.example/setup'),env);
  assert.equal(r.status,200);
  const html=await r.text();
  assert.ok(html.includes('Nuvio Reco'));
  assert.equal(html.includes(env.ADMIN_TOKEN),false);
  const script=await handle(new Request('https://nuvio.example/setup.js'),env);
  assert.equal(script.status,200);
  assert.equal((await script.text()).includes(env.TRAKT_CLIENT_ID),false);
});
