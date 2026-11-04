import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, it } from 'vitest';
import { BUILDINGS, CROPS, RULES } from '../src/config/game';
const db = new PGlite();
const A = '00000000-0000-0000-0000-000000000001',
  B = '00000000-0000-0000-0000-000000000002';
const avatar = { skin: '#dba77c', hair: '#754d32', shirt: '#eaa66d', pants: '#486f70' };
async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
  return (await db.query<T>(sql, params)).rows;
}
async function scalar(sql: string, params: unknown[] = []) {
  return Object.values((await q(sql, params))[0])[0];
}
async function asUser(id = A) {
  await db.exec('reset role');
  await q("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec('set role authenticated');
}
async function admin(sql: string, params: unknown[] = []) {
  await db.exec('reset role');
  try {
    return await q(sql, params);
  } finally {
    await db.exec('set role authenticated');
  }
}
async function action(
  type: string,
  payload: Record<string, unknown>,
  request = crypto.randomUUID(),
) {
  return scalar('select public.game_action($1,$2::jsonb,$3::uuid)', [
    type,
    JSON.stringify(payload),
    request,
  ]);
}
async function treeId() {
  return Number(await scalar("select (public.load_world()->'trees'->0->>'id')::bigint"));
}
async function plotId() {
  return Number(await scalar("select (public.load_world()->'plots'->0->>'id')::bigint"));
}
async function gold() {
  return Number(await scalar("select (public.load_world()->'island'->>'gold')::bigint"));
}
async function inventory(item: string) {
  return Number(await scalar("select (public.load_world()->'inventory'->>$1)::integer", [item]));
}
async function cooldown() {
  await admin('update public.profiles set last_action_at=null');
}
async function rejected(fn: () => Promise<unknown>, pattern: RegExp) {
  await db.exec('savepoint rejected_action');
  await expect(fn()).rejects.toThrow(pattern);
  await db.exec('rollback to savepoint rejected_action');
  await db.exec('release savepoint rejected_action');
}
beforeAll(async () => {
  await db.exec(
    "create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;",
  );
  await db.exec(
    readFileSync(
      new URL('../supabase/migrations/202611040001_island_village.sql', import.meta.url),
      'utf8',
    ),
  );
  await q('insert into auth.users values ($1),($2)', [A, B]);
  for (const [id, name] of [
    [A, 'Alice'],
    [B, 'Bob'],
  ]) {
    await asUser(id);
    await q('select public.create_village($1,$2,$3::jsonb)', [
      name,
      'Île de ' + name,
      JSON.stringify(avatar),
    ]);
  }
}, 60_000);
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.exec('reset role;begin');
  await asUser();
});
afterEach(async () => {
  await db.exec('rollback;reset role');
});
describe('Migration et règles canoniques', () => {
  it('initialise exactement le village demandé', async () => {
    const w = (await scalar('select public.load_world()')) as any;
    expect(w.island.gold).toBe(100);
    expect(w.trees).toHaveLength(12);
    expect(w.plots).toHaveLength(4);
    expect(w.buildings).toEqual([]);
    expect(w.plantations).toEqual([]);
    expect(w.inventory.wood).toBe(0);
  });
  it('garde les catalogues serveur synchronisés avec le frontend', async () => {
    const rows = await admin('select * from public.game_rules');
    const rules = Object.fromEntries(rows.map((r) => [r.key, r.value])) as any;
    expect(rules.timing).toEqual({
      mature_seconds: RULES.matureMs / 1000,
      wither_seconds: RULES.witherMs / 1000,
      regrow_seconds: RULES.regrowMs / 1000,
      tree_wood: RULES.treeWood,
      wood_price: RULES.woodPrice,
      initial_gold: RULES.initialGold,
    });
    for (const [k, v] of Object.entries(BUILDINGS))
      expect(rules.buildings[k]).toEqual({ price: v.price, points: v.points, size: v.size });
    for (const [k, v] of Object.entries(CROPS))
      expect(rules.crops[k]).toEqual({ seed: v.seed, price: v.price, yield: v.yield });
  });
  it('interdit les pseudonymes dupliqués sans tenir compte de la casse', async () => {
    await admin('insert into auth.users values ($1)', ['00000000-0000-0000-0000-000000000003']);
    await asUser('00000000-0000-0000-0000-000000000003');
    await rejected(
      () =>
        q('select public.create_village($1,$2,$3::jsonb)', [
          'alice',
          'Autre île',
          JSON.stringify(avatar),
        ]),
      /unique|duplicate/i,
    );
  });
  it('refuse une deuxième création', async () => {
    await rejected(
      () =>
        q('select public.create_village($1,$2,$3::jsonb)', [
          'Autre',
          'Autre île',
          JSON.stringify(avatar),
        ]),
      /déjà créé/,
    );
  });
});
describe('Transactions économiques exécutées dans PostgreSQL', () => {
  it('coupe un arbre une seule fois pendant sa repousse', async () => {
    const id = await treeId();
    await action('chop', { id });
    expect(await inventory('wood')).toBe(5);
    await cooldown();
    await rejected(() => action('chop', { id }), /repousse/);
    expect(await inventory('wood')).toBe(5);
  });
  it('autorise une nouvelle coupe après 30 minutes', async () => {
    const id = await treeId();
    await action('chop', { id });
    await admin(
      "update public.trees set cut_at=clock_timestamp()-interval '30 minutes' where id=$1",
      [id],
    );
    await cooldown();
    await action('chop', { id });
    expect(await inventory('wood')).toBe(10);
  });
  it('vend le bois et crédite le prix réel du serveur', async () => {
    await action('chop', { id: await treeId() });
    await cooldown();
    await action('sell', { item: 'wood', quantity: 5, price: 9999 });
    expect(await gold()).toBe(120);
    expect(await inventory('wood')).toBe(0);
  });
  it('une même vente rejouée ne double pas le paiement', async () => {
    await action('chop', { id: await treeId() });
    await cooldown();
    const request = crypto.randomUUID();
    await action('sell', { item: 'wood', quantity: 5 }, request);
    const result = (await action('sell', { item: 'wood', quantity: 5 }, request)) as any;
    expect(result.replayed).toBe(true);
    expect(await gold()).toBe(120);
    expect(await inventory('wood')).toBe(0);
  });
  it('refuse de changer la charge utile d’une requête déjà exécutée', async () => {
    const request = crypto.randomUUID();
    await action('chop', { id: await treeId() }, request);
    await rejected(() => action('sell', { item: 'wood', quantity: 1 }, request), /réutilisé/);
  });
  it('refuse les stocks insuffisants et quantités négatives', async () => {
    await rejected(() => action('sell', { item: 'wood', quantity: 1 }), /Stock insuffisant/);
    await rejected(() => action('sell', { item: 'wood', quantity: -1 }), /Quantité invalide/);
    expect(await gold()).toBe(100);
  });
  it('un achat au-delà du solde annule aussi le bâtiment et le score', async () => {
    await rejected(() => action('build', { kind: 'cottage', x: 15, y: 15 }), /Fonds insuffisants/);
    const w = (await scalar('select public.load_world()')) as any;
    expect(w.island.gold).toBe(100);
    expect(w.island.score).toBe(0);
    expect(w.buildings).toHaveLength(0);
  });
  it('interdit le chevauchement et déplace gratuitement son bâtiment', async () => {
    await action('build', { kind: 'fountain', x: 15, y: 15 });
    expect(await gold()).toBe(0);
    await cooldown();
    await rejected(
      () => action('build', { kind: 'road', x: 15, y: 15 }),
      /Emplacement indisponible/,
    );
    const w = (await scalar('select public.load_world()')) as any;
    await action('move', { id: w.buildings[0].id, x: 16, y: 15 });
    expect(await gold()).toBe(0);
    expect(((await scalar('select public.load_world()')) as any).buildings[0].x).toBe(16);
  });
  it('refuse l’eau, les arbres, les parcelles et les débordements', async () => {
    for (const [x, y] of [
      [0, 0],
      [6, 10],
      [12, 12],
      [29, 29],
    ])
      await rejected(() => action('build', { kind: 'road', x, y }), /Emplacement indisponible/);
  });
  it('limite les rafales d’actions côté serveur', async () => {
    await action('chop', { id: await treeId() });
    await rejected(() => action('tutorial', { step: 1 }), /trop rapide/);
  });
});
describe('Agriculture persistée', () => {
  it('débite la graine et interdit une récolte avant 8 heures', async () => {
    const id = await plotId();
    await action('plant', { id, crop: 'carrot' });
    expect(await gold()).toBe(95);
    await cooldown();
    await rejected(() => action('harvest', { id }), /croissance/);
    expect(await inventory('carrot')).toBe(0);
  });
  it('récolte deux unités après 8 heures puis libère la parcelle', async () => {
    const id = await plotId();
    await action('plant', { id, crop: 'carrot' });
    await admin(
      "update public.plantations set planted_at=clock_timestamp()-interval '8 hours' where plot_id=$1",
      [id],
    );
    await cooldown();
    await action('harvest', { id });
    expect(await inventory('carrot')).toBe(2);
    const w = (await scalar('select public.load_world()')) as any;
    expect(w.plantations).toHaveLength(0);
    await cooldown();
    await rejected(() => action('harvest', { id }), /vide/);
  });
  it('ne rapporte rien après 12 heures et peut être retirée gratuitement', async () => {
    const id = await plotId();
    await action('plant', { id, crop: 'strawberry' });
    await admin(
      "update public.plantations set planted_at=clock_timestamp()-interval '12 hours' where plot_id=$1",
      [id],
    );
    await cooldown();
    await rejected(() => action('harvest', { id }), /fanée/);
    expect(await inventory('strawberry')).toBe(0);
    await action('clear', { id });
    expect(await gold()).toBe(65);
    expect(((await scalar('select public.load_world()')) as any).plantations).toHaveLength(0);
  });
  it('refuse de retirer une culture saine ou de replanter une parcelle occupée', async () => {
    const id = await plotId();
    await action('plant', { id, crop: 'wheat' });
    await cooldown();
    await rejected(() => action('clear', { id }), /non fanée/);
    await rejected(() => action('plant', { id, crop: 'tomato' }), /occupée/);
  });
});
describe('Autorisations et confidentialité', () => {
  it('un visiteur voit les constructions mais pas le solde ou l’inventaire', async () => {
    await action('build', { kind: 'fountain', x: 15, y: 15 });
    await asUser(B);
    const w = (await scalar('select public.load_world($1)', [A])) as any;
    expect(w.island.gold).toBe(0);
    expect(w.inventory).toEqual({});
    expect(w.buildings).toHaveLength(1);
    expect(w.profile.is_admin).toBe(false);
  });
  it('un joueur ne peut couper ou cultiver sur une autre île', async () => {
    const id = await treeId(),
      plot = await plotId();
    await asUser(B);
    await rejected(() => action('chop', { id }), /votre île/);
    await rejected(() => action('plant', { id: plot, crop: 'carrot' }), /votre île/);
  });
  it('un joueur ne peut déplacer le bâtiment d’autrui', async () => {
    await action('build', { kind: 'fountain', x: 15, y: 15 });
    const w = (await scalar('select public.load_world()')) as any;
    await asUser(B);
    await rejected(() => action('move', { id: w.buildings[0].id, x: 16, y: 15 }), /votre île/);
  });
  it('interdit les écritures directes de solde et l’élévation administrateur', async () => {
    await rejected(() => q('update public.islands set gold=999999'), /permission denied/i);
    await rejected(() => q('update public.profiles set is_admin=true'), /permission denied/i);
  });
  it('RLS ne retourne que son inventaire', async () => {
    const rows = await q('select distinct user_id from public.inventories');
    expect(rows).toEqual([{ user_id: A }]);
  });
  it('le classement ne divulgue aucun email ni champ privé', async () => {
    const rows = await q('select * from public.community()');
    expect(rows).toHaveLength(2);
    expect(Object.keys(rows[0]).sort()).toEqual(
      ['id', 'username', 'island_name', 'island_id', 'score', 'building_count'].sort(),
    );
  });
  it('un utilisateur anonyme ne peut appeler les fonctions de jeu', async () => {
    await db.exec('reset role;set role anon');
    await rejected(() => q('select public.load_world()'), /permission denied/i);
  });
});
describe('Chat persistant et modération', () => {
  it('enregistre le texte brut, limite à 500 caractères et freine le spam', async () => {
    const request = crypto.randomUUID();
    await q('select public.send_message($1,$2)', ['<script>alert(1)</script>', request]);
    await q('select public.send_message($1,$2)', ['<script>alert(1)</script>', request]);
    const rows = await q('select * from public.chat_messages');
    expect(rows).toHaveLength(1);
    expect(rows[0].content).toBe('<script>alert(1)</script>');
    await rejected(
      () => q('select public.send_message($1,$2)', ['spam', crypto.randomUUID()]),
      /2 secondes/,
    );
    await admin('update public.profiles set last_chat_at=null');
    await rejected(
      () => q('select public.send_message($1,$2)', ['x'.repeat(501), crypto.randomUUID()]),
      /500/,
    );
  });
  it('permet de signaler, interdit de supprimer autrui et autorise le propriétaire', async () => {
    await q('select public.send_message($1,$2)', ['Bonjour !', crypto.randomUUID()]);
    const id = await scalar('select id from public.chat_messages');
    await asUser(B);
    await q('select public.report_message($1)', [id]);
    await q('select public.report_message($1)', [id]);
    await rejected(() => q('select public.delete_message($1)', [id]), /non autorisée/);
    await asUser(A);
    await q('select public.delete_message($1)', [id]);
    expect(await q('select * from public.chat_messages')).toHaveLength(0);
  });
  it('autorise la suppression par un administrateur', async () => {
    await q('select public.send_message($1,$2)', ['À modérer', crypto.randomUUID()]);
    const id = await scalar('select id from public.chat_messages');
    await admin('update public.profiles set is_admin=true where id=$1', [B]);
    await asUser(B);
    await q('select public.delete_message($1)', [id]);
    expect(await q('select * from public.chat_messages')).toHaveLength(0);
  });
});
