# Island Village — Beuteu Island

Un jeu React / TypeScript / Vite / Tailwind / Phaser sur **une seule île commune**. Tous les habitants voient les mêmes arbres, parcelles et constructions, ainsi que les avatars des personnes connectées. Chaque joueur garde son propre avatar, solde, inventaire et tutoriel.

## Installer et lancer

Node.js 22.12+ (24 recommandé).

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Dans `.env.local`, renseignez `VITE_SUPABASE_URL` avec l’origine HTTPS du projet, sans `/rest/v1/`, et `VITE_SUPABASE_ANON_KEY` avec une clé **publishable** ou **anon/public**. Ces valeurs sont publiques dans le navigateur. N’utilisez jamais `service_role` ou une clé `sb_secret_`. Aucune progression n’est stockée dans localStorage ; seul le stockage de session Supabase peut l’utiliser.

Sans configuration, l’application indique comment configurer Supabase et n’invente pas de joueurs.

## Mettre à jour le projet Supabase existant

Dans **SQL Editor**, appliquez les migrations manquantes dans l’ordre. Si votre jeu utilise déjà l’île commune, appliquez dans l’ordre les migrations manquantes jusqu’à `supabase/migrations/202611040005_final_assignments_road_price.sql`. Si vous êtes encore sur les îles individuelles, appliquez les migrations 2, 3, 4 et 5 dans cet ordre.

Sur une base neuve, exécutez les cinq migrations, dans l’ordre :

1. `202611040001_island_village.sql`
2. `202611040002_shared_island.sql`
3. `202611040003_expand_daily_trees.sql`
4. `202611040004_buy_farm_plots.sql`
5. `202611040005_final_assignments_road_price.sql`

La migration 2 :

- crée la carte commune « Beuteu Island » et garde les soldes individuels ;
- conserve les IDs des arbres, parcelles, cultures et bâtiments ainsi que les timestamps de croissance et de repousse ;
- fusionne les anciennes cartes en replaçant les éléments qui se chevauchent sur des cases libres ;
- archive les anciens plans dans `legacy_world_archive`, accessible seulement aux opérateurs SQL autorisés ; les anciennes lignes `islands` restent des archives et ne sont plus des cartes jouables ;
- annule toute la migration si la carte de 30 × 30 cases est trop pleine : aucune suppression silencieuse ;
- garde le constructeur des anciens bâtiments, avec les maisons initialement non attribuées ;
- publie les révisions de la carte via `shared_world` dans Supabase Realtime.

Faites une sauvegarde de votre base avant une migration de production. Les SQL sont versionnés ; ne rejouez pas une migration déjà exécutée. Ce dépôt n’exécute pas automatiquement les migrations distantes.

## Auth et Vercel

Activez Email dans Supabase Authentication. Configurez le Site URL et les URL de redirection avec l’origine exacte du site Vercel. Si la confirmation email est activée, confirmez votre email avant de jouer. Configurez un SMTP pour vos destinataires réels si nécessaire : le service de mail de test Supabase impose des restrictions.

Dans Vercel : framework Vite, build `npm run build`, sortie `dist`. Ajoutez les deux variables `VITE_` en type **Config**, pour Production, puis redéployez. Les variables de l’environnement cloud ne sont pas automatiquement copiées dans Vercel. Après un changement de variable, redémarrez Vite ou reconstruisez le déploiement.

Vérifiez que les tables `chat_messages` et `shared_world` sont dans la publication `supabase_realtime`. Le code utilise les canaux de présence standard ; ne désactivez pas les canaux publics sans adapter l’autorisation Realtime. Dans un environnement à accès réseau restreint, autorisez le nom d’hôte exact de votre projet Supabase pour HTTPS et WebSocket.

## Règles du jeu commun

- À l’inscription, on choisit un pseudonyme unique et un avatar ; on rejoint directement l’île existante. Aucun nom d’île n’est demandé et aucune nouvelle carte n’est créée.
- Chaque nouveau joueur reçoit 100 pièces. Le solde et le stock sont personnels ; les arbres, cultures et bâtiments sont partagés.
- Tous peuvent couper les arbres et planter/récolter les parcelles communes. Une ressource ne peut être récoltée deux fois ; celui qui réalise l’action reçoit les produits.
- 5 bois par arbre, 4 pièces par bois ; repousse après 30 min. Les souches gardent leur case réservée.
- Toutes les cultures sont matures à 8 h incluses et fanées à 12 h incluses ; le serveur utilise les timestamps enregistrés, même hors connexion.
- Les achats sont payés par leur constructeur. Le score affiché en haut est celui de l’île commune. Le classement liste les contributions individuelles des constructeurs.
- Chaque bâtiment garde son constructeur. **Le constructeur ou un administrateur** peut le déplacer gratuitement.
- Une petite ou grande maison peut être attribuée à un utilisateur inscrit : sélectionnez-la, puis choisissez l’habitant dans « Maison attribuée à ». **L’attribution est définitive : elle ne peut être changée ni retirée, même par un administrateur.** Elle ne transfère pas le droit de déplacer le bâtiment. Plusieurs maisons peuvent être attribuées au même habitant.
- La communauté affiche les habitants et leur statut. « Retrouver » centre la caméra sur un habitant connecté. Les avatars/positions sont diffusés par présence Realtime, disparaissent à la déconnexion et ne sont pas persistés.
- Les mutations de carte produisent une révision transactionnelle Realtime qui déclenche le rechargement des autres clients ; reconnexion et rafraîchissement périodique rattrapent les événements manqués.

Les prix et durées affichés sont dans `src/config/game.ts`. La table serveur `game_rules` fait autorité ; les tests vérifient leur cohérence. Après déploiement, changez ces valeurs par une nouvelle migration et alignez le frontend.

## Contrôles et interface

Clic/toucher pour marcher ; flèches/ZQSD/WASD ; glisser pour déplacer la caméra ; molette ou pincement à deux doigts pour zoomer. Boutons +/− et boussole à droite. Échap annule le placement.

L’icône carte ouvre Actions : arbres, parcelles et bâtiments sont accessibles par boutons au clavier. Pour placer un bâtiment au clavier, choisissez-le puis ouvrez Actions et renseignez colonne/ligne entre 0 et 59. Les modales natives gèrent le focus et la fermeture clavier. Les graphismes de la carte sont dessinés localement, sans images externes.

Le chat conserve 100 messages, utilise Realtime, limite à 500 caractères et impose 2 s entre envois. Le texte est échappé par React. Les auteurs peuvent supprimer leurs messages, les autres les signaler ; un administrateur peut supprimer tout message. Les signalements sont consultables dans `chat_reports` par un opérateur SQL autorisé.

Pour nommer un administrateur depuis SQL Editor :

```sql
update public.profiles set is_admin = true where id = 'UUID_DU_COMPTE';
```

## Architecture et sécurité

`src/components` : auth, avatar, chat, modales ; `src/game` : carte Phaser ; `src/services` : RPC ; `src/config` : catalogues ; `src/utils` : temps, collisions et chemins ; `src/types` : contrats. `supabase/migrations` contient les règles serveur et RLS.

Les écritures directes sont interdites. Les fonctions à `search_path` vide utilisent `auth.uid()`. Toutes les mutations prennent le verrou de la carte commune, puis du profil : cela sérialise aussi les actions de deux constructeurs sur une même case. Solde, inventaire, score et journal sont atomiques. Les UUID de requête empêchent de rejouer la même transaction. Les RPC valident les droits d’attribution et n’exposent pas les soldes des autres joueurs. Les données de présence sont déclaratives et ne donnent aucun droit économique.

## Vérifier

```sh
npm test
npm run build
npm run test:db
npx playwright install chromium
npm run test:e2e
# Chromium déjà installé sur Linux :
PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e
```

Les tests isolés doivent être lancés sans variables Supabase (le test d’accueil attend l’état non configuré) : `VITE_SUPABASE_URL= VITE_SUPABASE_ANON_KEY= npm test`. Idem pour les tests navigateur. PGlite exécute PostgreSQL et PL/pgSQL avec un contexte d’identité de test, sans compte de production. Les tests historiques couvrent la première migration ; `shared-world.test.ts` teste la mise à niveau, deux utilisateurs, les collisions, la conservation des données, la ressource commune et les autorisations d’attribution. Cela ne remplace pas un test de concurrence sur des connexions PostgreSQL séparées ou une validation Realtime hébergée.

Après migration et déploiement, ouvrez deux navigateurs avec deux comptes : vérifiez qu’ils arrivent sur la même carte, voient leurs déplacements, reçoivent les constructions et attributions sans recharger, et que le constructeur peut attribuer une maison au second compte. Essayez de la réattribuer avec le second compte : le serveur doit refuser. Vérifiez aussi chat, reconnexion, récoltes et persistance.

## Terrain 60 × 60 et apparition quotidienne

La migration 3 double les dimensions de la grille (30 × 30 → 60 × 60, soit quatre fois la surface de grille). Les arbres, parcelles et bâtiments existants sont décalés ensemble de +15 en colonne et ligne : leur disposition relative, leurs IDs, attributions et dates de plantation sont conservés. Le point d’arrivée et le cadrage de la caméra suivent le nouveau centre.

Chaque jour civil selon **Europe/Paris**, **10 nouveaux arbres** apparaissent sur des cases aléatoires de terre, sans arbre, parcelle ni construction, et hors du point d’arrivée. Les arbres existants et leur repousse après coupe sont conservés. Si moins de 10 cases sont disponibles, le serveur crée seulement ceux qui peuvent tenir et journalise le nombre réel dans `tree_spawn_days`. Un terrain plein ne détruit rien.

Le serveur, jamais l’horloge du téléphone, choisit le jour et les positions. Une même journée n’est traitée qu’une seule fois pour l’île entière. Les jours manqués sont rattrapés à la prochaine connexion/action ; aucune quantité ou date ne peut être envoyée par le navigateur. La migration ajoute immédiatement le lot du jour.

Pour que l’apparition se fasse aussi **sans personne connecté**, activez **Supabase Cron / pg_cron** avant d’exécuter la migration 3. Si Cron est disponible, elle enregistre automatiquement le job `island-daily-trees` toutes les 5 minutes (le générateur ne fait rien quand le jour a déjà été traité). Si vous activez Cron plus tard, exécutez dans SQL Editor :

```sql
select cron.schedule(
  'island-daily-trees',
  '*/5 * * * *',
  'select public.ensure_daily_trees();'
);
```

Le lot apparaît au premier passage suivant minuit à Paris, au plus tard 5 minutes après si Cron fonctionne. Vérifiez le job dans Supabase Cron et son historique d’exécution. Sans Cron, l’apparition est faite au premier chargement de la journée et les jours d’absence sont rattrapés. Le générateur prend le même verrou serveur que les constructions, pour éviter une apparition concurrente sur une case qui vient d’être bâtie.

La migration 3 corrige aussi `Update requires a WHERE clause` : la révision de l’île est maintenant mise à jour avec `WHERE singleton=true`. Cela rétablit le bouton « C’est parti » et les autres actions sur les projets où la protection contre les mises à jour globales est activée. La correction est serveur ; un redéploiement du frontend seul ne suffit pas.

## Ajouter des parcelles

Depuis **Agriculture → Ajouter une parcelle**, achetez une case cultivable pour **25 pièces** et placez-la sur une case libre (prévisualisation verte/rouge). Le prix n’est débité qu’au placement réussi. Échap ou le bouton d’annulation ne coûte rien. Pour placer au clavier, ouvrez Actions et saisissez les coordonnées comme pour un bâtiment.

Les nouvelles parcelles sont communes, immédiatement sauvegardées et synchronisées entre habitants. On peut y planter les mêmes cultures que sur les parcelles initiales. Aucun plafond n’est ajouté, en dehors des cases disponibles et du solde du joueur. Les arbres quotidiens ne peuvent pas apparaître dessus. Le tarif est dans la règle serveur `farm_plot` et le catalogue frontend `FARM_PLOT`, avec un test de cohérence.

Appliquez `202611040004_buy_farm_plots.sql` dans Supabase SQL Editor, après les migrations précédentes, puis déployez le frontend. L’achat utilise la même transaction sécurisée que les constructions : contrôle du solde, des cases occupées, verrou de carte et identifiant de requête contre les doubles achats. Une erreur annule la création et le débit. Les parcelles existantes sont conservées.

## Attribution définitive et prix des routes

La migration 5 fixe le prix d’une route à **1 pièce par case** (1 × 1). Les routes déjà achetées restent en place ; leurs anciennes transactions ne sont pas modifiées ni remboursées.

Pour attribuer une maison encore libre, son constructeur ou un administrateur choisit un habitant, puis appuie sur **Attribuer définitivement**. L’avertissement d’irréversibilité est affiché avant validation. Après validation, le sélecteur disparaît et le bénéficiaire est affiché avec la mention « Attribution définitive · non modifiable ». Le serveur refuse toute nouvelle attribution ou remise à zéro, y compris venant d’un administrateur. Une requête identique rejouée avec son UUID initial reste idempotente.

Les maisons déjà attribuées au moment de la migration sont verrouillées aussi. `assigned_at` conserve le verrou même si le compte bénéficiaire est supprimé et que la clé étrangère devient nulle ; cette suppression ne remet pas la maison sur le marché. Un compte supprimé est affiché comme un ancien habitant. Le déplacement gratuit par le constructeur ou un administrateur reste autorisé.

Appliquez `202611040005_final_assignments_road_price.sql` dans Supabase SQL Editor après les migrations précédentes, puis déployez le frontend. Un redéploiement frontend seul ne change pas les prix ou permissions serveur.

Les raccourcis de déplacement observent les touches sans bloquer leur saisie dans le chat ou les formulaires. Le personnage reste immobile lorsque le focus se trouve dans un champ de texte, une zone éditable ou un contrôle d’interface. Ce correctif est uniquement frontend et ne nécessite aucune nouvelle migration SQL.
