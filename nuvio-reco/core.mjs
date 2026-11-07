import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const DATA_DIR = process.env.DATA_DIR || path.join(path.dirname(new URL(import.meta.url).pathname), 'data');
export const PROFILE_FILE = process.env.RECO_DATA_FILE || path.join(DATA_DIR, 'profiles.json');
export const CATALOG_FILE = process.env.RECO_CATALOG_FILE || path.join(DATA_DIR, 'catalog.json');
export const LANES = [
  ['for-you','Pour vous'],
  ['because-you-watched','Parce que vous avez regardé…'],
  ['daily','Votre sélection du jour']
];
export const VALID_TOKEN = /^[a-f0-9]{48,128}$/i;
export const VALID_IMDB = /^tt\d{5,12}$/;

export function loadJSON(filename,fallback) {
  try { return JSON.parse(fs.readFileSync(filename, 'utf8')); }
  catch(e) { if (e.code === 'ENOENT') return fallback; throw e; }
}
export function saveJSON(filename,data){
  fs.mkdirSync(path.dirname(filename),{recursive:true,mode:0o700});
  const temp=filename+'.'+crypto.randomBytes(6).toString('hex')+'.tmp';
  try { fs.writeFileSync(temp,JSON.stringify(data,null,2)+'\n',{mode:0o600,flag:'wx'});fs.renameSync(temp,filename); }
  finally { try{fs.unlinkSync(temp)}catch{} }
}
export function loadProfiles(){
  const data=loadJSON(PROFILE_FILE,{profiles:[]});
  if (!Array.isArray(data.profiles)) throw new Error('Invalid profiles store');
  return data;
}
export function loadCatalog(){
  const data=loadJSON(CATALOG_FILE,[]);
  if (!Array.isArray(data)) throw new Error('Invalid catalog');
  return data;
}
export function profileForToken(token,profiles){
  if(!VALID_TOKEN.test(token)) return null;
  return profiles.find(p=>typeof p.token==='string' && p.token.length===token.length && VALID_TOKEN.test(p.token) &&
    crypto.timingSafeEqual(Buffer.from(p.token.toLowerCase()),Buffer.from(token.toLowerCase())))||null;
}
export function sealSecret(secret,key=process.env.RECO_SECRET_KEY){
  if(!/^[0-9a-f]{64}$/i.test(key||''))throw new Error('RECO_SECRET_KEY must contain 64 hexadecimal characters');
  const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',Buffer.from(key,'hex'),iv);
  const encrypted=Buffer.concat([cipher.update(secret,'utf8'),cipher.final()]);
  return {alg:'aes-256-gcm',iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:encrypted.toString('base64')};
}
export function openSecret(saved,key=process.env.RECO_SECRET_KEY){
  if(!/^[0-9a-f]{64}$/i.test(key||''))throw new Error('RECO_SECRET_KEY is required to decrypt private tokens');
  if(saved?.alg!=='aes-256-gcm')throw new Error('Encrypted token format not recognized');
  const decipher=crypto.createDecipheriv('aes-256-gcm',Buffer.from(key,'hex'),Buffer.from(saved.iv,'base64'));
  decipher.setAuthTag(Buffer.from(saved.tag,'base64'));
  return Buffer.concat([decipher.update(Buffer.from(saved.data,'base64')),decipher.final()]).toString('utf8');
}
export function newProfile(name){
  return {id:crypto.randomUUID(),name,token:crypto.randomBytes(32).toString('hex'),watchedIds:[],hiddenIds:[],likedIds:[],recentWatchedIds:[],favoriteGenres:[],recentlyWatchedGenres:[]};
}
const randomPart=s=>crypto.createHash('sha256').update(s).digest().readUInt32BE(0)/4294967296;
const setOf=v=>new Set(Array.isArray(v)?v:[]);
export function anchorTitle(profile,catalog,type){
  // Respect history order (latest first), not catalog order.
  for (const id of (profile.recentWatchedIds||[]).slice(0,40)) {
    const title=catalog.find(t=>t.type===type && t.id===id && Array.isArray(t.genres) && t.genres.length);
    if(title)return title;
  }
  return null;
}
export function recommend(profile,catalog,type,lane,day=new Date().toISOString().slice(0,10),opts={}){
  const favorite=setOf(profile.favoriteGenres),recent=setOf(profile.recentlyWatchedGenres);
  // When an imported history overlaps the catalog, learn tastes without manual genre setup.
  const recentHistory=setOf((profile.recentWatchedIds||[]).slice(0,30));
  const likedHistory=setOf(profile.likedIds);
  for (const watched of catalog){
    if(!recentHistory.has(watched.id) && !likedHistory.has(watched.id))continue;
    for(const g of watched.genres||[]){recent.add(g);if(likedHistory.has(watched.id))favorite.add(g);}
  }
  const seen=setOf(profile.watchedIds),hidden=setOf(profile.hiddenIds),liked=setOf(profile.likedIds);
  const anchor=anchorTitle(profile,catalog,type);
  const context=anchor?setOf(anchor.genres):recent;
  const ranks=[];
  for (const t of catalog){
    if(t?.type!==type || !VALID_IMDB.test(t.id||'') || !t.name || !t.poster || seen.has(t.id) || hidden.has(t.id)) continue;
    if (opts.genre && !t.genres?.includes(opts.genre)) continue;
    const genres=Array.isArray(t.genres)?t.genres:[];
    const fit=genres.filter(g=>favorite.has(g)).length;
    const similarity=genres.filter(g=>context.has(g)).length;
    const quality=Math.max(0,Math.min(10,Number(t.rating)||0));
    const votes=Math.min(2,Math.log10(1+Math.max(0,Number(t.voteCount)||0))/3);
    const novelty=randomPart(`${profile.id||profile.token}:${t.id}:${day}`);
    const base=fit*5+similarity*4+quality*1.1+votes+Math.log1p(Math.max(0,Number(t.popularity)||0))*.1;
    const points=lane==='because-you-watched'?similarity*15+fit*2+quality+novelty:
      lane==='daily'?base*.5+novelty*10:base+novelty+((liked.has(t.id))?1:0);
    // A no-history profile receives general high-quality recommendations, not a fabricated personal taste.
    ranks.push({t,points});
  }
  ranks.sort((a,b)=>b.points-a.points||a.t.id.localeCompare(b.t.id));
  const skip=Math.max(0,Math.min(1000,Number.parseInt(opts.skip,10)||0));
  return ranks.slice(skip,skip+30).map(({t})=>({id:t.id,type:t.type,name:t.name,poster:t.poster,posterShape:'poster',
    ...(t.description?{description:t.description}:{}),...(t.year?{releaseInfo:String(t.year)}:{})}));
}
export function buildManifest(profile,catalog){
  const hash=crypto.createHash('sha256').update(profile.token).digest('hex').slice(0,20);
  const catalogs=['movie','series'].flatMap(type=>LANES.map(([id,label])=>{
    const anchor=id==='because-you-watched'?anchorTitle(profile,catalog,type):null;
    return {type,id,name:anchor?`Parce que vous avez regardé ${anchor.name}`:
      id==='because-you-watched'?'Dans le style de vos découvertes':label,extra:[{name:'skip',isRequired:false}]};
  }));
  return {id:`org.nuvio.reco.${hash}`,version:'0.3.0',name:`Nuvio Reco — ${profile.name||'Profil'}`,
    description:'Catalogues adaptés à un seul profil',resources:['catalog','meta'],types:['movie','series'],idPrefixes:['tt'],
    catalogs,behaviorHints:{configurable:false}};
}
