/** The setup page contains no secrets. Admin calls require an explicit bearer token. */
export const setupHtml = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Nuvio Reco — Configuration</title>
<style>
:root{color-scheme:dark;font:16px system-ui, sans-serif;background:#101418;color:#ebf3f7}
body{max-width:800px;margin:32px auto;padding:0 20px}h1{font-size:1.8rem}h2{font-size:1.15rem}
.panel{background:#1b2429;border:1px solid #39494d;border-radius:14px;padding:20px;margin:16px 0}
input{border-radius:8px;padding:11px;border:1px solid #697980;background:#0e1518;color:#fff;max-width:100%;font-size:1rem}
button{background:#b0eee3;color:#0b2426;border:0;border-radius:9px;padding:10px 14px;font-weight:bold;cursor:pointer;margin:6px 6px 6px 0}
button.secondary{background:#304047;color:#e4f3ee}a{color:#b0eee3}p{line-height:1.5}
code{word-break:break-all}#message{min-height:1.5em}section{margin-bottom:20px}
</style></head><body><h1>🎬 Nuvio Reco</h1><p>Un addon, plusieurs profils, des recommandations grâce à Trakt. Cette page fonctionne seulement avec votre clé d'administration privée.</p>
<section class="panel"><h2>1. Déverrouiller la configuration</h2><p>Saisissez votre <code>ADMIN_TOKEN</code> Cloudflare. Il n'est pas enregistré dans le navigateur.</p><input id="adminToken" type="password" size="45" autocomplete="off" placeholder="Jeton d'administration"/><button id="load">Accéder aux profils</button></section>
<section class="panel" id="controls" hidden><h2>2. Créer et connecter les profils</h2><input id="name" placeholder="Nom du profil" maxlength="50"/><button id="create">Créer un profil</button><div id="profiles"></div></section>
<div id="message" role="status" aria-live="polite"></div><p><small>L'addon TorBox existant continue de gérer la lecture ; Nuvio Reco fournit uniquement les recommandations. Ne partagez jamais vos liens privés.</small></p>
<script src="/setup.js" defer></script></body></html>`;

export const setupScript = `(() => {
 const token=document.getElementById('adminToken');
 const controls=document.getElementById('controls');
 const profiles=document.getElementById('profiles');
 const message=document.getElementById('message');
 function notice(s){message.textContent=s;}
 async function api(path,method='GET',data) {
   const response=await fetch(path,{method,headers:{'Authorization':'Bearer '+token.value,'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});
   const result=await response.json();
   if(!response.ok)throw new Error(result.error||'Erreur réseau');
   return result;
 }
 function el(tag,text){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;}
 function action(parent,label,handler){const b=el('button',label);b.className='secondary';b.addEventListener('click',async()=>{b.disabled=true;try{await handler();}catch(e){notice('Erreur : '+e.message);}finally{b.disabled=false;}});parent.append(b);return b;}
 async function load(){const response=await api('/admin/profiles');controls.hidden=false;profiles.replaceChildren();
   for(const p of response.profiles){const card=el('div');card.className='panel';card.append(el('h3',p.name));card.append(el('p','Trakt : '+p.status+(p.syncedAt?' · dernière synchronisation '+p.syncedAt:'')));
   const link=el('code',p.installUrl);card.append(el('p','URL privée d\'installation : '));card.append(link);card.append(el('p',' '));
   action(card,'Copier le lien',async()=>{await navigator.clipboard.writeText(p.installUrl);notice('URL copiée');});
   action(card,'1. Lier Trakt',async()=>{const r=await api('/admin/profiles/'+p.id+'/device/start','POST');notice('Ouvrez '+r.verificationUrl+' et saisissez le code '+r.userCode+'. Ensuite cliquez sur « Connexion autorisée ».');const a=el('a',' Ouvrir Trakt et entrer '+r.userCode);a.href=r.verificationUrl;a.target='_blank';a.rel='noopener noreferrer';card.append(a);});
   action(card,'2. Connexion autorisée',async()=>{const r=await api('/admin/profiles/'+p.id+'/device/complete','POST');notice(r.status==='linked'?'Compte Trakt lié !':'Autorisation en attente : réessayez après avoir validé le code.');if(r.status==='linked')await load();});
   action(card,'3. Mettre à jour les recommandations',async()=>{notice('Synchronisation en cours…');const r=await api('/admin/profiles/'+p.id+'/sync','POST');notice('Recommandations mises à jour. Films : '+r.movies+', séries : '+r.series+(r.incompleteHistory?' (historique partiel : limite de pages Trakt)':''));await load();});
   profiles.append(card);
   }
 }
 document.getElementById('load').addEventListener('click',()=>load().catch(e=>notice('Connexion impossible : '+e.message)));
 document.getElementById('create').addEventListener('click',async()=>{try{const name=document.getElementById('name');const r=await api('/admin/profiles','POST',{name:name.value});name.value='';notice('Profil créé : '+r.name);await load();}catch(e){notice('Erreur : '+e.message);}});
})();`;
