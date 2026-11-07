import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {syncAll} from './providers.mjs';
import path from 'node:path';
import {loadProfiles,loadCatalog,profileForToken,recommend,buildManifest,VALID_IMDB} from './core.mjs';
const PORT=Number(process.env.PORT||7000);
const HOST=process.env.HOST||'127.0.0.1';
const ROUTE=/^\/p\/([a-fA-F0-9]{48,128})\/(manifest\.json|catalog\/(movie|series)\/(for-you|because-you-watched|daily)(?:\/skip=(\d+))?\.json|meta\/(movie|series)\/(tt\d{5,12})\.json)$/;
const send=(res,status,body,cache='private, max-age=300')=>{res.writeHead(status,{
 'content-type':'application/json; charset=utf-8','access-control-allow-origin':'*',
 'cache-control':cache,'x-content-type-options':'nosniff','referrer-policy':'no-referrer'});res.end(JSON.stringify(body));};
export function handler(req,res){
  if(req.method!=='GET') return send(res,405,{error:'method_not_allowed'});
  let pathname;
  try{pathname=new URL(req.url,'http://localhost').pathname;}catch{return send(res,400,{error:'invalid_path'});}
  if(pathname==='/health') return send(res,200,{ok:true,service:'nuvio-reco'});
  const m=ROUTE.exec(pathname);
  if(!m) return send(res,404,{error:'not_found'});
  let profiles,catalog;
  try{profiles=loadProfiles().profiles;catalog=loadCatalog();}
  catch(e){console.error('Data unavailable:',e.message);return send(res,503,{error:'data_unavailable'});}
  const profile=profileForToken(m[1],profiles);
  if(!profile) return send(res,404,{error:'not_found'});
  if(m[2]==='manifest.json') return send(res,200,buildManifest(profile,catalog));
  if(m[3] && m[4]) return send(res,200,{metas:recommend(profile,catalog,m[3],m[4],undefined,{skip:m[5]})});
  if(m[6] && VALID_IMDB.test(m[7])){
    const t=catalog.find(t=>t.id===m[7] && t.type===m[6]);
    if(!t) return send(res,404,{error:'not_found'});
    return send(res,200,{meta:{id:t.id,type:t.type,name:t.name,poster:t.poster,description:t.description||'',
      ...(t.background?{background:t.background}:{}),...(t.year?{releaseInfo:String(t.year)}:{}),
      genres:t.genres||[]}});
  }
  return send(res,404,{error:'not_found'});
}
export function startServer(){const server=http.createServer(handler);server.listen(PORT,HOST,()=>{
 console.log(`Nuvio Reco HTTP running at http://${HOST}:${PORT} (private until you expose it)`);
});
 // With credentials configured, sync only after startup and every 6 hours.
 if(process.env.AUTO_SYNC==='1'){
   let running=false;
   const run=async()=>{if(running)return;running=true;try{console.log('Sync:',await syncAll());}catch(e){console.error('Sync error:',e.message);}finally{running=false;}};
   const timer=setInterval(run,6*3600*1000);timer.unref();
   const initial=setTimeout(run,3000);initial.unref();
 }
 return server;}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url))startServer();
