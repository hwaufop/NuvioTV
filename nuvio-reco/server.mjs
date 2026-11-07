import http from 'node:http';
import fs from 'node:fs';
import crypto from 'node:crypto';

const PORT = Number(process.env.PORT || 7000);
const BASE_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const LANES = [
  ['for-you', 'Pour vous'],
  ['because-you-watched', 'Parce que vous avez regardé…'],
  ['daily', 'Votre sélection du jour']
];

function readData() {
  const config = JSON.parse(fs.readFileSync(process.env.RECO_DATA_FILE || new URL('./profiles.local.json', import.meta.url), 'utf8'));
  const catalog = JSON.parse(fs.readFileSync(process.env.RECO_CATALOG_FILE || new URL('./catalog.local.json', import.meta.url), 'utf8'));
  if (!Array.isArray(config.profiles) || !Array.isArray(catalog)) throw new Error('Invalid configuration');
  return {profiles:config.profiles,catalog};
}
function profileFromToken(profiles, token) {
  if (!/^[a-f0-9]{32,128}$/i.test(token)) return null;
  return profiles.find(p => typeof p.token === 'string' && p.token.length === token.length &&
    crypto.timingSafeEqual(Buffer.from(p.token), Buffer.from(token))) || null;
}
function hash(text) { return crypto.createHash('sha256').update(text).digest().readUInt32BE(0); }
function score(title, profile, lane, day) {
  const favorites = new Set(profile.favoriteGenres || []);
  const recent = new Set(profile.recentlyWatchedGenres || []);
  const match = (title.genres || []).filter(g => favorites.has(g)).length;
  const similar = (title.genres || []).filter(g => recent.has(g)).length;
  const base = match*5 + similar*6 + (title.rating||0)*1.6 + (title.popularity||0)*.02;
  const diversity = (hash(`${profile.token}:${title.id}:${day}`) % 1000)/1000;
  if (lane === 'because-you-watched') return similar*10+match*3+(title.rating||0)+diversity;
  if (lane === 'daily') return base*.45+diversity*12;
  return base + diversity*1.5 + (new Set(profile.likedIds||[]).has(title.id)?3:0);
}
export function recommend(profile, catalog, type, lane, day=new Date().toISOString().slice(0,10)) {
  const watched=new Set(profile.watchedIds||[]), hidden=new Set(profile.hiddenIds||[]);
  return catalog.filter(t=>t.type===type && typeof t.id==='string' && /^(tt\d+|tmdb:\d+)$/.test(t.id) &&
    typeof t.name==='string' && typeof t.poster==='string' && !watched.has(t.id) && !hidden.has(t.id))
    .sort((a,b)=>score(b,profile,lane,day)-score(a,profile,lane,day)||a.id.localeCompare(b.id))
    .slice(0,30).map(t=>({id:t.id,type:t.type,name:t.name,poster:t.poster,...(t.description?{description:t.description}:{})}));
}
function send(res,status,data) {
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'private, max-age=300',
    'access-control-allow-origin':'*','x-content-type-options':'nosniff'});
  res.end(JSON.stringify(data));
}
export function handler(req,res) {
  if(req.method!=='GET') return send(res,405,{error:'method_not_allowed'});
  const pathname=new URL(req.url,BASE_URL).pathname;
  if(pathname==='/health') return send(res,200,{ok:true,service:'nuvio-reco'});
  const match=/^\/p\/([a-fA-F0-9]{32,128})\/(manifest\.json|catalog\/(movie|series)\/(for-you|because-you-watched|daily)\.json)$/.exec(pathname);
  if(!match) return send(res,404,{error:'not_found'});
  let profiles,catalog;
  try { ({profiles,catalog}=readData()); } catch { return send(res,503,{error:'config_unavailable'}); }
  const profile=profileFromToken(profiles,match[1]);
  if(!profile) return send(res,404,{error:'not_found'});
  if(match[2]==='manifest.json') return send(res,200,{
    id:'org.nuvio.reco.'+crypto.createHash('sha256').update(profile.token).digest('hex').slice(0,16),
    version:'0.1.0',name:'Nuvio Reco - '+(profile.name||'Profil'),
    description:'Catalogues personnalisés privés',
    resources:['catalog'],types:['movie','series'],
    catalogs:['movie','series'].flatMap(type=>LANES.map(([id,name])=>({type,id,name}))),
    idPrefixes:['tt','tmdb:'],behaviorHints:{configurable:false}
  });
  return send(res,200,{metas:recommend(profile,catalog,match[3],match[4])});
}
if(process.argv[1] && import.meta.url===new URL('file://'+process.argv[1]).href){
  http.createServer(handler).listen(PORT,'0.0.0.0',()=>console.log('Nuvio Reco listening on port '+PORT));
}
