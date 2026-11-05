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

Dans **SQL Editor**, appliquez les migrations manquantes dans l’ordre. Si votre jeu utilise déjà l’île commune, appliquez dans l’ordre les migrations manquantes jusqu’à `supabase/migrations/202611050010_exile_election_gym.sql`. Si vous êtes encore sur les îles individuelles, appliquez les migrations 2 à 10 dans cet ordre.

Sur une base neuve, exécutez les dix migrations, dans l’ordre :

1. `202611040001_island_village.sql`
2. `202611040002_shared_island.sql`
3. `202611040003_expand_daily_trees.sql`
4. `202611040004_buy_farm_plots.sql`
5. `202611040005_final_assignments_road_price.sql`
6. `202611050006_commerce_and_elections.sql`
7. `202611050007_residents_random_regrowth.sql`
8. `202611050008_more_buildings.sql`
9. `202611050009_recovery_management.sql`
10. `202611050010_exile_election_gym.sql`

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

Vérifiez que les tables `chat_messages`, `shared_world` et (depuis la migration 7) `player_presence` sont dans la publication `supabase_realtime`. Dans un environnement à accès réseau restreint, autorisez le nom d’hôte exact de votre projet Supabase pour HTTPS et WebSocket.

## Règles du jeu commun

- À l’inscription, on choisit un pseudonyme unique et un avatar ; on rejoint directement l’île existante. Aucun nom d’île n’est demandé et aucune nouvelle carte n’est créée.
- Chaque nouveau joueur reçoit 100 pièces. Le solde et le stock sont personnels ; les arbres, cultures et bâtiments sont partagés.
- Tous peuvent couper les arbres et planter/récolter les parcelles communes. Une ressource ne peut être récoltée deux fois ; celui qui réalise l’action reçoit les produits.
- 5 bois par arbre, 4 pièces par bois ; repousse après 30 min. Après la migration 7, l’arbre coupé disparaît entièrement, libère sa case et repousse ailleurs après ce délai.
- Toutes les cultures sont matures à 8 h incluses et fanées à 12 h incluses ; le serveur utilise les timestamps enregistrés, même hors connexion.
- Les achats sont payés par leur constructeur. Le score affiché en haut est celui de l’île commune. Le classement liste les contributions individuelles des constructeurs.
- Chaque bâtiment garde son constructeur. **Le constructeur ou un administrateur** peut le déplacer gratuitement.
- Une petite ou grande maison peut être attribuée à un utilisateur inscrit : sélectionnez-la, puis choisissez l’habitant dans « Maison attribuée à ». **L’attribution est définitive : elle ne peut être changée ni retirée, même par un administrateur.** Elle ne transfère pas le droit de déplacer le bâtiment. Plusieurs maisons peuvent être attribuées au même habitant.
- La communauté affiche les habitants et leur statut. « Retrouver » centre la caméra sur un habitant connecté. Les avatars/positions sont signalés par une présence authentifiée en base, diffusés via Realtime et vérifiés périodiquement. Les présences expirées sont retirées de la carte.
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

## Commerces, pièces quotidiennes et mairie (migration 6)

Les commerces ont des façades et enseignes vectorielles locales : croissant pour la boulangerie, steak rouge pour la boucherie, croix verte pour la pharmacie, ciseaux pour le coiffeur et ongle rose pour Nail saloon. Le supermarché devient **Megazone**, avec une façade vitrée bleue/jaune, un chariot et une enseigne nominative. Il occupe désormais **4 × 4 cases**.

| Commerce    | Achat | Empreinte | Revenu par période |
| ----------- | ----: | --------: | -----------------: |
| Boulangerie |   300 |     2 × 2 |                 20 |
| Megazone    |   800 |     4 × 4 |                 20 |
| Restaurant  |   500 |     2 × 2 |                 20 |
| Boucherie   |   350 |     2 × 2 |                 20 |
| Pharmacie   |   450 |     2 × 2 |                 20 |
| Coiffeur    |   250 |     2 × 2 |                 20 |
| Nail saloon |   250 |     2 × 2 |                 20 |

Les prix et montants sont des valeurs MVP configurables dans `game_rules` et `src/config/game.ts` ; un test vérifie leur cohérence. Les nouveaux commerces donnent 20 points de contribution.

### Revenus

- La première pièce apparaît **24 heures après la construction**, à partir de `buildings.built_at` enregistré par PostgreSQL.
- Chaque période suivante reste ancrée à la construction : 24 h, 48 h, 72 h… La collecte ne décale pas l’échéance suivante. Une pièce représente **20 pièces d’or**.
- Une seule collecte est possible par commerce et période. Les périodes manquées ne se cumulent pas ; une pièce disponible représente la période courante. Un commerce jamais visité pendant 5 jours rapporte donc 20 pièces à sa collecte, pas 100.
- Cliquez sur la pièce au-dessus du commerce, ou sélectionnez le commerce puis « Récupérer le revenu ». Le menu Actions donne accès aux mêmes commerces au clavier.
- Le **communisme** est le régime par défaut : n’importe quel habitant peut récupérer la pièce et garde le revenu. En **capitalisme**, seul le constructeur du commerce peut la récupérer, même si un autre joueur est maire ou administrateur. La pièce reste visible, mais apparaît réservée pour les autres.
- La transaction prend le verrou de l’île, vérifie le régime et la période à l’heure serveur, inscrit la collecte avec une contrainte unique `(building_id, cycle)`, puis crédite l’habitant authentifié. L’UUID de requête conserve l’idempotence en cas de rejeu. Aucun montant ou horodatage envoyé par le navigateur n’est accepté comme autorité.
- Les maisons, écoles, mairie, hôpital et décorations ne produisent pas ce revenu.

### Élections

La construction de la **première mairie** ouvre immédiatement le premier scrutin, pendant **24 h**. Un nouveau scrutin commence **tous les 15 × 24 h**, selon cette même origine. Plusieurs mairies partagent une seule élection et n’ajoutent pas de votes.

Un bulletin de vote apparaît au-dessus des mairies tant que le scrutin est ouvert. Cliquez dessus, sur le bouton Mairie de l’interface ou sur « Élections et régime économique » dans la fiche d’une mairie.

Les candidats sont les profils présents au début du scrutin. Les habitants arrivés après l’ouverture peuvent voter mais ne seront candidats qu’au prochain scrutin. Chaque utilisateur peut voter **une seule fois**, pour **un autre habitant** ; le choix est définitif. Les résultats agrégés sont affichés, mais le vote individuel de chaque autre joueur reste privé. Le scrutin est fermé à son échéance exacte, même si le navigateur affiche encore des données anciennes.

À la clôture, l’unique candidat avec le plus de voix devient maire. **En cas d’égalité ou d’absence de votes, le maire sortant reste en fonction** ; si le poste était vacant, il le reste. Le maire sortant conserve son mandat pendant le scrutin suivant. Si son compte est supprimé, le poste devient vacant.

Le maire peut choisir entre **Communisme** et **Capitalisme** dans la fenêtre de mairie. Ce choix s’applique immédiatement aux pièces encore disponibles ; il ne transfère ni les bâtiments ni les soldes déjà gagnés. Le serveur vérifie le maire actuel avant chaque changement, sans dérogation pour l’administrateur. Aucun bâtiment ou portefeuille n’est nationalisé par le nom du régime : seule la règle de collecte des revenus change.

### Appliquer et vérifier la migration

Dans Supabase SQL Editor, exécutez `202611050006_commerce_and_elections.sql` **après les migrations précédentes**, puis déployez le frontend. Les soldes, inventaires, attributions et constructions sont conservés. Les Megazone existants sont agrandis en place si possible, sinon déplacés vers la zone 4 × 4 libre la plus proche. Si aucune zone ne convient, toute la migration est annulée avec une erreur explicite.

L’ancien schéma ne conservait pas la date de construction. Pour les commerces et mairies existants, **l’origine des nouveaux délais est donc l’heure d’application de cette migration**, sans prétendre reconstituer une date inconnue. Les nouveaux bâtiments enregistrent leur date réelle.

Les transitions électorales sont exécutées au chargement et lors des actions. Lorsque Supabase Cron est déjà activé, la migration ajoute `island-civic-transitions` toutes les 5 minutes pour traiter les clôtures et ouvertures sans joueur connecté. Si vous activez Cron ensuite :

```sql
select cron.schedule(
  'island-civic-transitions',
  '*/5 * * * *',
  'select public.ensure_civic_state();'
);
```

Les droits de vote et de collecte utilisent toujours les échéances exactes à l’heure serveur. Sans Cron, les transitions hors ligne sont rattrapées au prochain chargement ; aucun vote fictif n’est créé pour les scrutins manqués. La fenêtre de mairie se resynchronise à l’échéance et Realtime diffuse les révisions de l’île aux autres habitants.

Tests : `tests/civic.test.ts` exécute les RPC PostgreSQL pour les revenus, les permissions, le vote, les régimes, la clôture et le calendrier. `tests/civic-rules.test.tsx` vérifie les limites temporelles et l’interface. `e2e/commerce.html` est une fixture isolée permettant de vérifier les graphismes et les clics sur les pièces et bulletins sans créer de faux joueurs dans l’application. Une validation manuelle à deux ou trois comptes sur votre Supabase est encore nécessaire pour confirmer le transport Realtime hébergé.

## Habitants visibles et repousse aléatoire (migration 7)

Appliquez `202611050007_residents_random_regrowth.sql` dans Supabase SQL Editor, après les migrations précédentes, puis déployez le frontend.

### Avatars des habitants connectés

Le suivi ne repose plus uniquement sur un événement de présence WebSocket. Chaque compte ayant créé son personnage signale sa position au serveur par `heartbeat_presence`. Le serveur déduit son identité de `auth.uid()`, utilise le pseudonyme et l’avatar sauvegardés, et ne permet pas de modifier la présence d’un autre utilisateur.

- Un signal est envoyé dès l’arrivée sur l’île, pendant les déplacements (au plus environ 3 fois/s) et toutes les 15 s au repos.
- Les changements de `player_presence` déclenchent une lecture Realtime. Une lecture de secours toutes les 5 s continue à afficher les habitants si le WebSocket est indisponible.
- La migration ajoute `player_presence` à `supabase_realtime` si cette publication existe ; vérifiez-la dans les paramètres de réplication.
- Une présence sans signal depuis 90 s n’est plus affichée. La déconnexion explicite retire immédiatement sa propre ligne ; après une fermeture brutale ou une coupure réseau, l’expiration évite les avatars fantômes. Un retour au premier plan resynchronise la présence.
- Un seul avatar est affiché par compte, même avec plusieurs onglets. Les avatars partagent la même île et affichent leur pseudonyme. Quand plusieurs occupent la même case, leur dessin est légèrement décalé pour qu’ils restent visibles, sans changer leurs coordonnées logiques.
- Les positions sont interpolées visuellement et les changements d’apparence sont rechargés depuis le serveur. Une erreur de configuration de la présence est affichée au lieu d’être ignorée.

La position enregistrée est une présence temporaire, pas un point de sauvegarde : le personnage revient au point d’arrivée après un nouveau chargement du jeu. Les positions et pseudonymes sont des données publiques pour les joueurs authentifiés ; les emails et clés ne sont jamais inclus dans la liste.

### Arbres entièrement coupés

La coupe retire l’arbre entier de la carte : **aucune souche**. Sa case est immédiatement disponible pour marcher, construire ou ajouter une parcelle. Le bois est toujours accordé une seule fois par coupe.

Après **30 minutes**, le serveur choisit une **autre case libre aléatoire**, hors eau, bâtiment, parcelle, arbre actif et point d’arrivée. Il évite aussi les positions récemment signalées par les habitants. L’arbre conserve son identifiant mais réapparaît à cette nouvelle position. Un arbre coupé n’occupe plus son ancienne case dans les contrôles de collision.

Si aucune autre case ne convient, l’arbre reste invisible en attente ; il ne peut pas être recoupé pour gagner du bois. Le serveur réessaie plus tard. La génération quotidienne de 10 nouveaux arbres reste active, distincte de la repousse des arbres coupés.

Le job Cron existant `island-daily-trees` est ajusté à une exécution par minute si Cron est disponible. Sinon, les repousses sont traitées au prochain chargement/action. Si vous activez Cron ensuite :

```sql
select cron.schedule(
  'island-daily-trees',
  '* * * * *',
  'select public.ensure_daily_trees();'
);
```

Le délai minimal de 30 min est contrôlé par l’heure serveur ; la prise en compte visuelle dépend ensuite du passage du job ou d’une synchronisation. La repousse et les constructions prennent le même verrou de l’île pour ne pas occuper la même case. Les anciennes souches sont migrées vers ce nouveau comportement sans perdre leurs horodatages.

Validation : `tests/residents-trees.test.ts` vérifie les identités de deux comptes, les avatars sauvegardés, l’expiration, la coupe complète, les cases libérées, la repousse ailleurs et le terrain plein. Les tests navigateur vérifient aussi la séparation des avatars superposés, leurs déplacements, leur retrait et l’absence de souche. La connexion Realtime sur votre projet hébergé reste à vérifier après application de la migration.

## Mairie officielle et nouveaux bâtiments (migration 8)

La mairie conserve son empreinte 3 × 3 et son prix de 1 000 pièces. Son dessin est remplacé automatiquement, y compris pour les mairies déjà construites : pierre claire, fronton, colonnes, horloge, perron, plaque MAIRIE et drapeaux. Ce changement est graphique et ne déplace aucune mairie existante.

| Ajout        | Catégorie   | Prix | Empreinte | Points |
| ------------ | ----------- | ---: | --------: | -----: |
| Roy Merlin   | Commerces   |  700 |     4 × 4 |     20 |
| Chocolaterie | Commerces   |  450 |     2 × 2 |     20 |
| Ferme        | Agriculture |  400 |     4 × 4 |     30 |
| Hôtel        | Commerces   |  900 |     3 × 3 |     20 |

Roy Merlin possède un grand entrepôt vert, une enseigne avec un marteau et des matériaux devant la façade. La chocolaterie présente une tablette et une devanture cacao/crème. L’hôtel est plus haut, avec plusieurs étages, des balcons, un auvent et une enseigne H. La ferme possède une grange rouge, un silo, une clôture, du foin et un petit tracteur.

Ces prix sont les valeurs par défaut du catalogue, centralisées dans la configuration frontend et la règle serveur `buildings`. Les nouveaux commerces utilisent le revenu de commerce déjà en place. La ferme est un bâtiment agricole ; les parcelles réellement cultivables restent achetées séparément dans Agriculture. Le filtre Agriculture du catalogue permet de la retrouver.

Appliquez `202611050008_more_buildings.sql` dans Supabase SQL Editor après les migrations précédentes, puis déployez le frontend. Cette migration ajoute seulement les quatre entrées de catalogue et annonce la nouvelle révision de l’île. Elle ne modifie aucun portefeuille, stock, construction ou délai existant.

`tests/new-buildings.test.ts` vérifie les entrées du catalogue, l’achat et le placement des quatre bâtiments, les prix, les empreintes et la conservation des constructions existantes. `e2e/catalogue.html` est une scène de test isolée pour le rendu et la sélection sur desktop/mobile, exclue du build de production.

## Correction du chargement et gestion du village (migration 9)

### Erreur Supabase 57014 et catalogue bloqué

`57014 / canceling statement due to statement timeout` signifie que le serveur a interrompu un traitement trop long. La migration 9 rend `load_world` indépendant des traitements de repousse et de transition : la lecture n’exécute plus de maintenance. La carte peut ainsi s’ouvrir même si une maintenance échoue. L’application lance séparément `refresh_world` en arrière-plan, au chargement puis toutes les minutes, et affiche un message si ce traitement attend. Les actions serveur continuent à appliquer les règles du jeu à l’heure serveur.

Le rattrapage des arbres est borné à **5 repousses et une journée de 10 nouveaux arbres par passage**. Les journées restantes restent en file ; elles ne sont pas supprimées. Les recherches de cases libres utilisent des requêtes d’ensemble plutôt qu’un appel de fonction de collision pour chaque case. Cron poursuit le rattrapage par petites étapes, et les prochaines ouvertures/actions du jeu le poursuivent aussi.

Le catalogue ne se bloque plus sur `navigator.onLine`, qui peut être faux même quand Supabase répond. L’application utilise les réponses réelles du serveur. Une erreur SQL (y compris 57014) n’est pas présentée comme une panne réseau. Si le réseau est réellement inaccessible, un message et un bouton de reconnexion apparaissent dans le catalogue. Les achats restent validés par le solde serveur.

### Nouvelles boutiques et routes

- **Coffeeshop** : 300 pièces, 2 × 2 cases, 20 points ; une tasse et de la vapeur sur l’enseigne.
- **Sexshop** : 500 pièces, 2 × 2 cases, 20 points ; un slip stylisé sur l’enseigne.
- Les deux suivent le revenu de commerce existant de 20 pièces par période de 24 h.
- Après une pose de route réussie, le mode reste sélectionné : cliquez sur d’autres cases pour continuer à 1 pièce par case. Échap ou × termine la pose. Les autres bâtiments quittent toujours le mode après une construction.

### Gestion du village

Le maire peut démolir une maison ou un commerce depuis sa fiche. Une confirmation explicite est demandée. La démolition ne rembourse pas l’achat ; les points associés sont retirés et le bâtiment est archivé dans `demolitions` pour l’opérateur de base. Les mairies, bâtiments publics, fermes, routes et décorations ne font pas partie de ce pouvoir.

Le mandat dure maintenant **7 jours après la clôture du scrutin qui a désigné le maire**. Ensuite, un nouveau scrutin de 24 h est ouvert. Une égalité avec des suffrages exprimés ouvre un nouveau tour d’une heure entre les candidats à égalité ; les habitants revotent pour ce tour. Les anciens votes sont conservés avec leur numéro de tour. Sans suffrage exprimé, le maire sortant reste en fonction et un nouveau scrutin est prévu la semaine suivante. Les scrutins déjà terminés ne sont pas réécrits par la migration.

Dans la mairie, le maire peut proposer l’exil d’un autre habitant. La fenêtre initiale est de 24 h. Les habitants présents à l’ouverture, sauf la personne concernée et les personnes déjà en exil, choisissent Oui ou Non. Une majorité des suffrages exprimés décide ; aucun vote vaut refus. Une égalité positive ouvre un nouveau tour d’une heure. Un seul vote d’exil peut être ouvert à la fois.

Un exil adopté dure **24 h à partir de la clôture du vote**. L’habitant reste connecté, mais sa carte devient un tout petit îlot sans arbres, parcelles ou bâtiments. Il ne peut pas agir sur l’île principale pendant ce délai. Son argent, son inventaire et ses propriétés sont conservés. Le chat reste disponible. La présence de son avatar sur l’île principale est retirée. Au terme du délai, la carte principale est rechargée automatiquement. Le retour au premier plan ou un rechargement resynchronise également ce statut.

La migration conserve les constructions existantes, les anciens votes et les attributions. Appliquez `202611050009_recovery_management.sql` dans Supabase SQL Editor après les migrations 1 à 8, puis déployez le frontend. Rechargez les navigateurs déjà ouverts pour utiliser la nouvelle version. Les opérations de maintenance Cron existantes utilisent automatiquement les fonctions mises à jour ; aucun secret supplémentaire n’est nécessaire.

Validation ciblée : `recovery-catalogue.test.ts`, `connection-status.test.ts`, `village-management.test.ts` et `exile-map.test.ts`. Les fixtures navigateur vérifient aussi un catalogue utilisable malgré un faux indicateur hors ligne, les nouvelles enseignes, les routes en continu et le rendu du petit îlot. La correction de la version hébergée nécessite l’application de la migration puis une nouvelle vérification sur votre projet Supabase.

## Îlot visible, fin anticipée du scrutin, étoile et salle de sport (migration 10)

La carte affiche désormais **les deux îles dans la même scène**, pour tous les habitants. L’îlot d’exil est un carré de **3 × 3**, colonnes 57 à 59 et lignes 29 à 31, séparé de la côte est par une case d’eau. Il ne contient ni ressource ni construction. Le bouton 🏝️ permet de le retrouver et de zoomer dessus.

Les habitants bannis arrivent en (58, 30) et peuvent marcher uniquement sur ces neuf cases. Les autres habitants restent sur l’île principale. Les avatars des bannis connectés sont visibles sur l’îlot, avec leur nom. Une personne en exil peut observer l’île principale ; ses actions y restent suspendues. À l’expiration des 24 h, elle revient au point d’arrivée principal. La présence serveur recale aussi les positions lors du début ou de la fin d’un exil.

L’électorat municipal est enregistré à l’ouverture du scrutin : tous les habitants inscrits à cet instant, même hors ligne, sauf les personnes en exil. Les nouveaux inscrits participent au scrutin suivant. **Le dernier vote clôture immédiatement le tour**, sans attendre les 24 h. Une égalité ouvre un nouveau tour d’une heure entre les candidats à égalité, avec le même électorat ; ce tour peut également se terminer plus tôt si tous ont voté. Les habitants placés en exil ne bloquent pas la clôture. Sans vote complet, le délai initial reste appliqué. Le mandat de sept jours part de la clôture effective qui a désigné le maire.

Une petite étoile de shérif dorée à six branches apparaît au-dessus de l’avatar du maire. Elle est visible par lui-même et par les autres habitants, et suit les changements de maire sans reconnexion.

La **Salle de sport** est ajoutée aux Commerces : **600 pièces, 3 × 3, 20 points**, enseigne avec une haltère et équipement visible en vitrine. Elle utilise le revenu de commerce de 20 pièces par période de 24 h et les règles économiques du village.

La migration contient aussi le cadeau demandé de **500 pièces pour le compte `Cam`** (recherche exacte du pseudo, sans tenir compte des majuscules). Le crédit est journalisé dans `economy_transactions`, avec un identifiant fixe : relancer le SQL n’ajoute pas un second cadeau. Si Cam est absent, un message SQL le signale sans modifier les autres comptes ; on peut relancer la migration après la création de ce compte.

Appliquez `202611050010_exile_election_gym.sql` après les migrations 1 à 9, puis déployez le frontend. Le crédit de Cam est effectif uniquement lorsque ce SQL a été exécuté sur la base hébergée. Aucun accès administrateur à la base hébergée n’est disponible dans l’environnement de développement.

Validation : `tests/island-update.test.ts` couvre le crédit unique, la fin anticipée et le nouveau tour, le mandat, le placement des présences et le retour, ainsi que l’achat et le revenu de la salle de sport. `tests/exile-map.test.ts` couvre les neuf cases et les déplacements entre les deux zones. Les tests navigateur vérifient aussi l’îlot, l’étoile locale/distante et la salle de sport sur ordinateur et téléphone.
