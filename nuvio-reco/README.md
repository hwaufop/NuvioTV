# Nuvio Reco — version de développement 0.3.0

Addon privé de **catalogues Stremio/Nuvio** : un seul moteur, un manifeste distinct par profil, des recommandations différentes selon les goûts et l'historique. Le dépôt reste une branche de développement **non fusionnée, non déployée**. Le code peut être public, mais les secrets, les historiques et les URL privées ne doivent jamais être committés.

## Fonctionnalités

- Films et séries : **Pour vous**, **Parce que vous avez regardé…** (affiche un titre quand celui-ci est identifiable), **Votre sélection du jour** ; jusqu'à 30 éléments par page.
- Séparation des historiques et des jetons par profil ; impossibilité d'accéder à un profil avec le jeton d'un autre.
- Exclusion des contenus vus et masqués ; regroupement des genres appréciés, historiques récents, notes et qualité TMDB.
- Récupération des titres via l'API officielle **TMDB** avec résolution des identifiants IMDb : le catalogue peut être ouvert dans les autres addons utilisant les identifiants IMDb.
- Import d'historique personnel depuis **Simkl** ou **Trakt**, après autorisation par code de liaison. Synchronisation périodique facultative, conditionnée à un compte lié et à l'hébergement en fonctionnement.
- Chiffrement AES-256-GCM des jetons d'accès aux comptes de suivi à l'aide de `RECO_SECRET_KEY` (qui doit être sauvegardée hors du dépôt).
- Un test de compatibilité réel sur Nuvio reste nécessaire : la prise en charge d'une installation d'addon différente pour chaque profil n'est **pas garantie** par le protocole lui-même.

## Préparer l'application en local

1. Installer Node.js 22 ou plus récent, puis ouvrir un terminal dans `nuvio-reco/`. Préparer automatiquement un fichier `.env` privé et un premier profil :

   ```bash
   node cli.mjs prepare-local
   ```

   Cette commande génère la clé de chiffrement nécessaire à Trakt ; elle ne remplace pas une configuration existante. **Ne pas recopier `.env.example` par-dessus le fichier `.env` créé.**
2. Modifier localement le fichier `.env` (jamais sur GitHub) et ajouter `TRAKT_CLIENT_ID` pour l'application Trakt personnelle et `TMDB_READ_TOKEN` pour TMDB. Vérifier la présence des réglages sans afficher les secrets :

   ```bash
   node --env-file=.env cli.mjs doctor
   ```

   Ne pas envoyer les clés dans un ticket, un commit, un chat ou une pull request.
3. Le profil `Principal` existe déjà. En créer d'autres uniquement si nécessaire :

   ```bash
   node --env-file=.env cli.mjs add-profile "Profil secondaire"
   ```

4. Alimenter le catalogue :

   ```bash
   node --env-file=.env cli.mjs refresh-tmdb
   ```

   Pour tester sans clé, copier `catalog.example.json` vers `data/catalog.json` (les exemples ont peu de titres). Un profil sans historique obtient une sélection généraliste ; elle devient personnalisée après synchronisation ou réglage manuel des goûts.
5. Relier un historique, si disponible, via **un seul fournisseur par profil** :

   ```bash
   node --env-file=.env cli.mjs connect-trakt "Principal"
   node --env-file=.env cli.mjs import-trakt "Principal"
   # OU
   node --env-file=.env cli.mjs connect-simkl "Principal"
   node --env-file=.env cli.mjs import-simkl "Principal"
   ```

   Chaque commande `connect-*` affiche un code à autoriser dans un navigateur. Trakt requiert `TRAKT_CLIENT_ID` et peut requérir `TRAKT_CLIENT_SECRET` selon le type d’application ; le fournisseur doit être autorisé séparément pour chaque profil. Simkl requiert `SIMKL_CLIENT_ID`. Après le premier import Trakt, relancer `refresh-tmdb` pour enrichir les références de goûts.
6. Démarrer l'addon et récupérer les liens privés :

   ```bash
   node --env-file=.env server.mjs
   # Dans un autre terminal :
   node --env-file=.env cli.mjs profiles
   ```

   Le service écoute **sur 127.0.0.1 uniquement** par défaut, donc il n'est pas accessible depuis la TV. Un domaine et un accès **HTTPS** seront nécessaires pour une installation distante. Le client Nuvio doit pouvoir consulter les chemins `/p/<jeton>/manifest.json` et `/p/<jeton>/catalog/...` sans authentification interactive. Les jetons privés dans l'URL sont la protection de ces chemins ; ne pas les publier.

## Docker (optionnel)

`docker compose up -d --build` pour lancer le service en privé, exposé uniquement sur `127.0.0.1:7000` de l'hôte. `./data` doit être accessible en lecture/écriture à l'UID 1000 du conteneur. La première configuration et l'import TMDB se font via les commandes CLI dans le conteneur ou sur l'hôte. Configurer un reverse proxy HTTPS séparément pour l'accès depuis Nuvio sur d'autres appareils ; **aucun service n'est exposé publiquement par défaut**.

Lorsque `AUTO_SYNC=1` et que les comptes sont connectés, le serveur vérifie les activités Trakt/Simkl environ toutes les 6 heures ; il met à jour le catalogue TMDB si son cache dépasse 24 heures ou si l’historique vient de changer. Simkl utilise l'endpoint d'activités et les mises à jour incrémentales (`date_from`) après le premier import ; les retraits détectés déclenchent une nouvelle synchronisation complète.

## Commandes utiles

| Commande | Effet |
|---|---|
| `node --env-file=.env cli.mjs profiles` | Affiche les URL d'installation privées |
| `node --env-file=.env cli.mjs add-profile "X"` | Crée un profil séparé |
| `node --env-file=.env cli.mjs rotate-token "X"` | Révoque l'ancienne URL (nécessite réinstallation) |
| `node --env-file=.env cli.mjs refresh-tmdb` | Reconstitue le catalogue TMDB |
| `node --env-file=.env cli.mjs sync-all` | Lance la synchronisation des profils déjà liés |
| `npm test` | Lance tous les tests hors ligne |
| `node cli.mjs prepare-local` | Crée une clé secrète locale et le profil Principal, sans remplacer les fichiers existants |
| `node --env-file=.env cli.mjs doctor` | Vérifie les prérequis sans révéler les secrets |

## Sécurité, vie privée, limites

- **Aucun compte réel n'est lié actuellement** : le code prépare les intégrations, les autorisations restent à faire par leurs propriétaires.
- La séparation des configurations Nuvio entre profils, l'ouverture des métadonnées, la lecture des titres, les PIN réels et l'accès distant doivent être vérifiés sur l'appareil de destination.
- L'import Simkl ne retient que les entrées de statut *completed*, et les identifiants IMDb valides. Les séries commencées mais non terminées et les entrées sans IMDb ID ne sont pas encore couvertes exhaustivement.
- L'API TMDB et les connexions Simkl/Trakt ont été testées avec des réponses **simulées**, pas avec des clés réelles dans ce dépôt.
- Les listes de démonstration ne sont pas un vrai catalogue ; la qualité des recommandations dépend de la richesse des données importées.
- Les règles de synchronisation et de cache devront être revérifiées avec les comptes réels. En particulier, la suppression d'une note ou une modification côté fournisseur peut nécessiter une reconstruction complète de l'historique.
- Une URL `/p/<token>` est un **jeton d'accès** : même chiffrés à part, les historiques de visionnage ne doivent pas être exposés sur une machine non maîtrisée.
- Ne pas fusionner la PR, déployer sur Internet, engager des frais cloud ou modifier une application Nuvio existante sans décision explicite.

## Attribution TMDB

*This product uses the TMDB API but is not endorsed or certified by TMDB.* [TMDB](https://www.themoviedb.org) est la source des métadonnées et images. Avant toute diffusion publique, ajouter un logo officiel TMDB approuvé et vérifier la conformité de la page « Crédits » avec [les règles d'attribution](https://developer.themoviedb.org/docs/faq). Les historiques personnels proviennent uniquement des comptes Trakt/Simkl autorisés.

## Mise à jour 0.3 : Trakt comme source principale

- L'historique Trakt est désormais récupéré **page par page** (pagination obligatoire depuis juillet 2026), y compris pour les films et séries d'un compte ancien. En cas de pagination incohérente ou d'erreur HTTP, l'ancienne liste est conservée.
- Les données historiques Trakt et les notes peuvent être enrichies via TMDB pour retrouver les genres des titres visionnés, même lorsqu'ils ne sont plus tendance.
- Le catalogue mêle tendances, contenus populaires, classiques mieux notés et plusieurs genres. Le genre et la pertinence dépendent du vrai historique après connexion.
- Le flux Trakt renouvelle les jetons d'accès, et l'enregistreur conserve le nouveau refresh token chiffré en cas de renouvellement.
- Pour tester la configuration locale sans divulguer de secrets : `node --env-file=.env cli.mjs doctor`.
- Après `import-trakt`, exécuter `refresh-tmdb` pour enrichir les suggestions ; `sync-all` le fait automatiquement si l’historique change.

**Ce qui reste obligatoirement à faire par le propriétaire :** créer une application [Trakt](https://developer.trakt.tv/docs/create-an-app), obtenir son Client ID, obtenir le [TMDB API Read Access Token](https://www.themoviedb.org/settings/api), autoriser le compte Trakt depuis le code de connexion, et choisir un hébergement HTTPS pour Nuvio. Les identifiants restent dans `.env` **hors GitHub** ; ne pas les envoyer dans un chat ou une issue.

Trakt exige le respect de [sa politique d'utilisation](https://developer.trakt.tv/docs/api-use-policy) ; TMDB exige son attribution. Aucune connexion personnelle ni déploiement public n'a été effectué.