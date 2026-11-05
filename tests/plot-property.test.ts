import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { BUILDINGS } from '../src/config/game';
const db = new PGlite();
const alice = '00000000-0000-0000-0000-000000000001',
  bob = '00000000-0000-0000-0000-000000000002',
  mayor = '00000000-0000-0000-0000-000000000003';
const dir = new URL('../supabase/migrations/', import.meta.url);
const filename = '202611050011_plot_property_mayor_moves.sql';
const latest = readFileSync(new URL(filename, dir), 'utf8');
const avatar = { skin: '#dba77c', hair: '#754d32', shirt: '#eaa66d', pants: '#486f70' };
let house: string;
async function register(id: string, name: string) {
  await db.query('insert into auth.users values($1)', [id]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.query('select public.create_village($1,$2,$3::jsonb)', [
    name,
    'Test',
    JSON.stringify(avatar),
  ]);
}
async function as(id: string) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.query('update public.profiles set last_action_at=null where id=$1', [id]);
  await db.exec('set role authenticated');
}
const world = async () => (await db.query<any>('select public.load_world() as w')).rows[0].w;
const act = (type: string, payload: unknown) =>
  db.query('select public.game_action($1,$2::jsonb,$3::uuid)', [
    type,
    JSON.stringify(payload),
    crypto.randomUUID(),
  ]);
async function plot(x: number, y: number) {
  await db.exec('reset role');
  const id = (
    await db.query<any>(
      'insert into public.farm_plots(island_id,x,y) select island_id,$1,$2 from public.shared_world returning id',
      [x, y],
    )
  ).rows[0].id;
  await db.query(
    "insert into public.plantations values($1,'carrot',clock_timestamp()-interval '9 hours')",
    [id],
  );
  await db.exec('set role authenticated');
  return id;
}
beforeAll(async () => {
  await db.exec(
    "create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;",
  );
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql') && f <= filename)
    .sort();
  await db.exec(readFileSync(new URL(files[0], dir), 'utf8'));
  await register(alice, 'Alice');
  for (const file of files.slice(1)) await db.exec(readFileSync(new URL(file, dir), 'utf8'));
  await register(bob, 'Bob');
  await register(mayor, 'Maire');
}, 60000);
afterAll(async () => db.close());
beforeEach(async () => {
  await db.exec(
    'reset role;begin;delete from public.plantations;delete from public.farm_plots;delete from public.buildings;delete from public.trees;',
  );
  await db.query('update public.shared_world set mayor_id=$1 where singleton=true', [mayor]);
  house = (
    await db.query<any>(
      "insert into public.buildings(island_id,kind,x,y,size,created_by,assigned_to,assigned_at) select island_id,'cottage',20,20,2,$1,$2,'2026-01-01'::timestamptz from public.shared_world returning id",
      [bob, alice],
    )
  ).rows[0].id;
  await as(alice);
});
afterEach(async () => db.exec('rollback;reset role'));
it('calcule le rayon depuis le bord de la maison, inclus jusqu’à dix cases', async () => {
  const edge = await plot(31, 20),
    outside = await plot(32, 20),
    diagonal = await plot(27, 29),
    beyondDiagonal = await plot(28, 29);
  const w = await world();
  expect(w.plots.find((p: any) => p.id === edge)).toMatchObject({
    owner_id: alice,
    owner_name: 'Alice',
    house_id: house,
  });
  expect(w.plots.find((p: any) => p.id === diagonal).owner_id).toBe(alice);
  for (const id of [outside, beyondDiagonal])
    expect(w.plots.find((p: any) => p.id === id).owner_id).toBeNull();
});
it('privilégie la maison attribuée la plus proche, puis l’attribution la plus ancienne en cas d’égalité', async () => {
  await db.exec('reset role');
  await db.query(
    "insert into public.buildings(island_id,kind,x,y,size,created_by,assigned_to,assigned_at) select island_id,'cottage',29,20,2,$1,$1,'2026-02-01'::timestamptz from public.shared_world",
    [bob],
  );
  await db.exec('set role authenticated');
  const closer = await plot(27, 20),
    tie = await plot(25, 20);
  const w = await world();
  expect(w.plots.find((p: any) => p.id === closer).owner_id).toBe(bob);
  expect(w.plots.find((p: any) => p.id === tie).owner_id).toBe(alice);
});
it('réserve la récolte au propriétaire déclaré, qui peut être différent du constructeur', async () => {
  const id = await plot(31, 20);
  await act('harvest', { id });
  const w = await world();
  expect(w.inventory.carrot).toBe(2);
  expect(w.plantations.some((p: any) => p.plot_id === id)).toBe(false);
});
it.each([
  [bob, 'constructeur'],
  [mayor, 'maire'],
])('refuse la récolte à un autre habitant (%s, %s) sans perdre les cultures', async (user) => {
  const id = await plot(31, 20);
  await as(user);
  await db.exec('savepoint harvest');
  await expect(act('harvest', { id })).rejects.toThrow('Récolte réservée à Alice');
  await db.exec('rollback to savepoint harvest');
  const w = await world();
  expect(w.inventory.carrot).toBe(0);
  expect(w.plantations.some((p: any) => p.plot_id === id)).toBe(true);
});
it('laisse les récoltes communes accessibles à tous, même près d’une maison non attribuée', async () => {
  await db.exec('reset role');
  await db.query(
    "insert into public.buildings(island_id,kind,x,y,size,created_by) select island_id,'house',34,23,3,$1 from public.shared_world",
    [bob],
  );
  await db.exec('set role authenticated');
  const id = await plot(34, 22);
  await as(bob);
  expect((await world()).plots.find((p: any) => p.id === id).owner_id).toBeNull();
  await act('harvest', { id });
  expect((await world()).inventory.carrot).toBe(2);
});
it('recalcule les droits après un déplacement du maire sans modifier l’attribution ni les cultures', async () => {
  const old = await plot(31, 20),
    fresh = await plot(35, 40);
  await as(mayor);
  await act('move', { id: house, x: 40, y: 40 });
  const w = await world();
  expect(w.plots.find((p: any) => p.id === old).owner_id).toBeNull();
  expect(w.plots.find((p: any) => p.id === fresh).owner_id).toBe(alice);
  expect(w.plantations).toHaveLength(2);
  expect(w.buildings.find((b: any) => b.id === house)).toMatchObject({
    created_by: bob,
    assigned_to: alice,
    x: 40,
    y: 40,
  });
});
it.each(['house', 'gym', 'farm', 'townhall', 'road'] as const)(
  'permet au maire de déplacer gratuitement un bâtiment %s construit par un autre habitant',
  async (kind) => {
    await db.exec('reset role');
    const b = (
      await db.query<any>(
        'insert into public.buildings(island_id,kind,x,y,size,created_by) select island_id,$1,10,24,$2,$3 from public.shared_world returning *',
        [kind, BUILDINGS[kind].size, bob],
      )
    ).rows[0];
    await as(mayor);
    const before = await world();
    await act('move', { id: b.id, x: 40, y: 30 });
    const after = await world();
    expect(after.island.gold).toBe(before.island.gold);
    expect(after.island.score).toBe(before.island.score);
    expect(after.buildings.find((x: any) => x.id === b.id)).toMatchObject({
      x: 40,
      y: 30,
      created_by: bob,
    });
  },
);
it('conserve les autres règles de déplacement pour les habitants ordinaires', async () => {
  await db.exec('savepoint move');
  await expect(act('move', { id: house, x: 40, y: 40 })).rejects.toThrow(
    'Seul le constructeur, le maire',
  );
  await db.exec('rollback to savepoint move');
  await as(bob);
  await act('move', { id: house, x: 40, y: 40 });
  expect((await world()).buildings.find((b: any) => b.id === house).x).toBe(40);
});
it('actualise les droits lorsqu’une maison est attribuée ou démolie', async () => {
  await db.exec('reset role');
  await db.query('update public.buildings set assigned_to=null,assigned_at=null where id=$1', [
    house,
  ]);
  await as(bob);
  const id = await plot(31, 20);
  expect((await world()).plots.find((p: any) => p.id === id).owner_id).toBeNull();
  await act('assign', { id: house, user_id: alice });
  expect((await world()).plots.find((p: any) => p.id === id).owner_id).toBe(alice);
  await as(mayor);
  await act('demolish', { id: house });
  expect((await world()).plots.find((p: any) => p.id === id).owner_id).toBeNull();
});
it('recule les bannis déjà présents de trois cases sans modifier la durée de leur exil', async () => {
  await db.exec('reset role');
  await db.query(
    "insert into public.banishments(user_id,starts_at,ends_at) values($1,clock_timestamp(),clock_timestamp()+interval '24 hours')",
    [bob],
  );
  await db.query(
    'insert into public.player_presence(user_id,island_id,x,y) select $1,island_id,59,31 from public.shared_world',
    [bob],
  );
  const before = (
    await db.query<any>('select ends_at from public.banishments where user_id=$1', [bob])
  ).rows[0].ends_at;
  await db.exec(latest.replace(/^begin;$/m, '').replace(/^commit;$/m, ''));
  expect(
    (await db.query<any>('select x,y from public.player_presence where user_id=$1', [bob])).rows[0],
  ).toEqual({ x: 62, y: 31 });
  expect(
    (await db.query<any>('select ends_at from public.banishments where user_id=$1', [bob])).rows[0]
      .ends_at,
  ).toEqual(before);
  await as(bob);
  const presence = (await db.query<any>('select public.online_residents() as r')).rows[0].r;
  expect(presence.find((p: any) => p.id === bob)).toMatchObject({ x: 62, y: 31 });
  await db.exec('reset role');
  await db.query(
    "update public.player_presence set last_seen_at=clock_timestamp()-interval '1 second' where user_id=$1",
    [bob],
  );
  await db.exec('set role authenticated');
  await db.query('select public.heartbeat_presence(61,30)');
  expect(
    (await db.query<any>('select public.online_residents() as r')).rows[0].r.find(
      (p: any) => p.id === bob,
    ),
  ).toMatchObject({ x: 61, y: 30 });
});
