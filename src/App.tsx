import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  Axe,
  ArrowLeft,
  ArrowRight,
  Check,
  Compass,
  Coins,
  Hammer,
  Home,
  Leaf,
  LogOut,
  Map,
  Minus,
  Move,
  Package,
  Plus,
  Settings,
  ShoppingBasket,
  Sprout,
  Star,
  Trophy,
  Users,
  X,
} from 'lucide-react';
import { configured, client } from './services/client';
import { useResidents, residentsService } from './hooks/useResidents';
import { authService } from './services/auth';
import {
  civicService,
  agricultureService,
  communityService,
  constructionService,
  economyService,
  islandService,
  profileService,
} from './services/game';
import {
  BUILDINGS,
  CROPS,
  RULES,
  FARM_PLOT,
  PLACEABLES,
  isCommerce,
  CIVIC_RULES,
} from './config/game';
import type { BuildingKind, CropKind } from './config/game';
import type { Avatar, Placement, Player, Selection, World } from './types';
import { buildable, countdown, cropState } from './utils/rules';
import { Landing } from './components/Auth';
import { AvatarEditor, AvatarPortrait } from './components/AvatarEditor';
import { HouseAssignment } from './components/HouseAssignment';
import { CivicPanel } from './components/CivicPanel';
import { incomeStatus, electionOpen } from './utils/civic';
import { Modal } from './components/Modal';
import { Chat } from './components/Chat';
const GameCanvas = lazy(() => import('./game/GameCanvas').then((m) => ({ default: m.GameCanvas })));
import type { IslandScene } from './game/IslandScene';
type Panel =
  | 'build'
  | 'farm'
  | 'market'
  | 'inventory'
  | 'community'
  | 'leaderboard'
  | 'profile'
  | 'civic'
  | 'actions'
  | null;
const errorText = (e: unknown) => (e instanceof Error ? e.message : 'Une erreur est survenue.');
export default function App() {
  const [session, setSession] = useState<Session | null>(null),
    [authReady, setAuthReady] = useState(!configured),
    [recovery, setRecovery] = useState(false),
    [world, setWorld] = useState<World | null>(null),
    [loaded, setLoaded] = useState(false),
    [loadError, setLoadError] = useState(''),
    [panel, setPanel] = useState<Panel>(null),
    [selection, setSelection] = useState<Selection | null>(null),
    [placement, setPlacement] = useState<Placement>(null),
    [busy, setBusy] = useState(false),
    [toast, setToast] = useState(''),
    [players, setPlayers] = useState<Player[]>([]),
    [now, setNow] = useState(Date.now()),
    [offset, setOffset] = useState(0),
    [category, setCategory] = useState('Tous'),
    [draftAvatar, setDraftAvatar] = useState<Avatar | null>(null),
    [tile, setTile] = useState({ x: 30, y: 30 }),
    [network, setNetwork] = useState(navigator.onLine);
  const sceneRef = useRef<IslandScene | null>(null),
    syncGeneration = useRef(0),
    operation = useRef(false),
    toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = useCallback((s: string) => {
    setToast(s);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 5000);
  }, []);
  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );
  useEffect(() => {
    if (!configured) return;
    let live = true;
    client()
      .auth.getSession()
      .then(({ data, error }) => {
        if (!live) return;
        if (error) setLoadError(error.message);
        setSession(data.session);
        setAuthReady(true);
      });
    const { data } = client().auth.onAuthStateChange((event, s) => {
      setSession(s);
      setAuthReady(true);
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
    });
    return () => {
      live = false;
      data.subscription.unsubscribe();
    };
  }, []);
  const load = useCallback(async () => {
    if (!session) return;
    const generation = ++syncGeneration.current;
    const start = Date.now();
    try {
      const w = await islandService.load();
      if (generation !== syncGeneration.current) return;
      setWorld(w);
      if (w) setOffset(Date.parse(w.server_time) - (start + Date.now()) / 2);
      setLoaded(true);
      setLoadError('');
    } catch (e) {
      if (generation === syncGeneration.current) {
        setLoadError(errorText(e));
        setLoaded(true);
      }
    }
  }, [session?.user.id]);
  useEffect(() => {
    setLoaded(false);
    setWorld(null);
    setSelection(null);
    setPlacement(null);
    void load();
    return () => {
      syncGeneration.current++;
    };
  }, [load]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now() + offset), 1000);
    return () => clearInterval(timer);
  }, [offset]);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) void load();
    };
    const net = () => {
      setNetwork(navigator.onLine);
      if (navigator.onLine) void load();
    };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('online', net);
    window.addEventListener('offline', net);
    const id = setInterval(refresh, 60_000);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('online', net);
      window.removeEventListener('offline', net);
    };
  }, [load]);
  useEffect(() => {
    if (!session || !world) return;
    let alive = true;
    void communityService
      .list()
      .then((v) => {
        if (alive) setPlayers(v);
      })
      .catch((e) => notify(errorText(e)));
    return () => {
      alive = false;
    };
  }, [session?.user.id, world?.island.score, panel]);
  const {
    residents: online,
    error: presenceError,
    updatePosition: onPosition,
  } = useResidents(world ? session?.user.id : undefined);
  useEffect(() => {
    if (!world || !session) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void load(), 100);
    };
    const channel = client()
      .channel('shared-world-changes')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'shared_world' }, refresh)
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') refresh();
      });
    return () => {
      clearTimeout(timer);
      void client().removeChannel(channel);
    };
  }, [world?.island.id, session?.user.id, load]);
  useEffect(() => {
    const e = world?.governance?.election;
    if (!e) return;
    const now = Date.now() + offset;
    const closes = Date.parse(e.closes_at);
    const boundary = closes > now ? closes : Date.parse(e.starts_at) + CIVIC_RULES.electionEveryMs;
    if (boundary <= now) return;
    const timer = setTimeout(() => void load(), Math.min(boundary - now + 100, 2_000_000_000));
    return () => clearTimeout(timer);
  }, [world?.governance?.election?.id, world?.governance?.election?.closes_at, offset, load]);
  useEffect(() => {
    if (
      world &&
      selection?.type === 'tree' &&
      !world.trees.some((t) => t.id === selection.id && !t.cut_at)
    )
      setSelection(null);
  }, [world, selection]);
  const previousMature = useRef(new Set<number>());
  useEffect(() => {
    if (!world) return;
    const mature = world.plantations.filter((p) => cropState(p.planted_at, now) === 'mature');
    for (const p of mature)
      if (!previousMature.current.has(p.plot_id)) {
        notify(`${CROPS[p.crop].name} : plantation prête à récolter !`);
        previousMature.current.add(p.plot_id);
      }
    for (const id of previousMature.current)
      if (!mature.some((p) => p.plot_id === id)) previousMature.current.delete(id);
  }, [now, world]);
  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPlacement(null);
        setSelection(null);
      }
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, []);
  async function perform(fn: () => Promise<unknown>, success: string, close = false) {
    if (operation.current || !network) return;
    operation.current = true;
    setBusy(true);
    try {
      await fn();
      notify(success);
      if (close) {
        setSelection(null);
        setPlacement(null);
      }
      await load();
    } catch (e) {
      notify(errorText(e));
    } finally {
      operation.current = false;
      setBusy(false);
    }
  }
  async function place(x: number, y: number) {
    if (!world || !placement || busy) return;
    const b = placement;
    if (!buildable(world, x, y, PLACEABLES[b.kind].size, b.movingId)) {
      notify('Cet emplacement est occupé ou hors de l’île.');
      return;
    }
    await perform(
      () =>
        b.kind === 'farm_plot'
          ? agricultureService.addPlot(x, y)
          : b.movingId
            ? constructionService.move(b.movingId, x, y)
            : constructionService.place(b.kind, x, y),
      b.kind === 'farm_plot'
        ? 'Nouvelle parcelle créée !'
        : b.movingId
          ? 'Bâtiment déplacé !'
          : 'Bâtiment construit !',
      true,
    );
  }
  function startBuild(kind: BuildingKind, movingId?: string) {
    setPlacement({ kind, movingId });
    setPanel(null);
    setSelection(null);
    notify('Choisissez une case libre. Vert : disponible, rouge : occupée.');
  }
  function locatePlayer(p: Player) {
    const presence = online.find((v) => v.id === p.id);
    if (presence) {
      sceneRef.current?.focusTile(presence.x, presence.y);
      setPanel(null);
    } else notify(`${p.username} n’est pas connecté pour le moment.`);
  }
  async function signOut() {
    try {
      await residentsService.offline().catch(() => undefined);
      await authService.signOut();
      setWorld(null);

      setLoaded(false);
      setPanel(null);
    } catch (e) {
      notify(errorText(e));
    }
  }
  if (!authReady)
    return (
      <div className="loading-screen">
        <Leaf className="spin" />
        Connexion à votre île…
      </div>
    );
  if (!configured || !session || recovery)
    return (
      <Landing
        onReady={() => void load()}
        recovery={recovery}
        onRecovered={() => setRecovery(false)}
      />
    );
  if (!loaded)
    return (
      <div className="loading-screen">
        <Leaf className="spin" />
        Le bateau arrive sur votre île…
      </div>
    );
  if (loadError && !world)
    return (
      <div className="error-screen">
        <h1>Impossible de charger l’île</h1>
        <p role="alert">{loadError}</p>
        <p>Vérifiez la connexion et l’application de la migration Supabase.</p>
        <button className="primary" onClick={() => void load()}>
          Réessayer
        </button>
        <button onClick={() => void signOut()}>Se déconnecter</button>
      </div>
    );
  if (!world) return <Landing onboarding onReady={() => void load()} />;
  const tree =
    selection?.type === 'tree'
      ? world.trees.find((t) => t.id === selection.id && !t.cut_at)
      : undefined;
  const plot =
    selection?.type === 'plot' ? world.plots.find((p) => p.id === selection.id) : undefined;
  const plant = plot ? world.plantations.find((p) => p.plot_id === plot.id) : undefined;
  const state = plant ? cropState(plant.planted_at, now) : null;
  const building =
    selection?.type === 'building' ? world.buildings.find((b) => b.id === selection.id) : undefined;
  const tutorial = [
    'Bienvenue sur notre île commune !',
    'Coupe ton premier arbre pour récolter du bois.',
    'Vends ton bois au marché pour gagner des pièces.',
    'Plante ta première culture dans une parcelle.',
    'Construis ton premier bâtiment.',
  ][world.profile.tutorial_step];
  const titles: Record<Exclude<Panel, null>, string> = {
    build: 'Un village à votre image',
    farm: 'Le jardin des possibles',
    market: 'Le marché de l’île',
    inventory: 'Votre sac à trésors',
    community: 'Les habitants de l’île',
    leaderboard: 'Les bâtisseurs à l’honneur',
    profile: 'Votre petit personnage',
    actions: 'Explorer votre île',
    civic: 'La mairie et les élections',
  };
  return (
    <div className="game-shell">
      <Suspense fallback={<div className="loading-screen">Préparation de la carte…</div>}>
        <GameCanvas
          world={world}
          playerAvatar={world.avatar}
          placement={placement}
          offset={offset}
          onSelect={(s) => {
            if (s.type === 'civic') {
              setPanel('civic');
              return;
            }
            if (s.type === 'income') {
              void perform(
                () => civicService.claim(String(s.id)),
                `+${CIVIC_RULES.incomeGold} pièces récupérées !`,
              );
              return;
            }
            setSelection(s);
          }}
          onPlace={(x, y) => void place(x, y)}
          onPosition={onPosition}
          sceneRef={sceneRef}
          guests={online.filter((p) => p.id !== session.user.id && p.island === world.island.id)}
        />
      </Suspense>
      <header className="topbar">
        <div className="island-title">
          <span className="brand-mark">
            <Leaf size={22} />
          </span>
          <div>
            <span className="eyebrow">{'NOTRE ÎLE COMMUNE'}</span>
            <h1>{world.island.name}</h1>
          </div>
        </div>
        <div className="stats">
          {
            <>
              <div className="stat gold">
                <span>
                  <Coins size={21} />
                </span>
                <div>
                  <small>Pièces d’or</small>
                  <strong>{world.island.gold.toLocaleString('fr-FR')}</strong>
                </div>
              </div>
              <div className="stat wood">
                <span>
                  <Axe size={20} />
                </span>
                <div>
                  <small>Bois</small>
                  <strong>{world.inventory.wood ?? 0}</strong>
                </div>
              </div>
            </>
          }
          <div className="stat score">
            <span>
              <Star size={20} />
            </span>
            <div>
              <small>Village</small>
              <strong>
                {world.island.score} <em>pts</em>
              </strong>
            </div>
          </div>
        </div>
        <button
          className="profile-button"
          aria-label="Personnaliser mon avatar"
          onClick={() => {
            setDraftAvatar(world.avatar);
            setPanel('profile');
          }}
        >
          <AvatarPortrait avatar={world.avatar} />
          <span>
            {world.profile.username}
            <small>Insulaire</small>
          </span>
          <Settings size={16} />
        </button>
      </header>
      {!network && (
        <div className="connection-banner" role="alert">
          Connexion perdue. Les actions sont suspendues ; votre progression reste sur le serveur.
        </div>
      )}
      {presenceError && (
        <div className="presence-warning" role="status">
          Avatars en ligne : {presenceError}
        </div>
      )}
      {loadError && (
        <div className="connection-banner" role="alert">
          Synchronisation interrompue : {loadError}
          <button onClick={() => void load()}>Réessayer</button>
        </div>
      )}
      <div className="map-label">
        <span className="live-dot" /> Île commune <span>·</span> {RULES.size} × {RULES.size} cases
      </div>
      {tutorial && !placement && (
        <section className="tutorial">
          <div className="tutorial-icon">
            <Sprout size={24} />
          </div>
          <div>
            <span className="eyebrow">VOS PREMIERS PAS · {world.profile.tutorial_step + 1}/5</span>
            <h3>{tutorial}</h3>
            <p>
              {world.profile.tutorial_step === 0
                ? 'Une île commune, 10 nouveaux arbres par jour et mille possibilités.'
                : 'Chaque petite action fait grandir notre village.'}
            </p>
            <div className="tutorial-dots">
              {[0, 1, 2, 3, 4].map((i) => (
                <span key={i} className={i <= world.profile.tutorial_step ? 'done' : ''} />
              ))}
            </div>
            <div className="tutorial-buttons">
              <button
                className="text-button"
                disabled={busy}
                onClick={() =>
                  void perform(() => profileService.tutorial(5), 'À vous l’aventure !')
                }
              >
                Passer
              </button>
              <button
                className="primary small"
                disabled={busy}
                onClick={() =>
                  void perform(
                    () => profileService.tutorial(world.profile.tutorial_step + 1),
                    'À vous de jouer !',
                  )
                }
              >
                {world.profile.tutorial_step === 0 ? 'C’est parti' : 'Étape suivante'}
                <ArrowRight size={14} />
              </button>
            </div>
          </div>
        </section>
      )}
      <div className="map-tools">
        <button aria-label="Zoom avant" onClick={() => sceneRef.current?.zoom(1.2)}>
          <Plus />
        </button>
        <button aria-label="Zoom arrière" onClick={() => sceneRef.current?.zoom(0.8)}>
          <Minus />
        </button>
        <span />
        <button aria-label="Recentrer l’île" onClick={() => sceneRef.current?.center()}>
          <Compass />
        </button>
        <button aria-label="Actions accessibles au clavier" onClick={() => setPanel('actions')}>
          <Map />
        </button>
      </div>
      <button className="civic-button" onClick={() => setPanel('civic')}>
        🏛️ Mairie · {world.governance?.regime === 'capitalism' ? 'Capitalisme' : 'Communisme'}{' '}
        {electionOpen(world.governance?.election, now) ? '🗳️ Vote ouvert' : ''}
      </button>
      {placement && (
        <div className="placement-banner">
          <Hammer size={20} />
          <div>
            <strong>
              {placement.movingId ? 'Déplacer' : 'Placer'} : {PLACEABLES[placement.kind].name}
            </strong>
            <small>
              {PLACEABLES[placement.kind].size} × {PLACEABLES[placement.kind].size} cases ·{' '}
              {placement.movingId ? 'Gratuit' : PLACEABLES[placement.kind].price + ' pièces'}
            </small>
          </div>
          <button aria-label="Annuler la construction" onClick={() => setPlacement(null)}>
            <X size={20} />
          </button>
        </div>
      )}
      {selection && selection.type !== 'ground' && !placement && (
        <section className="selection-card">
          <button
            className="close-selection"
            aria-label="Fermer la sélection"
            onClick={() => setSelection(null)}
          >
            <X size={16} />
          </button>
          {tree && (
            <>
              <span className="object-emoji">🌳</span>
              <h3>Un arbre généreux</h3>
              <p>5 bois à récolter · Repousse ailleurs après 30 minutes.</p>
              <button
                className="primary"
                disabled={busy || !network}
                onClick={() =>
                  void perform(
                    () => {
                      sceneRef.current?.animateChop(tree.id);
                      return economyService.chop(tree.id);
                    },
                    '+5 bois récoltés',
                    true,
                  )
                }
              >
                <Axe size={16} />
                Couper l’arbre
              </button>
            </>
          )}
          {plot && (
            <>
              <span className="object-emoji">{plant ? CROPS[plant.crop].emoji : '🌱'}</span>
              <h3>{plant ? CROPS[plant.crop].name : 'Une parcelle fertile'}</h3>
              {plant ? (
                <>
                  <p>
                    {state === 'withered'
                      ? 'Plantation fanée · sans valeur'
                      : state === 'mature'
                        ? 'Prête à récolter !'
                        : 'En croissance'}
                  </p>
                  {state !== 'withered' && (
                    <div className="countdown">
                      {countdown(
                        (state === 'mature' ? RULES.witherMs : RULES.matureMs) -
                          (now - Date.parse(plant.planted_at)),
                      )}
                      <small>avant {state === 'mature' ? 'fanaison' : 'maturité'}</small>
                    </div>
                  )}
                  {state === 'mature' && (
                    <button
                      className="primary"
                      disabled={busy || !network}
                      onClick={() =>
                        void perform(
                          () => agricultureService.harvest(plot.id),
                          '+2 ' + CROPS[plant.crop].name.toLowerCase() + ' récoltées',
                          true,
                        )
                      }
                    >
                      Récolter
                    </button>
                  )}
                  {state === 'withered' && (
                    <button
                      className="primary"
                      disabled={busy || !network}
                      onClick={() =>
                        void perform(
                          () => agricultureService.clear(plot.id),
                          'Parcelle libérée',
                          true,
                        )
                      }
                    >
                      Retirer gratuitement
                    </button>
                  )}
                </>
              ) : (
                <>
                  <p>8 h pour grandir, 4 h pour récolter.</p>
                  <div className="seed-options">
                    {Object.entries(CROPS).map(([key, c]) => (
                      <button
                        key={key}
                        disabled={busy || !network || world.island.gold < c.seed}
                        onClick={() =>
                          void perform(
                            () => agricultureService.plant(plot.id, key),
                            'Petite graine, grande aventure !',
                            true,
                          )
                        }
                      >
                        <span>
                          {c.emoji} {c.name}
                        </span>
                        <strong>{c.seed} 🪙</strong>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
          {building && (
            <>
              <span className="object-emoji">{BUILDINGS[building.kind].icon}</span>
              <h3>{BUILDINGS[building.kind].name}</h3>
              <p>
                Construit par{' '}
                {players.find((p) => p.id === building.created_by)?.username ??
                  'un ancien habitant'}
              </p>
              {['cottage', 'house'].includes(building.kind) && (
                <HouseAssignment
                  key={building.id}
                  building={building}
                  players={players}
                  disabled={
                    busy ||
                    !network ||
                    (building.created_by !== session.user.id && !world.profile.is_admin)
                  }
                  onAssign={(userId) =>
                    void perform(
                      () => constructionService.assign(building.id, userId),
                      'Maison attribuée définitivement !',
                    )
                  }
                />
              )}

              {isCommerce(building.kind) &&
                (() => {
                  const income = incomeStatus(
                    building,
                    now,
                    world.governance?.regime ?? 'communism',
                    session.user.id,
                  );
                  return (
                    <div className="commerce-income">
                      <p>Revenu : {CIVIC_RULES.incomeGold} pièces / 24 h</p>
                      {income.ready ? (
                        <button
                          className="primary"
                          disabled={busy || !network || !income.canClaim}
                          onClick={() =>
                            void perform(
                              () => civicService.claim(building.id),
                              `+${CIVIC_RULES.incomeGold} pièces récupérées !`,
                            )
                          }
                        >
                          🪙 {income.canClaim ? 'Récupérer le revenu' : 'Réservé au constructeur'}
                        </button>
                      ) : (
                        <p>
                          Prochaine pièce dans <strong>{countdown(income.remaining)}</strong>
                        </p>
                      )}
                    </div>
                  );
                })()}
              {building.kind === 'townhall' && (
                <button
                  className="primary"
                  onClick={() => {
                    setSelection(null);
                    setPanel('civic');
                  }}
                >
                  🗳️ Élections et régime économique
                </button>
              )}
              <p>
                {building.size} × {building.size} cases · {BUILDINGS[building.kind].points} points
              </p>
              <button
                className="primary"
                disabled={
                  !network || (building.created_by !== session.user.id && !world.profile.is_admin)
                }
                onClick={() => startBuild(building.kind, building.id)}
              >
                <Move size={16} />
                Déplacer gratuitement
              </button>
            </>
          )}
        </section>
      )}
      <Chat userId={session.user.id} admin={world.profile.is_admin} notify={notify} />
      <div className="bottom-caption">
        <span>
          <Leaf size={13} /> Chaque village commence par une petite graine.
        </span>
        <small>Cliquer pour marcher · Glisser pour explorer · Molette pour zoomer</small>
      </div>
      <nav className="bottom-nav" aria-label="Menu principal">
        {(
          [
            { key: 'build', label: 'Construire', icon: Hammer },
            { key: 'farm', label: 'Agriculture', icon: Sprout },
            { key: 'market', label: 'Marché', icon: ShoppingBasket },
            { key: 'inventory', label: 'Inventaire', icon: Package },
            { key: 'community', label: 'Communauté', icon: Users },
            { key: 'leaderboard', label: 'Classement', icon: Trophy },
          ] as const
        ).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            className={panel === key ? 'active' : ''}
            onClick={() => {
              setPanel(key);
              setSelection(null);
            }}
          >
            <Icon size={23} />
            <span>{label}</span>
            {key === 'build' && <i>NOUVEAU</i>}
          </button>
        ))}
      </nav>
      {toast && (
        <div className="toast" role="status">
          <Check size={18} />
          {toast}
        </div>
      )}
      {panel && (
        <Modal title={titles[panel]} onClose={() => setPanel(null)}>
          {panel === 'civic' && (
            <CivicPanel
              governance={world.governance}
              players={players}
              userId={session.user.id}
              now={now}
              busy={busy || !network}
              onVote={(id, electionId) =>
                void perform(() => civicService.vote(id, electionId), 'Vote enregistré !')
              }
              onRegime={(mode) =>
                void perform(() => civicService.setRegime(mode), 'Régime économique mis à jour !')
              }
            />
          )}
          {panel === 'build' && (
            <>
              <p className="muted">
                Un toit, un jardin, un lieu où se retrouver. Faites grandir votre île.
              </p>
              <div className="balance-line">
                <Coins size={18} />
                {world.island.gold} pièces disponibles
              </div>
              <div className="filters">
                {['Tous', 'Habitations', 'Commerces', 'Services', 'Décorations'].map((c) => (
                  <button
                    className={category === c ? 'active' : ''}
                    key={c}
                    onClick={() => setCategory(c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
              <div className="catalog">
                {Object.entries(BUILDINGS)
                  .filter(([, b]) => category === 'Tous' || b.category === category)
                  .map(([key, b]) => (
                    <article key={key}>
                      <div className={'building-art art-' + key}>
                        <span>{b.icon}</span>
                        <small>
                          {b.size} × {b.size}
                        </small>
                      </div>
                      <div className="catalog-detail">
                        <h3>{b.name}</h3>
                        <p>+{b.points} points de village</p>
                        <button
                          className="buy-button"
                          disabled={world.island.gold < b.price || !network}
                          onClick={() => startBuild(key as BuildingKind)}
                        >
                          <Coins size={15} />
                          {b.price}
                          <Plus size={15} />
                        </button>
                      </div>
                    </article>
                  ))}
              </div>
              <p className="hint">
                Le montant est débité seulement après le placement. Déplacement gratuit.
              </p>
            </>
          )}
          {panel === 'farm' && (
            <>
              <div className="info-strip">
                <Sprout />
                <p>
                  <strong>Les bonnes choses prennent du temps.</strong>
                  <br />
                  Maturité après 8 h. Récoltez avant 12 h, même après une déconnexion.
                </p>
              </div>
              <div className="info-strip">
                <Sprout />
                <div>
                  <strong>Agrandir le potager commun</strong>
                  <p>
                    Ajoutez une parcelle de 1 × 1 case pour {FARM_PLOT.price} pièces. Le montant est
                    débité après le placement.
                  </p>
                  <button
                    className="primary"
                    disabled={busy || !network || world.island.gold < FARM_PLOT.price}
                    onClick={() => {
                      setPlacement({ kind: 'farm_plot' });
                      setSelection(null);
                      setPanel(null);
                    }}
                  >
                    <Plus size={16} /> Ajouter une parcelle · {FARM_PLOT.price} pièces
                  </button>
                  {world.island.gold < FARM_PLOT.price && (
                    <p>Fonds insuffisants : {FARM_PLOT.price} pièces nécessaires.</p>
                  )}
                </div>
              </div>
              <div className="crop-catalog">
                {Object.entries(CROPS).map(([key, c]) => (
                  <article key={key}>
                    <span>{c.emoji}</span>
                    <h3>{c.name}</h3>
                    <p>
                      Graine : {c.seed} pièces
                      <br />
                      Récolte : 2 × {c.price} pièces
                    </p>
                    <button
                      className="secondary"
                      disabled={
                        !world.plots.some((p) => !world.plantations.some((v) => v.plot_id === p.id))
                      }
                      onClick={() => {
                        const p = world.plots.find(
                          (p) => !world.plantations.some((v) => v.plot_id === p.id),
                        );
                        if (p) {
                          setPanel(null);
                          setSelection({ type: 'plot', id: p.id, x: p.x, y: p.y });
                        }
                      }}
                    >
                      Choisir une parcelle
                    </button>
                  </article>
                ))}
              </div>
              <h3>Parcelles communes ({world.plots.length})</h3>
              <div className="resource-list">
                {world.plots.map((p, i) => {
                  const c = world.plantations.find((v) => v.plot_id === p.id);
                  return (
                    <button
                      key={p.id}
                      onClick={() => {
                        setSelection({ type: 'plot', id: p.id, x: p.x, y: p.y });
                        setPanel(null);
                      }}
                    >
                      <span>🌱 Parcelle {i + 1}</span>
                      <span>
                        {c
                          ? CROPS[c.crop].name +
                            ' · ' +
                            {
                              sprout: 'petite pousse',
                              growing: 'croissance',
                              mature: 'mature',
                              withered: 'fanée',
                            }[cropState(c.planted_at, now)]
                          : 'Terre nue'}
                        <ArrowRight size={16} />
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
          {(panel === 'market' || panel === 'inventory') && (
            <>
              <p className="muted">
                {panel === 'market'
                  ? 'Les trésors de votre île font le bonheur du marché.'
                  : 'Tout ce que vous avez récolté, bien à l’abri dans votre sac.'}
              </p>
              <div className="resource-list">
                {(['wood', ...Object.keys(CROPS)] as const).map((key) => {
                  const c =
                    key === 'wood'
                      ? { emoji: '🪵', name: 'Bois', price: RULES.woodPrice }
                      : CROPS[key as CropKind];
                  const stock = world.inventory[key] ?? 0;
                  return (
                    <article className="resource-row" key={key}>
                      <span className="resource-icon">{c.emoji}</span>
                      <div>
                        <h3>
                          {c.name}
                          <span className="stock">× {stock}</span>
                        </h3>
                        <p>{c.price} pièces / unité</p>
                      </div>
                      {panel === 'market' && (
                        <div className="sell-actions">
                          {[1, 10, stock].map((q, i) => (
                            <button
                              key={i}
                              disabled={busy || !network || q <= 0 || q > stock}
                              onClick={() =>
                                void perform(
                                  () => economyService.sell(key, q),
                                  `+${q * c.price} pièces gagnées`,
                                )
                              }
                            >
                              {i === 2 ? 'Tout vendre' : `Vendre ${q}`}
                            </button>
                          ))}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
              {panel === 'inventory' && (
                <button className="primary" onClick={() => setPanel('market')}>
                  <ShoppingBasket size={18} />
                  Aller au marché
                </button>
              )}
            </>
          )}
          {(panel === 'community' || panel === 'leaderboard') && (
            <>
              <p className="muted">
                {panel === 'community'
                  ? 'Tous les habitants partagent cette île. Retrouvez les personnes connectées sur la carte.'
                  : 'Chaque maison, chaque jardin compte. Le classement se met à jour après les constructions.'}
              </p>
              <div className="player-list">
                {players.map((p, i) => (
                  <article key={p.id}>
                    <span className="rank">
                      {panel === 'leaderboard' ? (
                        i < 3 ? (
                          ['🥇', '🥈', '🥉'][i]
                        ) : (
                          i + 1
                        )
                      ) : (
                        <Home size={23} />
                      )}
                    </span>
                    <div>
                      <h3>
                        {p.username}
                        {p.id === session.user.id && <small> vous</small>}
                      </h3>
                      <p>
                        {p.island_name} · {p.building_count} bâtiments
                      </p>
                      <small className="player-status">
                        <span
                          className={
                            'live-dot ' + (online.some((x) => x.id === p.id) ? '' : 'offline')
                          }
                        />
                        {online.some((x) => x.id === p.id) ? 'En ligne' : 'Hors ligne'}
                      </small>
                    </div>
                    <strong>
                      {p.score}
                      <small> pts</small>
                    </strong>
                    <button className="secondary" onClick={() => locatePlayer(p)}>
                      Retrouver
                      <ArrowRight size={15} />
                    </button>
                  </article>
                ))}
              </div>
              {!players.length && (
                <p className="empty">Le classement apparaîtra après le chargement des villages.</p>
              )}
            </>
          )}
          {panel === 'profile' && (
            <>
              <AvatarEditor value={draftAvatar ?? world.avatar} onChange={setDraftAvatar} />
              <p className="muted">
                {world.profile.username} · {world.island.name} · {world.island.score} points
              </p>
              <button
                className="primary"
                disabled={busy || !network}
                onClick={() =>
                  void perform(
                    () => profileService.avatar(draftAvatar ?? world.avatar),
                    'Personnage enregistré !',
                  )
                }
              >
                Enregistrer mon personnage
              </button>
              <hr />
              <button className="text-button" onClick={() => void signOut()}>
                <LogOut size={16} /> Se déconnecter
              </button>
            </>
          )}
          {panel === 'actions' && (
            <>
              <p className="muted">
                Accédez aux ressources sans utiliser la carte. Les coordonnées permettent aussi de
                construire au clavier.
              </p>
              <h3>Arbres</h3>
              <div className="accessible-grid">
                {world.trees
                  .filter((t) => !t.cut_at)
                  .map((t, i) => (
                    <button
                      key={t.id}
                      onClick={() => {
                        setSelection({ type: 'tree', id: t.id, x: t.x, y: t.y });
                        setPanel(null);
                      }}
                    >
                      🌳 Arbre {i + 1} ({t.x}, {t.y})
                    </button>
                  ))}
              </div>
              <h3>Parcelles</h3>
              <div className="accessible-grid">
                {world.plots.map((p, i) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      setSelection({ type: 'plot', id: p.id, x: p.x, y: p.y });
                      setPanel(null);
                    }}
                  >
                    🌱 Parcelle {i + 1}
                  </button>
                ))}
              </div>
              <h3>Bâtiments</h3>
              <div className="accessible-grid">
                {world.buildings.map((b) => (
                  <button
                    key={b.id}
                    onClick={() => {
                      setSelection({ type: 'building', id: b.id, x: b.x, y: b.y });
                      setPanel(null);
                    }}
                  >
                    {BUILDINGS[b.kind].name} ({b.x}, {b.y})
                  </button>
                ))}
              </div>
              {placement && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void place(tile.x, tile.y);
                  }}
                >
                  <h3>Placer {PLACEABLES[placement.kind].name}</h3>
                  <div className="coordinate-inputs">
                    <label>
                      Colonne
                      <input
                        type="number"
                        min={0}
                        max={RULES.size - 1}
                        required
                        value={tile.x}
                        onChange={(e) => setTile({ ...tile, x: Number(e.target.value) })}
                      />
                    </label>
                    <label>
                      Ligne
                      <input
                        type="number"
                        min={0}
                        max={RULES.size - 1}
                        required
                        value={tile.y}
                        onChange={(e) => setTile({ ...tile, y: Number(e.target.value) })}
                      />
                    </label>
                  </div>
                  <p>
                    {buildable(
                      world,
                      tile.x,
                      tile.y,
                      PLACEABLES[placement.kind].size,
                      placement.movingId,
                    )
                      ? '✓ Emplacement disponible'
                      : 'Emplacement indisponible'}
                  </p>
                  <button
                    className="primary"
                    disabled={
                      busy ||
                      !network ||
                      !buildable(
                        world,
                        tile.x,
                        tile.y,
                        PLACEABLES[placement.kind].size,
                        placement.movingId,
                      )
                    }
                  >
                    Confirmer le placement
                  </button>
                </form>
              )}
            </>
          )}
        </Modal>
      )}
    </div>
  );
}
