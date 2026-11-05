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
  for (const [id, name] of [
    ['00000000-0000-0000-0000-000000000002', 'Bob'],
    ['00000000-0000-0000-0000-000000000003', 'Charlie'],
  ]) {
    await db.query('insert into auth.users values($1)', [id]);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    await db.query('select public.create_village($1,$2,$3::jsonb)', [
      name,
      '',
      JSON.stringify({ skin: '#dba77c', hair: '#754d32', shirt: '#eaa66d', pants: '#486f70' }),
    ]);
  }
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
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

const bob = '00000000-0000-0000-0000-000000000002',
  charlie = '00000000-0000-0000-0000-000000000003';
async function as(id: string) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.query('update public.profiles set last_action_at=null where id=$1', [id]);
  await db.exec('set role authenticated');
}
async function act(type: string, payload: unknown) {
  await db.query('select public.game_action($1,$2::jsonb,$3::uuid)', [
    type,
    JSON.stringify(payload),
    crypto.randomUUID(),
  ]);
}
async function finish() {
  await db.exec(
    'reset role;update public.elections set closes_at=clock_timestamp() where finalized_at is null;set role authenticated;',
  );
  await db.query('select public.refresh_world()');
}
async function chooseMayor() {
  await buy('townhall');
  const e = (await world()).governance.election;
  await as(bob);
  await act('vote', { candidate_id: user, election_id: e.id, round: 1 });
  await as(charlie);
  await act('vote', { candidate_id: user, election_id: e.id, round: 1 });
  await finish();
  await as(user);
}
it('le mandat commence après le résultat et dure sept jours', async () => {
  await chooseMayor();
  const g = (await world()).governance;
  expect(g.mayor_id).toBe(user);
  expect(Date.parse(g.term_ends_at) - Date.parse(g.election.closes_at)).toBe(7 * 86400000);
});
it('une égalité donne un nouveau tour d’une heure', async () => {
  await buy('townhall');
  const e = (await world()).governance.election;
  await as(user);
  await act('vote', { candidate_id: bob, election_id: e.id, round: 1 });
  await as(bob);
  await act('vote', { candidate_id: user, election_id: e.id, round: 1 });
  await finish();
  const next = (await world()).governance.election;
  expect(next.round).toBe(2);
  expect(next.finalized_at).toBeNull();
  expect(Date.parse(next.closes_at) - Date.parse(next.round_started_at)).toBe(3600000);
});
it('le maire peut démolir une maison sans remboursement', async () => {
  await chooseMayor();
  const before = await buy('cottage'),
    b = before.buildings.find((b: any) => b.kind === 'cottage');
  await as(user);
  await act('demolish', { id: b.id });
  const after = await world();
  expect(after.buildings.some((x: any) => x.id === b.id)).toBe(false);
  expect(after.island.gold).toBe(before.island.gold);
  expect(after.island.score).toBe(before.island.score - 10);
});
it('un vote oui conduit à un îlot temporaire vide puis au retour', async () => {
  await chooseMayor();
  await act('propose_exile', { user_id: bob });
  const p = (await world()).governance.exile_proposal;
  await as(user);
  await act('vote_exile', { proposal_id: p.id, round: 1, yes: true });
  await as(charlie);
  await act('vote_exile', { proposal_id: p.id, round: 1, yes: true });
  await db.exec(
    "reset role;update public.exile_proposals set closes_at=clock_timestamp() where status='open';set role authenticated;",
  );
  await db.query('select public.refresh_world()');
  await as(bob);
  const isolated = await world();
  expect(isolated.exile).toBeTruthy();
  expect(isolated.trees).toEqual([]);
  expect(isolated.plots).toEqual([]);
  expect(isolated.buildings).toEqual([]);
  expect(isolated.island.name).toBe('Îlot d’exil');
  await db.exec('reset role');
  await db.query(
    "update public.banishments set ends_at=clock_timestamp()-interval '1 second' where user_id=$1",
    [bob],
  );
  await db.exec('set role authenticated');
  expect((await world()).exile).toBeUndefined();
});
