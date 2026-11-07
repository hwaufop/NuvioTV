# Nuvio Reco — Cloudflare Workers (v0.4 prototype)

Addon privé **Stremio/Nuvio** : pour chaque profil, une URL d'installation distincte, des recommandations basées sur le compte Trakt du profil, et un rafraîchissement automatique sans VPS. Le code s'exécute sur **Cloudflare Workers** avec **Cloudflare D1**. Aucune clé personnelle ne doit être enregistrée sur GitHub.

**Statut :** développé et testé hors ligne avec des API simulées. **Pas encore déployé ni validé dans l'application Nuvio réelle**. La séparation des addons installés selon le profil actif devra être testée sur l'appareil.

## Ce qui est inclus

- Catalogues *Pour vous*, *Parce que vous avez regardé…* et *Votre sélection du jour*, en films et séries (jusqu'à 9 titres chacun dans cette première version Worker).
- Source Trakt : `/sync/watched/movies` et `/sync/watched/shows` avec pagination (max. 3 pages par type, jusqu'à 750 entrées si l'API accepte 250/page), liaison par code d'activation et renouvellement des jetons OAuth.
- Source TMDB : tendances, découverte, suggestions liées aux derniers titres regardés, genres, affiches, détails et conversion vers identifiants IMDb lorsque possible.
- Profils et catalogues isolés en base D1, URL d'installation aléatoire de 256 bits par profil, jetons Trakt chiffrés avec AES-256-GCM.
- Synchronisation automatisée toutes les heures, **un profil au maximum par exécution**, seulement si sa dernière synchro date de plus de 6 heures.
- Configuration web simple sur `https://VOTRE-WORKER.workers.dev/setup`, accessible avec le jeton admin : création de profils, connexion Trakt, synchronisation et récupération des URLs d'installation.
- L'addon **ne fournit pas de streams** : il est fait pour fonctionner à côté de l'addon de lecture TorBox déjà présent dans Nuvio. L'API TorBox exige des hashes torrents pour vérifier le cache ; elle n'offre pas à elle seule une méthode fiable de vérification par titre de film. Nous n'envoyons aucune clé TorBox à ce Worker.

## Installation Cloudflare (intervention de l'utilisateur nécessaire)

Prérequis : un compte Cloudflare, Node.js 22+ et npm, une **application API Trakt** (identifiant client, et éventuellement secret client), un **jeton de lecture TMDB**. Ces deux derniers se créent sur les sites officiels :
- https://trakt.tv/oauth/applications
- https://www.themoviedb.org/settings/api

1. Télécharger le dépôt GitHub (branche `feature/nuvio-reco-mvp`) et ouvrir un terminal dans `nuvio-reco/cloudflare/`.
2. `npm install` puis `npx wrangler login` ; **l'autorisation de ton compte Cloudflare se fait dans le navigateur**.
3. Créer une petite base D1 : `npx wrangler d1 create nuvio-reco`.
4. Copier l'identifiant D1 indiqué dans `wrangler.jsonc` à la place de `REPLACE_WITH_YOUR_D1_DATABASE_ID`.
5. Appliquer le schéma : `npx wrangler d1 migrations apply nuvio-reco --remote`.
6. Déployer le Worker : `npx wrangler deploy` ; noter l'URL `https://nuvio-reco-private....workers.dev`. **Ce déploiement n'a pas encore été effectué**.
7. Enregistrer les secrets un à un avec `npx wrangler secret put NOM_DU_SECRET` (invite sécurisée) :
   - `ADMIN_TOKEN` : générer 32 octets aléatoires, les conserver **en privé**. Exemple Windows PowerShell / Node : `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
   - `ENCRYPTION_KEY` : une **autre** chaîne aléatoire de 64 caractères hexadécimaux, à sauvegarder hors de GitHub.
   - `TRAKT_CLIENT_ID` : client ID de ton app Trakt. Ajouter `TRAKT_CLIENT_SECRET` **seulement si nécessaire pour l'authentification via l'API Trakt**.
   - `TMDB_READ_TOKEN` : jeton API v4 (authentification bearer) de TMDB.
8. Ouvrir `/setup` sur l'URL du Worker, saisir **uniquement ici** le `ADMIN_TOKEN`, créer le profil, démarrer la liaison Trakt, autoriser le code depuis Trakt, cliquer **Connexion autorisée**, puis **Mettre à jour les recommandations**.
9. Copier l'URL privée `.../p/<jeton>/manifest.json` dans le bon profil Nuvio, et redémarrer Nuvio pour recharger les catalogues. L'addon TorBox existant reste installé pour la lecture.
10. Répéter la liaison avec **un compte Trakt distinct par profil** pour obtenir des historiques indépendants. Un seul compte Trakt partagé produit forcément des recommandations très similaires.

### Vérifications après déploiement

- `GET https://VOTRE_WORKER/health` doit retourner `{"ok":true,"service":"nuvio-reco-cloudflare"}`.
- Un `GET` sur `/p/JETON/manifest.json` doit annoncer 6 catalogues (3 pour les films, 3 pour les séries).
- Après synchro, les endpoints `/p/JETON/catalog/movie/for-you.json` et `/p/JETON/catalog/series/for-you.json` renvoient des listes JSON non vides.
- Vérifier sur **l'appareil Nuvio** que les installations d'addons appartiennent bien aux différents profils : **ce point n'est pas garanti par le seul protocole Stremio**.
- Vérifier qu'une œuvre déjà regardée n'est pas recommandée, que TorBox propose toujours la lecture, et que les autres profils n'ont pas accès au contenu du premier.

## Sécurité et limites

- Le Worker est accessible via une URL `workers.dev` : il n'est **pas** intrinsèquement privé. Les endpoints admin nécessitent `ADMIN_TOKEN` et les catalogues nécessitent des URLs secrètes par profil. N'exposez ni ces URLs ni les tokens. Les titres présents dans un catalogue sont visibles par toute personne ayant l'URL correspondante.
- Les secrets sont enregistrés via **Cloudflare Workers Secrets** et les jetons Trakt sont chiffrés en base. Une fuite de `ENCRYPTION_KEY` et de la base permettrait de déchiffrer les données ; sauvegarder les secrets avec soin.
- Une URL d'installation fuitée se révoque par `POST /admin/profiles/:id/rotate` ; réinstaller ensuite le manifeste avec la nouvelle URL. La page web de configuration n'expose pas cette commande pour éviter les rotations accidentelles.
- La synchronisation utilise une **fenêtre de 3 pages Trakt par type** pour maîtriser les quotas gratuits. Un historique plus long peut être incomplet. L'API retourne `incompleteHistory:true` si elle détecte une pagination supplémentaire.
- Workers Free : 100 000 requêtes/jour, 10 ms de CPU par invocation, 50 sous-requêtes, cron limités. D1 Free : 5 millions de lignes lues et 100 000 écrites/jour, 5 Go au total, 500 Mo maximum par base (vérifier la documentation Cloudflare actuelle avant déploiement).
- Si le Worker dépasse les limites gratuites, la synchronisation échouera ; il ne faut pas passer à une formule payante sans en avoir mesuré le besoin.
- Le *moteur hybride* actuellement proposé est volontairement simple : qualité, genres récemment regardés, popularité et diversité quotidienne. Il ne reproduit pas l'algorithme propriétaire de Netflix.
- Les identifiants IMDb manquants sont renvoyés en `tmdb:<id>` : certaines extensions de streaming peuvent ne pas résoudre ces liens. Ceci sera validé sur Nuvio.
- Sans connexion Trakt et TMDB fonctionnelle, **aucun catalogue personnel complet** ne peut être produit : les tests hors ligne utilisent des données simulées.

## Développement et tests

```bash
cd nuvio-reco/cloudflare
npm test            # Utilise Node.js, SQLite de test local et des API fictives
npm install
npm run dev        # Wrangler local : D1 doit être configuré et migré
```

Les tests ne communiquent jamais avec un vrai compte Trakt, TMDB ou TorBox. Les changements de code doivent rester dans la PR GitHub en brouillon jusqu'au test d'installation réel.

### APIs d'administration (authentification requise)

Toutes les routes `/admin/*` requièrent le header `Authorization: Bearer <ADMIN_TOKEN>`.

- `GET /admin/status`, `GET /admin/profiles`, `POST /admin/profiles` avec `{ "name":"Principal" }`
- `POST /admin/profiles/{id}/device/start`, puis `POST /admin/profiles/{id}/device/complete` une fois le code confirmé sur Trakt
- `POST /admin/profiles/{id}/sync`, `POST /admin/profiles/{id}/rotate`, `POST /admin/profiles/{id}/disconnect`

Les routes publiques d'addon ont une URL secrète propre à chaque profil : `/p/{jeton}/manifest.json`, `/p/{jeton}/catalog/{movie|series}/{for-you|because-watched|daily}.json`, `/p/{jeton}/meta/{movie|series}/{imdb-or-tmdb-id}.json`.
