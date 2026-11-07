# Déploiement privé de Nuvio Reco (préparé, non activé)

GitHub héberge le **code uniquement**. Ce service Node.js a besoin d'un hôte en fonctionnement, d'un stockage privé persistant et d'une URL HTTPS lisible par les appareils Nuvio. GitHub Pages ne peut pas héberger ce serveur.

## Préparer un hôte (Node.js 22)

```sh
cd nuvio-reco
node cli.mjs prepare-local
# Modifier le fichier .env localement avec TRAKT_CLIENT_ID et TMDB_READ_TOKEN
node --env-file=.env cli.mjs doctor
node --env-file=.env cli.mjs connect-trakt "Principal"
node --env-file=.env cli.mjs import-trakt "Principal"
node --env-file=.env cli.mjs refresh-tmdb
npm test
node --env-file=.env server.mjs
```

La commande `prepare-local` génère la clé de chiffrement et un premier profil sans remplacer les données existantes. Pour plusieurs profils : `node --env-file=.env cli.mjs add-profile "Autre profil"`, puis répéter la connexion Trakt avec le bon compte. `cli.mjs profiles` affiche les URLs privées.

## Docker (optionnel)

`docker compose up -d --build` sur l'hôte après avoir placé `.env` localement et rendu `data/` accessible à l'UID 1000. Le fichier Compose publie le port 7000 **uniquement sur 127.0.0.1 de l'hôte** ; ajouter un reverse proxy HTTPS ou un tunnel géré et définir `PUBLIC_URL=https://votre-domaine` dans le `.env` local.

**Ne jamais exposer `.env` ou `data/` en HTTP, ni publier les URLs d'installation.** Une URL `/p/<token>` permet de lire les catalogues de ce profil ; une fuite se révoque avec `cli.mjs rotate-token "Profil"` et exige de réinstaller le nouvel addon.

## Vérifier l'installation sur Nuvio

1. Installer la configuration du profil A dans Nuvio A.
2. Installer celle du profil B dans Nuvio B.
3. Relancer Nuvio et vérifier les catégories, métadonnées et affiches.
4. Confirmer que les installations sont réellement séparées par profil — **à vérifier sur l'appareil**, cette séparation n'étant pas garantie par le protocole Stremio.

`AUTO_SYNC=1` vérifie l'historique à intervalle d'environ 6 heures et enrichit les données TMDB après un changement. Prévoir une sauvegarde de `data/` et de `RECO_SECRET_KEY`, gardée hors de GitHub. Aucun hébergement, port public ou frais n'a été activé à cette étape.
