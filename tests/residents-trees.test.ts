import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, it } from 'vitest';
import { BUILDINGS, CROPS, RULES, FARM_PLOT, CIVIC_RULES } from '../src/config/game';
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
  await db.exec('reset role');
  // Existing private islands overlap. Migration must keep both sets of resources.
  await db.exec(
    readFileSync(
      new URL('../supabase/migrations/202611040002_shared_island.sql', import.meta.url),
      'utf8',
    ),
  );
  await db.exec(
    readFileSync(
      new URL('../supabase/migrations/202611040003_expand_daily_trees.sql', import.meta.url),
      'utf8',
    ),
  );
  await db.exec(
    readFileSync(
      new URL('../supabase/migrations/202611040004_buy_farm_plots.sql', import.meta.url),
      'utf8',
    ),
  );
  await q('insert into auth.users values($1)', ['00000000-0000-0000-0000-000000000003']);
  await asUser('00000000-0000-0000-0000-000000000003');
  await q('select public.create_village($1,$2,$3::jsonb)', ['Charlie', '', JSON.stringify(avatar)]);
  await db.exec('reset role');
  for (const file of [
    '202611040005_final_assignments_road_price.sql',
    '202611050006_commerce_and_elections.sql',
    '202611050007_residents_random_regrowth.sql',
  ])
    await db.exec(readFileSync(new URL('../supabase/migrations/' + file, import.meta.url), 'utf8'));
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

async function freeCell() {
  return (
    await admin(
      'select x,y from generate_series(0,59)x cross join generate_series(0,59)y where public.check_placement((select island_id from public.shared_world),x,y,1) and not(x=30 and y=31) limit 1',
    )
  )[0];
}

const heartbeat = async (x: number, y: number) =>
  q('select public.heartbeat_presence($1,$2)', [x, y]);
const residents = async () => (await scalar('select public.online_residents()')) as any[];
const world = async () => (await scalar('select public.load_world()')) as any;
describe('Présence authentifiée des habitants', () => {
  it('retourne les avatars et positions de deux comptes réellement signalés', async () => {
    await heartbeat(30, 31);
    await asUser(B);
    await heartbeat(32, 31);
    const list = await residents();
    expect(list).toHaveLength(2);
    expect(list.find((p) => p.id === A)).toMatchObject({ username: 'Alice', x: 30, y: 31, avatar });
    expect(list.find((p) => p.id === B)).toMatchObject({ username: 'Bob', x: 32, y: 31, avatar });
    expect(new Set(list.map((p) => p.island)).size).toBe(1);
  });
  it('met à jour une position sans dupliquer un compte', async () => {
    await heartbeat(30, 31);
    await admin(
      "update public.player_presence set last_seen_at=clock_timestamp()-interval '1 second' where user_id=$1",
      [A],
    );
    await heartbeat(33, 31);
    expect(await residents()).toHaveLength(1);
    expect((await residents())[0].x).toBe(33);
  });
  it('retire une présence expirée et uniquement soi-même à la déconnexion', async () => {
    await heartbeat(30, 31);
    await asUser(B);
    await heartbeat(32, 31);
    await asUser(A);
    await q('select public.leave_presence()');
    expect((await residents()).map((p) => p.id)).toEqual([B]);
    await admin(
      "update public.player_presence set last_seen_at=clock_timestamp()-interval '90 seconds' where user_id=$1",
      [B],
    );
    expect(await residents()).toEqual([]);
  });
  it('utilise l’avatar sauvegardé plutôt que des couleurs déclarées par un autre client', async () => {
    await heartbeat(30, 31);
    await action('avatar', { ...avatar, shirt: '#abcdef' });
    expect((await residents())[0].avatar.shirt).toBe('#abcdef');
  });
  it('refuse les positions dans l’eau, l’usurpation directe et les accès anonymes', async () => {
    await rejected(() => heartbeat(0, 0), /Position invalide/);
    await rejected(
      () =>
        q(
          'insert into public.player_presence(user_id,island_id,x,y) select $1,island_id,30,31 from public.shared_world',
          [B],
        ),
      /permission denied/,
    );
    await db.exec('reset role;set role anon');
    await rejected(() => q('select public.online_residents()'), /permission denied/);
  });
});
describe('Coupe complète et repousse aléatoire', () => {
  it('fait disparaître l’arbre entier et libère la case pour une parcelle', async () => {
    const before = await world(),
      tree = before.trees[0];
    await action('chop', { id: tree.id });
    expect(await inventory('wood')).toBe(5);
    expect((await world()).trees).toHaveLength(before.trees.length - 1);
    await cooldown();
    await action('add_plot', { x: tree.x, y: tree.y });
    expect((await world()).plots).toContainEqual(expect.objectContaining({ x: tree.x, y: tree.y }));
  });
  it('ne repousse pas avant 30 minutes puis revient sur une autre case libre', async () => {
    const before = await world(),
      tree = before.trees[0];
    await action('chop', { id: tree.id });
    await admin(
      "update public.trees set cut_at=clock_timestamp()-interval '29 minutes' where id=$1",
      [tree.id],
    );
    expect((await world()).trees.some((t: any) => t.id === tree.id)).toBe(false);
    await admin(
      "update public.trees set cut_at=clock_timestamp()-interval '30 minutes' where id=$1",
      [tree.id],
    );
    const after = await world(),
      regrown = after.trees.find((t: any) => t.id === tree.id);
    expect(regrown).toBeTruthy();
    expect(regrown.x !== tree.x || regrown.y !== tree.y).toBe(true);
    expect(regrown.cut_at).toBeNull();
    expect(after.trees).toHaveLength(before.trees.length);
    await cooldown();
    await action('chop', { id: tree.id });
    expect(await inventory('wood')).toBe(10);
  });
  it('ne repousse pas sur un ancien emplacement devenu une route ou sur un avatar connecté', async () => {
    const tree = (await world()).trees[0];
    await action('chop', { id: tree.id });
    await cooldown();
    await action('build', { kind: 'road', x: tree.x, y: tree.y });
    await heartbeat(30, 31);
    await admin(
      "update public.trees set cut_at=clock_timestamp()-interval '30 minutes' where id=$1",
      [tree.id],
    );
    const w = await world(),
      t = w.trees.find((t: any) => t.id === tree.id);
    expect(t.x !== tree.x || t.y !== tree.y).toBe(true);
    expect(t.x === 30 && t.y === 31).toBe(false);
  });
  it('garde l’arbre coupé invisible si aucun autre emplacement n’est libre, sans récompense supplémentaire', async () => {
    const tree = (await world()).trees[0];
    await action('chop', { id: tree.id });
    await admin(
      "insert into public.buildings(island_id,kind,x,y,size,created_by) select w.island_id,'road',x,y,1,$1 from public.shared_world w cross join generate_series(0,59)x cross join generate_series(0,59)y where public.check_placement(w.island_id,x,y,1) and not(x=$2 and y=$3)",
      [A, tree.x, tree.y],
    );
    await admin(
      "update public.trees set cut_at=clock_timestamp()-interval '30 minutes' where id=$1",
      [tree.id],
    );
    expect((await world()).trees.some((t: any) => t.id === tree.id)).toBe(false);
    await cooldown();
    await rejected(() => action('chop', { id: tree.id }), /repousse/);
    expect(await inventory('wood')).toBe(5);
  });
  it('conserve l’ajout quotidien de dix arbres sans double lot', async () => {
    const before = (await world()).trees.length;
    await admin(
      "delete from public.tree_spawn_days where day=(clock_timestamp() at time zone 'Europe/Paris')::date",
    );
    await admin(
      "update public.shared_world set last_tree_spawn_day=(clock_timestamp() at time zone 'Europe/Paris')::date-1 where singleton=true",
    );
    expect((await world()).trees).toHaveLength(before + 10);
    await asUser(B);
    expect((await world()).trees).toHaveLength(before + 10);
  });
});
