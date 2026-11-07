import {loadProfiles,saveJSON,PROFILE_FILE,newProfile,sealSecret} from './core.mjs';
import {refreshTmdb,beginSimklPin,pollSimklPin,importSimklProfile,syncAll} from './providers.mjs';
import {traktDeviceCode,traktDeviceToken,syncTraktIfChanged} from './trakt.mjs';
const [command,...args]=process.argv.slice(2);
function usage(){console.log(`Usage:
 node cli.mjs init [nom]
 node cli.mjs add-profile "nom"
 node cli.mjs profiles
 node cli.mjs rotate-token "nom"
 node cli.mjs refresh-tmdb
 node cli.mjs connect-simkl "nom"
 node cli.mjs connect-trakt "nom"
 node cli.mjs import-trakt "nom"
 node cli.mjs import-simkl "nom"
 node cli.mjs sync-all
`);}
function get(name){const d=loadProfiles();const p=d.profiles.find(p=>p.id===name||p.name===name);if(!p)throw new Error('Profil introuvable');return {d,p};}
try{
 if(command==='init'){
  const d=loadProfiles();if(d.profiles.length)throw new Error('Un profil existe déjà, utilise add-profile');
  const p=newProfile(args[0]||'Principal');d.profiles.push(p);saveJSON(PROFILE_FILE,d);
  console.log(`Profil créé: ${p.name}\nURL locale à installer: http://localhost:${process.env.PORT||7000}/p/${p.token}/manifest.json`);
 }else if(command==='add-profile'){
  if(!args[0])throw new Error('Nom requis');const d=loadProfiles();if(d.profiles.some(p=>p.name===args[0]))throw new Error('Ce nom existe déjà');
  const p=newProfile(args[0]);d.profiles.push(p);saveJSON(PROFILE_FILE,d);console.log(`Créé: ${p.name}. Afficher son URL via profiles.`);
 }else if(command==='profiles'){
  const base=(process.env.PUBLIC_URL||`http://localhost:${process.env.PORT||7000}`).replace(/\/$/,'');
  for(const p of loadProfiles().profiles)console.log(`${p.name}: ${base}/p/${p.token}/manifest.json`);
 }else if(command==='rotate-token'){
  const {d,p}=get(args[0]);p.token=newProfile(p.name).token;saveJSON(PROFILE_FILE,d);
  console.log(`Jeton régénéré pour ${p.name}. Réinstaller le nouvel addon dans Nuvio.`);
 }else if(command==='refresh-tmdb'){
  console.log(await refreshTmdb());
 }else if(command==='connect-simkl'){
  const {d,p}=get(args[0]);
  // Require encryption before starting any authorization flow.
  sealSecret('validation-only');
  const code=await beginSimklPin();
  if(!code.user_code)throw new Error('Simkl n’a pas retourné de code PIN');
  console.log(`Pour relier ${p.name}, ouvre ${code.verification_url||'https://simkl.com/pin/'} et entre ${code.user_code}`);
  const interval=Math.max(5,Number(code.interval)||5)*1000,expiration=Date.now()+Math.min(900,Number(code.expires_in)||900)*1000;
  let connected=false;
  while(Date.now()<expiration){await new Promise(r=>setTimeout(r,interval));const status=await pollSimklPin({userCode:code.user_code});
   if(status.result==='OK'&&status.access_token){p.simklTokenEncrypted=sealSecret(status.access_token);p.historySource='simkl';saveJSON(PROFILE_FILE,d);connected=true;break;}
   if(status.message&&!/pending|slow down/i.test(status.message))throw new Error('Simkl: '+status.message);
  }
  console.log(connected?'Connexion Simkl enregistrée localement.':'Code Simkl expiré. Réessaie.');
 }else if(command==='connect-trakt'){
  const {d,p}=get(args[0]);sealSecret('validation-only');
  const code=await traktDeviceCode();
  if(!code.device_code||!code.user_code)throw new Error('Trakt device code missing');
  console.log(`Ouvre ${code.verification_url||'https://trakt.tv/activate'} et entre ${code.user_code} pour ${p.name}`);
  const interval=Math.max(5,Number(code.interval)||5)*1000,expires=Date.now()+Math.min(900,Number(code.expires_in)||900)*1000;
  let connected=false;
  while(Date.now()<expires){
   await new Promise(r=>setTimeout(r,interval));const r=await traktDeviceToken({deviceCode:code.device_code});
   if(r.ok&&r.data?.access_token){p.traktAuthEncrypted=sealSecret(JSON.stringify(r.data));p.historySource='trakt';
    saveJSON(PROFILE_FILE,d);connected=true;break;}
   if(![400,404,409,429].includes(r.status))throw new Error(`Trakt authorization HTTP ${r.status}`);
  }
  console.log(connected?'Trakt lié au profil local.':'Code expiré.');
 }else if(command==='import-trakt'){console.log(await syncTraktIfChanged(args[0],{force:true}));}
 else if(command==='import-simkl'){console.log(await importSimklProfile(args[0]));}
 else if(command==='sync-all'){console.log(await syncAll());}
 else{usage();if(command)process.exitCode=1;}
}catch(e){console.error('Erreur:',e.message);process.exitCode=1;}
