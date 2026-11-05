import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, beforeEach, afterEach, expect, it } from 'vitest';
import { BUILDINGS, isCommerce } from '../src/config/game';
const db = new PGlite();
const user = '00000000-0000-0000-0000-000000000001';
const avatar = { skin: '#dba77c', hair: '#754d32', shirt: '#eaa66d', pants: '#486f70' };
const migrations = [
  '202611040001_island_village.sql',
  '202611040002_shared_island.sql',
  '202611040003_expand_daily_trees.sql',
  '202611040004_buy_farm_plots.sql',
  '202611040005_final_assignments_road_price.sql',
  '202611050006_commerce_and_elections.sql',
  '202611050007_residents_random_regrowth.sql',
];
const sql = (name: string) =>
  readFileSync(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8');
beforeAll(async () => {
  await db.exec(
    "create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;",
  );
  await db.exec(sql(migrations[0]));
  await db.query('insert into auth.users values($1)', [user]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.query('select public.create_village($1,$2,$3::jsonb)', [
    'Camille',
    'Mon île',
    JSON.stringify(avatar),
  ]);
  for (const name of migrations.slice(1)) await db.exec(sql(name));
  await db.exec(`insert into public.buildings(island_id,kind,x,y,size,created_by)
    select w.island_id,'cottage',x,y,2,'${user}' from public.shared_world w cross join generate_series(0,59)x cross join generate_series(0,59)y where public.check_placement(w.island_id,x,y,2) limit 1`);
  await db.exec('create temp table before_catalogue as select * from public.buildings');
  await db.exec(sql('202611050008_more_buildings.sql'));
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
async function world() {
  return (await db.query<any>('select public.load_world() as world')).rows[0].world;
}
async function purchase(kind: keyof typeof BUILDINGS) {
  await db.exec('reset role');
  const cell = (
    await db.query<any>(
      'select x,y from generate_series(0,59)x cross join generate_series(0,59)y where public.check_placement((select island_id from public.shared_world),x,y,$1) limit 1',
      [BUILDINGS[kind].size],
    )
  ).rows[0];
  await db.exec('set role authenticated');
  await db.query('select public.game_action($1,$2::jsonb,$3::uuid)', [
    'build',
    JSON.stringify({ kind, ...cell }),
    crypto.randomUUID(),
  ]);
  return await world();
}
it('synchronise le catalogue serveur et frontend avec les quatre ajouts', async () => {
  await db.exec('reset role');
  const rules = (await db.query<any>("select value from public.game_rules where key='buildings'"))
    .rows[0].value;
  expect(Object.keys(rules)).toHaveLength(19);
  for (const key of Object.keys(rules)) {
    const v = BUILDINGS[key as keyof typeof BUILDINGS];
    expect(rules[key]).toEqual({
      price: v.price,
      points: v.points,
      size: v.size,
      commerce: isCommerce(key as keyof typeof BUILDINGS),
    });
  }
});
for (const kind of ['roy_merlin', 'chocolatier', 'farm', 'hotel'] as const) {
  it(`achète et place ${kind} avec son prix et son empreinte`, async () => {
    const before = await world(),
      after = await purchase(kind),
      b = after.buildings.find((b: any) => b.kind === kind),
      cfg = BUILDINGS[kind];
    expect(b).toMatchObject({ kind, created_by: user, size: cfg.size });
    expect(after.island.gold).toBe(10000 - cfg.price);
    expect(after.island.score - before.island.score).toBe(cfg.points);
    expect(after.buildings).toHaveLength(before.buildings.length + 1);
    if (kind === 'farm') {
      expect(after.plots).toEqual(before.plots);
      expect(isCommerce(kind)).toBe(false);
    } else expect(isCommerce(kind)).toBe(true);
  });
}
it('ne retire aucune construction existante et conserve le prix de la mairie', async () => {
  await db.exec('reset role');
  const before = (await db.query('select * from before_catalogue')).rows;
  const after = (await db.query('select * from public.buildings')).rows;
  expect(after).toEqual(before);
  expect(BUILDINGS.townhall.price).toBe(1000);
  expect(BUILDINGS.townhall.size).toBe(3);
});
