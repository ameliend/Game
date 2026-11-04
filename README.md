# Island Village

Jeu web de village multijoueur, en français : React 19, TypeScript, Vite, Tailwind CSS 4, Phaser 3, Lucide et Supabase. Les graphismes de la carte sont dessinés localement avec Phaser. Aucune image distante ni ressource payante n’est nécessaire.

## État du projet

Le frontend, la carte, les migrations et les opérations serveur sont implémentés. Sans configuration Supabase, l’accueil affiche les étapes de configuration : il ne crée ni session, ni village fictif. Les tests PostgreSQL utilisent une base PGlite isolée et les tests de carte une scène de test dédiée ; ces données ne sont jamais chargées dans l’application.

La compilation, les règles et les fonctions SQL sont vérifiables sans service externe. La confirmation d’e-mail, le SMTP de récupération, les WebSockets Realtime et le fonctionnement entre deux comptes sur Supabase nécessitent votre propre projet. Aucun projet distant ni déploiement n’est créé automatiquement.

## Démarrage

Prérequis : Node.js 22.12+ (Node 24 recommandé), npm, un projet Supabase gratuit.

```sh
cd /workspace/Game
npm ci
cp .env.example .env.local
```

Renseignez dans `.env.local` :

```dotenv
VITE_SUPABASE_URL=https://VOTRE_REFERENCE.supabase.co
VITE_SUPABASE_ANON_KEY=VOTRE_CLE_PUBLIQUE
```

Utilisez la clé **publishable** (`sb_publishable_…`) ou l’ancienne clé **anon**, accessibles dans les paramètres API du projet Supabase. Ces clés sont publiques et intégrées au bundle frontend. **Ne mettez jamais de clé service_role ou de clé secrète dans une variable VITE\_.** Le fichier `.env.local` est ignoré par Git.

```sh
npm run dev
```

Vite écoute sur le port 5173. Après une modification des variables, relancez Vite. Le serveur de développement ne remplace pas un déploiement public.

### Configurer Supabase exactement

1. Créez un projet sur Supabase et conservez le mot de passe de base de données dans votre gestionnaire de secrets.
2. Dans **SQL Editor**, exécutez le fichier complet `supabase/migrations/202611040001_island_village.sql` une seule fois sur une base neuve. Il crée les tables, les index, les politiques RLS, les fonctions et la publication Realtime du chat. N’exécutez pas les fixtures du dossier `tests/` dans ce projet.
3. Dans **Authentication → Providers → Email**, activez email/password et la confirmation d’e-mail. Dans **URL Configuration**, définissez le Site URL sur votre URL déployée et ajoutez les URL de redirection de développement (`http://localhost:5173`) et de production (origine exacte du site, sans chemin). L’inscription et la récupération redirigent vers l’origine du site.
4. Configurez le SMTP pour l’envoi réel aux destinataires souhaités. Le service mail de test de Supabase impose des limites de destinataires et de débit ; utilisez un fournisseur SMTP compatible disposant d’une offre gratuite si nécessaire. Aucune clé SMTP ne va dans le frontend.
5. Dans **Database → Replication**, vérifiez que `chat_messages` figure dans la publication `supabase_realtime` (la migration l’ajoute si elle existe). Activez le service Realtime. Le canal de présence utilise l’accès standard des utilisateurs authentifiés ; ne désactivez pas les canaux publics sans adapter le code et les politiques d’autorisation Realtime.
6. Renseignez les deux variables ci-dessus et redémarrez l’application. Inscrivez-vous, confirmez l’e-mail, puis choisissez le pseudonyme, le nom de l’île et l’avatar.
7. Dans un environnement cloud à réseau restreint, autorisez le **nom d’hôte exact** de votre projet (`VOTRE_REFERENCE.supabase.co`) dans les paramètres réseau. Le navigateur et les outils de test doivent pouvoir accéder à HTTPS et aux WebSockets Supabase. Les dépendances npm nécessitent `registry.npmjs.org`.

Alternative CLI si vous utilisez déjà Supabase CLI : `supabase login`, `supabase link --project-ref VOTRE_REFERENCE`, puis `supabase db push` depuis ce dépôt. L’application n’a pas besoin d’Edge Functions : la logique sensible est dans PostgreSQL. N’appliquez pas la migration manuellement et par CLI sur la même base sans aligner l’historique des migrations.

### Première partie

Le village démarre avec **100 pièces, 12 arbres, 4 parcelles, aucun bâtiment**. Cliquez sur un arbre puis sur « Couper l’arbre ». Vendez le bois au marché : 5 bois rapportent 20 pièces. Les arbres repoussent après 30 minutes.

Une graine est achetée et plantée en une seule transaction. Une culture est récoltable à partir de 8 h incluses, puis fanée à partir de 12 h incluses. La récolte donne 2 unités ; le retrait d’une culture fanée est gratuit. La fermeture du navigateur ne suspend pas la croissance.

Dans Construire, choisissez un bâtiment, puis une zone verte de la carte. Les cases rouges sont interdites. Le prix n’est débité qu’après un placement valide. Sélectionnez un bâtiment pour le déplacer gratuitement. Les arbres, y compris leurs souches, réservent leurs cases pour la repousse. Les routes occupent une case et sont praticables.

Les étapes du tutoriel sont sauvegardées et progressent aussi avec les actions correspondantes. Il peut être ignoré ou avancé manuellement.

### Contrôles et accessibilité

- Clic/toucher sur la terre : déplacement avec recherche de chemin.
- Flèches, ZQSD ou WASD : déplacement du personnage.
- Glisser : déplacement de caméra. Molette ou pincement à deux doigts : zoom. Boutons +/− et boussole : zoom/recentrage.
- Menu **Actions** (icône de carte à droite) : sélection des arbres, parcelles et bâtiments par boutons accessibles au clavier.
- Pour construire au clavier : choisissez le bâtiment, ouvrez Actions, saisissez colonne et ligne (0 à 29), puis confirmez. Échap annule le placement.
- Les modales natives gèrent le focus, la fermeture par Échap et la navigation clavier. Le chat et les actions ont des libellés accessibles. La carte est complétée par les listes de ressources.

## Architecture

```text
src/
  components/       Authentification, avatar, modales, chat
  config/game.ts    Prix et catalogues affichés, durées, paramètres d’avatar
  game/             Scène Phaser, carte isométrique 30×30, pathfinding, visiteurs
  services/         Auth, îles, économie, agriculture, constructions, communauté, chat
  types/            Contrats des données
  utils/            Règles d’affichage, collisions, temps, chemins
  App.tsx           Coordination session / synchronisation / interface du jeu
supabase/migrations/ Tables, RLS, fonctions PostgreSQL transactionnelles
 tests/             Tests unitaires et PostgreSQL embarqué
 e2e/               Tests navigateur et scène isolée, exclus du build de production
```

La table `game_rules` est la source d’autorité économique. `src/config/game.ts` contient les mêmes paramètres pour l’interface ; un test compare les deux catalogues. Pour modifier les prix après déploiement, ajoutez une nouvelle migration mettant à jour `game_rules` et adaptez le fichier frontend. Ne modifiez pas une migration déjà appliquée.

### Intégrité des données

- Toutes les mutations de progression passent par `game_action` ; `auth.uid()` détermine le propriétaire, jamais un identifiant de joueur envoyé par le client.
- Un verrou par profil sérialise les opérations. Le débit, la récompense, le stock, le score et le journal sont dans la même transaction. Une erreur annule tout.
- Chaque action porte un UUID d’idempotence. Le rejeu de la même requête n’exécute pas l’opération deux fois. Réutiliser un UUID avec une autre charge utile est refusé. Le client suspend les actions hors connexion et affiche les erreurs ; il n’effectue pas de rejeu automatique après un résultat réseau incertain. La synchronisation recharge l’état réel du serveur.
- Les horaires viennent des timestamps PostgreSQL. Le frontend se synchronise sur l’heure serveur, à chaque retour au premier plan et toutes les minutes. L’affichage n’autorise jamais une récompense : le serveur revérifie toujours.
- RLS est activé sur toutes les tables. Les écritures directes sont révoquées. Les RPC `SECURITY DEFINER` ont un `search_path` vide, des noms qualifiés et un accès limité au rôle `authenticated`.
- `load_world` masque l’inventaire, le solde, les indicateurs privés et les privilèges d’un autre joueur. `community` ne retourne que des données publiques. Les e-mails restent dans `auth.users`.
- Les messages sont du texte React échappé (aucun HTML interprété), limités à 500 caractères. Le serveur impose 2 s entre deux envois et 150 ms entre actions de jeu. Les identifiants d’expéditeur et les récompenses proviennent exclusivement du serveur.
- Supabase peut conserver la **session d’authentification** dans le stockage navigateur. **Aucune progression de jeu n’y est stockée** : elle réside dans PostgreSQL.

### Multijoueur et administration

Communauté et Classement affichent les 100 premiers villages, par score et pseudonyme. Le classement se recharge à l’ouverture et après une construction. Les visites chargent les données réelles du propriétaire ; elles sont en lecture seule. Les avatars des joueurs présents sur la même île sont affichés avec leur pseudonyme. La présence est éphémère, déclarative et ne sert jamais à autoriser une action économique.

Le chat charge les 100 derniers messages, reçoit les insertions/suppressions Realtime et conserve un indicateur de nouveaux messages lorsqu’il est réduit. Un utilisateur peut supprimer ses messages ou signaler ceux d’autrui. L’administrateur peut supprimer tout message. Les signalements sont stockés dans `chat_reports` et consultables uniquement par un opérateur autorisé dans SQL Editor (pas d’interface de modération dédiée dans ce MVP).

Pour nommer un administrateur, exécutez explicitement dans SQL Editor, avec le vrai UUID du compte concerné :

```sql
update public.profiles set is_admin = true where id = 'UUID_DU_COMPTE';
```

Ne donnez jamais ces droits depuis le frontend. Les horodatages de présence et positions ne sont pas persistés : les avatars reviennent au point d’arrivée lors d’une nouvelle visite. Les constructions, inventaires, cultures, souches, avatar, tutoriel et solde sont conservés.

## Tests et compilation

```sh
npm test             # règles, rendu sûr du chat, vraie migration + RPC dans PGlite
npm run test:db      # uniquement PostgreSQL embarqué
npm run build        # contrôle TypeScript + bundle Vite
npm run preview      # sert dist pour contrôle local
```

PGlite est PostgreSQL compilé en WebAssembly : les tests exécutent la migration, PL/pgSQL, les contraintes, les rôles et RLS. Le schéma `auth` est remplacé **uniquement dans les tests** par un contexte d’identité contrôlé. Cela ne valide pas le service Auth de Supabase, la concurrence entre connexions PostgreSQL indépendantes ou le transport Realtime.

Pour les tests navigateur, laissez Supabase non configuré dans ce processus (le test d’accueil vérifie cet état) :

```sh
npx playwright install chromium
npm run test:e2e
# Si Chromium est déjà fourni par votre environnement Linux :
PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e
```

La scène `e2e/map.html` est une fixture de test explicitement isolée, pas un mode démo du produit. Playwright vérifie le canvas Phaser, les clics sur arbres/parcelles, le déplacement et le placement sur desktop/mobile. Le build Vite de production n’inclut pas cette scène.

### Validation manuelle avec votre Supabase

1. Créez et confirmez deux comptes dans deux profils de navigateur distincts.
2. Vérifiez l’unicité des pseudonymes, l’avatar et les ressources initiales.
3. Coupez et vendez du bois. Rechargez puis reconnectez-vous : état conservé, pas de double coupe.
4. Plantez une culture. Vérifiez la fenêtre de 8 à 12 h avec des timestamps modifiés **dans un projet de test seulement** ; ne changez jamais les durées de production pour simuler un résultat.
5. Construisez, tentez un chevauchement et déplacez le bâtiment. Vérifiez le solde, le score et le classement.
6. Envoyez un message entre les deux navigateurs ; vérifiez réception instantanée, suppression, signalement et limitation de fréquence.
7. Visitez l’autre île : vérifiez les avatars et l’impossibilité d’agir sur ses ressources.
8. Déconnectez-vous, fermez le navigateur et reconnectez-vous. Testez également la récupération du mot de passe avec votre configuration SMTP.

## Déployer sur Vercel

1. Importez le dépôt dans Vercel, sélectionnez le framework Vite et Node.js 24.
2. Commande de build : `npm run build`. Répertoire de sortie : `dist`.
3. Ajoutez `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY` dans les variables du projet pour les environnements voulus. Relancez un déploiement après tout changement de variable.
4. Configurez le Site URL et la liste d’URL de redirection Supabase avec l’origine Vercel ou le domaine définitif. Privilégiez les origines exactes pour éviter les redirections trop permissives.
5. Déployez puis effectuez la validation manuelle ci-dessus. `vercel.json` fournit le repli SPA ; aucun serveur Node permanent n’est requis.

Les limites des offres gratuites Supabase/Vercel s’appliquent. Phaser est chargé à l’ouverture d’une île ; son bundle est conséquent. Aucun achat réel, paiement ni mécanique payante n’est implémenté.
