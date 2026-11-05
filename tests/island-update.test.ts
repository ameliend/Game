import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { BUILDINGS } from '../src/config/game';
const db = new PGlite();
const cam = '00000000-0000-0000-0000-000000000001';
const bob = '00000000-0000-0000-0000-000000000002';
const charlie = '00000000-0000-0000-0000-000000000003';
const dana = '00000000-0000-0000-0000-000000000004';
const dir = new URL('../supabase/migrations/', import.meta.url);
const latest = readFileSync(new URL('202611050010_exile_election_gym.sql', dir), 'utf8');
const avatar = { skin: '#dba77c', hair: '#754d32', shirt: '#eaa66d', pants: '#486f70' };
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
const act = (action: string, payload: unknown) =>
  db.query('select public.game_action($1,$2::jsonb,$3::uuid)', [
    action,
    JSON.stringify(payload),
    crypto.randomUUID(),
  ]);
async function buy(kind: keyof typeof BUILDINGS) {
  await as(cam);
  await db.exec('reset role');
  await db.query('update public.profiles set gold=10000 where id=$1', [cam]);
  const cell = (
    await db.query<any>(
      'select x,y from generate_series(0,59)x cross join generate_series(0,59)y where public.check_placement((select island_id from public.shared_world),x,y,$1) limit 1',
      [BUILDINGS[kind].size],
    )
  ).rows[0];
  await db.exec('set role authenticated');
  await act('build', { kind, ...cell });
  return world();
}
beforeAll(async () => {
  await db.exec(
    "create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;",
  );
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql') && f <= '202611050010_exile_election_gym.sql')
    .sort();
  await db.exec(readFileSync(new URL(files[0], dir), 'utf8'));
  await register(cam, 'Cam');
  for (const f of files.slice(1, -1)) await db.exec(readFileSync(new URL(f, dir), 'utf8'));
  await register(bob, 'Bob');
  await register(charlie, 'Charlie');
  await db.exec(latest);
}, 60000);
afterAll(async () => db.close());
beforeEach(async () => {
  await db.exec('reset role;begin');
  await as(cam);
});
afterEach(async () => {
  await db.exec('rollback;reset role');
});
it('ajoute 500 pièces à Cam, une seule fois, sans toucher aux autres soldes', async () => {
  expect((await world()).island.gold).toBe(600);
  await as(bob);
  expect((await world()).island.gold).toBe(100);
  // Reapplying the data gift is harmless, even if the SQL is run twice.
  await db.exec('reset role;commit');
  await db.exec(latest);
  await db.exec('begin');
  await as(cam);
  expect((await world()).island.gold).toBe(600);
  const gift = (
    await db.query<any>(
      "select gold_delta from public.economy_transactions where user_id=$1 and action='gift'",
      [cam],
    )
  ).rows;
  expect(gift).toEqual([{ gold_delta: 500 }]);
});
it('termine le scrutin dès le dernier vote et attribue un mandat de sept jours', async () => {
  const e = (await buy('townhall')).governance.election;
  expect(e.elector_count).toBe(3);
  await as(cam);
  await act('vote', { election_id: e.id, candidate_id: bob, round: 1 });
  await as(bob);
  await act('vote', { election_id: e.id, candidate_id: cam, round: 1 });
  const open = (await world()).governance.election;
  expect(open.finalized_at).toBeNull();
  expect(open.voted_count).toBe(2);
  await as(charlie);
  await act('vote', { election_id: e.id, candidate_id: cam, round: 1 });
  const g = (await world()).governance;
  expect(g.mayor_id).toBe(cam);
  expect(g.election.finalized_at).not.toBeNull();
  expect(Date.parse(g.election.closes_at)).toBeLessThan(Date.parse(e.closes_at) - 23 * 3600000);
  expect(Date.parse(g.term_ends_at) - Date.parse(g.election.closes_at)).toBe(7 * 86400000);
});
it('ouvre un tour d’une heure si tous les habitants ont voté à égalité, puis le clôture aussi au dernier vote', async () => {
  await db.exec('reset role');
  await register(dana, 'Dana');
  const e = (await buy('townhall')).governance.election;
  for (const [voter, candidate] of [
    [cam, bob],
    [bob, cam],
    [charlie, cam],
    [dana, bob],
  ]) {
    await as(voter);
    await act('vote', { election_id: e.id, candidate_id: candidate, round: 1 });
  }
  const runoff = (await world()).governance.election;
  expect(runoff.round).toBe(2);
  expect(runoff.finalized_at).toBeNull();
  expect(runoff.voted_count).toBe(0);
  expect(Date.parse(runoff.closes_at) - Date.parse(runoff.round_started_at)).toBe(3600000);
  for (const [voter, candidate] of [
    [cam, bob],
    [bob, cam],
    [charlie, cam],
    [dana, cam],
  ]) {
    await as(voter);
    await act('vote', { election_id: e.id, candidate_id: candidate, round: 2 });
  }
  expect((await world()).governance.mayor_id).toBe(cam);
});
it('achète la salle de sport et lui applique le revenu des commerces', async () => {
  const w = await buy('gym');
  const gym = w.buildings.find((b: any) => b.kind === 'gym');
  expect(gym.size).toBe(3);
  expect(w.island.gold).toBe(9400);
  await db.exec('reset role');
  await db.query(
    "update public.buildings set built_at=clock_timestamp()-interval '24 hours 1 minute' where id=$1",
    [gym.id],
  );
  await as(cam);
  await act('claim_income', { id: gym.id });
  expect((await world()).island.gold).toBe(9420);
});
it('affiche les bannis sur le petit îlot tout en conservant la vue de l’île principale', async () => {
  await as(bob);
  await db.query('select public.heartbeat_presence(30,31)');
  await db.exec('reset role');
  await db.query(
    "insert into public.banishments(user_id,starts_at,ends_at) values($1,clock_timestamp(),clock_timestamp()+interval '24 hours')",
    [bob],
  );
  await as(cam);
  const main = await world();
  let residents = (await db.query<any>('select public.online_residents() as r')).rows[0].r;
  expect(residents.find((r: any) => r.id === bob)).toMatchObject({ x: 58, y: 30 });
  await as(bob);
  const w = await world();
  expect(w.exile).toBeTruthy();
  expect(w.island.id).toBe(main.island.id);
  expect(w.trees.length).toBeGreaterThan(0);
  await db.exec('reset role');
  await db.query(
    "update public.player_presence set last_seen_at=clock_timestamp()-interval '1 second' where user_id=$1",
    [bob],
  );
  await db.exec('set role authenticated');
  await db.query('select public.heartbeat_presence(59,31)');
  residents = (await db.query<any>('select public.online_residents() as r')).rows[0].r;
  expect(residents.find((r: any) => r.id === bob)).toMatchObject({ x: 59, y: 31 });
  await db.exec('reset role');
  await db.query(
    "update public.banishments set ends_at=clock_timestamp()-interval '1 second' where user_id=$1",
    [bob],
  );
  await db.query(
    "update public.player_presence set last_seen_at=clock_timestamp()-interval '1 second' where user_id=$1",
    [bob],
  );
  await db.exec('set role authenticated');
  await db.query('select public.heartbeat_presence(59,31)');
  expect((await world()).exile).toBeUndefined();
  residents = (await db.query<any>('select public.online_residents() as r')).rows[0].r;
  expect(residents.find((r: any) => r.id === bob)).toMatchObject({ x: 30, y: 31 });
});
