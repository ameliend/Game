import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, beforeEach, afterEach, it, expect } from 'vitest';
import { BUILDINGS } from '../src/config/game';
const db = new PGlite(),
  user = '00000000-0000-0000-0000-000000000001';
const sql = (name: string) =>
  readFileSync(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8');
const files = [
  '202611040001_island_village.sql',
  '202611040002_shared_island.sql',
  '202611040003_expand_daily_trees.sql',
  '202611040004_buy_farm_plots.sql',
  '202611040005_final_assignments_road_price.sql',
  '202611050006_commerce_and_elections.sql',
  '202611050007_residents_random_regrowth.sql',
  '202611050008_more_buildings.sql',
  '202611050009_recovery_management.sql',
];
beforeAll(async () => {
  await db.exec(
    "create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;",
  );
  await db.exec(sql(files[0]));
  await db.query('insert into auth.users values($1)', [user]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.query('select public.create_village($1,$2,$3::jsonb)', [
    'Camille',
    'Test',
    JSON.stringify({ skin: '#dba77c', hair: '#754d32', shirt: '#eaa66d', pants: '#486f70' }),
  ]);
  for (const f of files.slice(1)) await db.exec(sql(f));
}, 60000);
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.exec('reset role;begin');
  await db.query('update public.profiles set gold=10000 where id=$1', [user]);
  await db.exec('set role authenticated');
});
afterEach(async () => {
  await db.exec('rollback;reset role');
});
const world = async () => (await db.query<any>('select public.load_world() as w')).rows[0].w;
async function buy(kind: string) {
  await db.exec('reset role');
  const size = BUILDINGS[kind as keyof typeof BUILDINGS].size;
  const cell = (
    await db.query<any>(
      'select x,y from generate_series(0,59)x cross join generate_series(0,59)y where public.check_placement((select island_id from public.shared_world),x,y,$1) limit 1',
      [size],
    )
  ).rows[0];
  await db.query('update public.profiles set last_action_at=null where id=$1', [user]);
  await db.exec('set role authenticated');
  await db.query('select public.game_action($1,$2::jsonb,$3::uuid)', [
    'build',
    JSON.stringify({ kind, ...cell }),
    crypto.randomUUID(),
  ]);
  return world();
}
it('la migration ajoute les deux boutiques et les montants attendus', async () => {
  await db.exec('reset role');
  const cfg = (await db.query<any>("select value from public.game_rules where key='buildings'"))
    .rows[0].value;
  for (const k of ['coffeeshop', 'sexshop'] as const) {
    expect(cfg[k]).toEqual({ price: BUILDINGS[k].price, points: 20, size: 2, commerce: true });
  }
});
it('la lecture de la carte reste disponible si la maintenance dépasse son timeout', async () => {
  await db.exec(
    "reset role; create or replace function public.ensure_daily_trees() returns integer language plpgsql security definer set search_path='' as $$begin raise exception using errcode='57014',message='canceling statement due to statement timeout';end$$;set role authenticated;",
  );
  const w = await world();
  expect(w.profile.username).toBe('Camille');
  expect(w.trees.length).toBeGreaterThan(0);
});
it('le rattrapage traite un jour à la fois au lieu de bloquer sur un mois', async () => {
  await db.exec(
    "reset role;delete from public.tree_spawn_days;update public.shared_world set last_tree_spawn_day=(clock_timestamp() at time zone 'Europe/Paris')::date-30 where singleton=true;set role authenticated;",
  );
  const before = await world();
  await db.query('select public.refresh_world()');
  const after = await world();
  expect(after.trees).toHaveLength(before.trees.length + 10);
  await db.exec('reset role');
  expect((await db.query('select * from public.tree_spawn_days')).rows).toHaveLength(1);
});
for (const k of ['coffeeshop', 'sexshop'] as const)
  it(`achète un ${k} avec le prix serveur`, async () => {
    const w = await buy(k);
    expect(w.island.gold).toBe(10000 - BUILDINGS[k].price);
    expect(w.buildings.some((b: any) => b.kind === k)).toBe(true);
  });
it('construit plusieurs carrés de route consécutifs à une pièce chacun', async () => {
  await buy('road');
  await buy('road');
  const w = await buy('road');
  expect(w.island.gold).toBe(9997);
  expect(w.buildings.filter((b: any) => b.kind === 'road')).toHaveLength(3);
});

it('répartit la repousse en lots bornés', async () => {
  await db.exec(
    "reset role;update public.trees set cut_at=clock_timestamp()-interval '31 minutes' where id in(select id from public.trees where cut_at is null order by id limit 20);set role authenticated;",
  );
  const before = await world();
  await db.query('select public.refresh_world()');
  expect((await world()).trees).toHaveLength(before.trees.length + 5);
});
