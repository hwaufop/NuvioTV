# Nuvio Reco — MVP 0.1.0

Addon de catalogues Stremio/Nuvio avec une URL d'installation distincte pour chaque profil. **Prototype** : données importées manuellement (pas encore de synchronisation Nuvio, Simkl ou Trakt).

## Installation locale
Node.js >= 20 :

```bash
cd nuvio-reco
cp profiles.example.json profiles.local.json
cp catalog.example.json catalog.local.json
# Remplacer les jetons de démonstration par 24 octets aléatoires en hex :
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
npm test
npm start
```

Installer dans le profil Nuvio correspondant l'URL `http://HOTE:7000/p/JETON/manifest.json`. Pour une installation depuis un autre appareil, exposer le serveur en HTTPS et configurer `PUBLIC_URL=https://votre-domaine`. Le port se règle par `PORT`, les chemins de configuration par `RECO_DATA_FILE` et `RECO_CATALOG_FILE`.

Le jeton de profil est un secret : ne jamais partager les URLs d'installation ou ajouter les fichiers `*.local.json` dans Git. Le code se trouve dans une **branche d'un dépôt public**, sans identifiants réels.

### Données
- `profiles.local.json` : objet `{"profiles":[{"token":"HEX_32+","name":"...","watchedIds":[],"hiddenIds":[],"likedIds":[],"favoriteGenres":[],"recentlyWatchedGenres":[]}]}`
- `catalog.local.json` : tableau de `{"id":"tt1234567","type":"movie","name":"Titre","poster":"https://...","genres":["Drama"],"rating":8.0,"popularity":20}`. Types : movie et series. IDs : IMDb `tt...` ou `tmdb:...`.

### Trois catégories (films et séries)
- **Pour vous** : genre, goûts, qualité et diversité.
- **Parce que vous avez regardé…** : similarité de genres récemment vus, sans encore afficher un film source précis.
- **Votre sélection du jour** : variation déterministe par date et par profil.

Les titres vus et masqués sont exclus. Les calculs sont sans IA générative et sans frais API.

### Limites
- Il faut alimenter les données et les historiques manuellement jusqu'à l'ajout de Simkl/Trakt + TMDB.
- **La compatibilité réelle de la séparation des installations par profil Nuvio reste à vérifier sur l'appareil**.
- Les catalogues doivent être accessibles par Nuvio sans connexion interactive ; protéger les tokens et ne pas exposer la page de configuration (non implémentée).
- Aucun hébergement ou déploiement n'est fourni par GitHub.
