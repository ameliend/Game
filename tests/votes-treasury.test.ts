import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { beforeAll, beforeEach, afterEach, afterAll, expect, it } from 'vitest';
const db = new PGlite(),
  dir = new URL('../supabase/migrations/', import.meta.url);
const alice = '00000000-0000-0000-0000-000000000001',
  bob = '00000000-0000-0000-0000-000000000002',
  cam = '00000000-0000-0000-0000-000000000003';
const q = async (sql: string, args: any[] = []) => (await db.query<any>(sql, args)).rows;
const act = (type: string, payload: object, request = crypto.randomUUID()) =>
  q('select public.game_action($1,$2::jsonb,$3) as r', [type, JSON.stringify(payload), request]);
async function as(id = alice) {
  await db.exec('reset role');
  await q('update public.profiles set last_action_at=null where id=$1', [id]);
  await q("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec('set role authenticated');
}
const world = async () => (await q('select public.load_world() as w'))[0].w;
async function building(
  kind = 'road',
  owner: string | null = alice,
  assigned: string | null = null,
) {
  await db.exec('reset role');
  return (
    await q(
      'insert into public.buildings(island_id,kind,x,y,size,created_by,assigned_to) select island_id,$1,20,20,1,$2,$3 from public.shared_world returning id',
      [kind, owner, assigned],
    )
  )[0].id;
}
beforeAll(async () => {
  await db.exec(
    "create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;",
  );
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort())
    await db.exec(readFileSync(new URL(file, dir), 'utf8'));
  for (const [id, name] of [
    [alice, 'Alice'],
    [bob, 'Bobby'],
    [cam, 'Cam'],
  ]) {
    await q('insert into auth.users values($1)', [id]);
    await q("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    await q('select public.create_village($1,$2,$3::jsonb)', [
      name,
      'Test',
      JSON.stringify({ skin: '#dba77c', hair: '#754d32', shirt: '#eaa66d', pants: '#486f70' }),
    ]);
  }
  await q(
    "update public.shared_world set mayor_id=$1,next_election_at=clock_timestamp()+interval '7 days' where singleton=true",
    [alice],
  );
  await db.exec(
    'update public.elections set finalized_at=clock_timestamp();update public.profiles set gold=1000;delete from public.trees;delete from public.farm_plots;',
  );
}, 30000);
beforeEach(async () => {
  await db.exec('reset role;begin;');
});
afterEach(async () => {
  await db.exec('rollback;reset role;');
});
afterAll(async () => {
  await db.close();
});
it('starts tax clocks now, with no retroactive debit, and removes points', async () => {
  const id = await building('cottage');
  await q(
    "update public.buildings set built_at=clock_timestamp()-interval '100 days' where id=$1",
    [id],
  );
  await as();
  await q('select public.refresh_world()');
  const w = await world();
  expect(w.island.gold).toBe(1000);
  expect(w.treasury).toBe(0);
  expect(w.island.score).toBe(0);
});
it('bills full elapsed days to the declared owner or builder exactly once', async () => {
  const one = await building('road'),
    two = await building('house', alice, bob);
  await q(
    "update public.buildings set tax_last_at=clock_timestamp()-interval '49 hours' where id=$1",
    [one],
  );
  await q(
    "update public.buildings set tax_last_at=clock_timestamp()-interval '73 hours' where id=$1",
    [two],
  );
  await as();
  await q('select public.refresh_world()');
  await q('select public.refresh_world()');
  expect((await world()).island.gold).toBe(994);
  expect((await world()).treasury).toBe(15);
  await as(bob);
  expect((await world()).island.gold).toBe(991);
});
it('permits a negative balance and gives exactly six hours to repay', async () => {
  const id = await building();
  await q('update public.profiles set gold=1 where id=$1', [alice]);
  await q(
    "update public.buildings set tax_last_at=clock_timestamp()-interval '25 hours' where id=$1",
    [id],
  );
  await as();
  await q('select public.refresh_world()');
  const w = await world();
  expect(w.island.gold).toBe(-2);
  expect(w.treasury).toBe(3);
  expect(w.debt.blocked).toBe(false);
  expect(Date.parse(w.debt.deadline) - Date.parse(w.server_time)).toBeGreaterThan(
    6 * 3600000 - 5000,
  );
});
it('blocks gameplay after six hours but selling clears the debt and restores access', async () => {
  await q('update public.profiles set gold=-3 where id=$1', [alice]);
  await q(
    "update public.profiles set debt_since=clock_timestamp()-interval '7 hours' where id=$1",
    [alice],
  );
  await q("update public.inventories set quantity=5 where user_id=$1 and item='wood'", [alice]);
  await as();
  await db.exec('savepoint blocked');
  await expect(act('build', { kind: 'casino', x: 25, y: 25 })).rejects.toThrow('jeu bloqué');
  await db.exec('rollback to blocked');
  await act('sell', { item: 'wood', quantity: 1 });
  expect((await world()).island.gold).toBe(1);
  expect((await world()).debt).toBe(null);
});
it('collects resources and sells during the six-hour grace period despite a negative wallet', async () => {
  await q('update public.profiles set gold=-9 where id=$1', [alice]);
  const tree = (
    await q(
      'insert into public.trees(island_id,x,y) select island_id,25,25 from public.shared_world returning id',
    )
  )[0].id;
  await as();
  await act('chop', { id: tree });
  await as();
  await act('sell', { item: 'wood', quantity: 5 });
  expect((await world()).island.gold).toBe(11);
});
it('only lets the mayor spend communal funds and never debits their personal wallet', async () => {
  await db.exec('update public.shared_world set treasury=10 where singleton=true');
  await as(bob);
  await db.exec('savepoint denied');
  await expect(act('municipal_build', { kind: 'road', x: 25, y: 25 })).rejects.toThrow(
    'Seul le maire',
  );
  await db.exec('rollback to denied');
  await as();
  const request = crypto.randomUUID(),
    payload = { kind: 'road', x: 25, y: 25 };
  await act('municipal_build', payload, request);
  await act('municipal_build', payload, request);
  const w = await world();
  expect(w.treasury).toBe(9);
  expect(w.island.gold).toBe(1000);
  const road = w.buildings.find((b: any) => b.x === 25 && b.y === 25);
  expect(road.public_funded).toBe(true);
  expect(road.created_by).toBe(null);
  await db.exec('reset role');
  await q(
    "update public.buildings set tax_last_at=clock_timestamp()-interval '10 days' where id=$1",
    [road.id],
  );
  await as();
  await q('select public.refresh_world()');
  expect((await world()).treasury).toBe(9);
});
it.each(['casino', 'road', 'fence', 'townhall', 'hospital'])(
  'requires all residents before demolishing %s, even through the former immediate action',
  async (kind) => {
    const id = await building(kind);
    await as();
    await act('demolish', { id });
    let w = await world();
    expect(w.buildings.some((b: any) => b.id === id)).toBe(true);
    const p = w.governance.demolition_proposals[0];
    expect(p.elector_count).toBe(3);
    expect(p.yes).toBe(1);
    await as(bob);
    await act('vote_demolition', { proposal_id: p.id, yes: true });
    expect((await world()).buildings.some((b: any) => b.id === id)).toBe(true);
    await as(cam);
    await act('vote_demolition', { proposal_id: p.id, yes: true });
    expect((await world()).buildings.some((b: any) => b.id === id)).toBe(false);
  },
);
it('a single no rejects a demolition immediately, retaining the building', async () => {
  const id = await building();
  await as();
  await act('propose_demolition', { id, target_type: 'building' });
  const p = (await world()).governance.demolition_proposals[0];
  await as(bob);
  await act('vote_demolition', { proposal_id: p.id, yes: false });
  const w = await world();
  expect(w.governance.demolition_proposals).toEqual([]);
  expect(w.buildings.some((b: any) => b.id === id)).toBe(true);
});
it('removes a farm plot and its plantation only after unanimous approval', async () => {
  const id = (
    await q(
      'insert into public.farm_plots(island_id,x,y) select island_id,26,26 from public.shared_world returning id',
    )
  )[0].id;
  await q("insert into public.plantations values($1,'carrot',clock_timestamp())", [id]);
  await as();
  await act('propose_demolition', { id: String(id), target_type: 'plot' });
  const p = (await world()).governance.demolition_proposals[0];
  for (const u of [bob, cam]) {
    await as(u);
    await act('vote_demolition', { proposal_id: p.id, yes: true });
  }
  const w = await world();
  expect(w.plots.some((p: any) => p.id === id)).toBe(false);
  expect(w.plantations.some((p: any) => p.plot_id === id)).toBe(false);
});
it('rejects expired non-unanimous demolition requests without destroying anything', async () => {
  const id = await building();
  await as();
  await act('propose_demolition', { id, target_type: 'building' });
  await db.exec(
    "reset role;update public.demolition_proposals set closes_at=clock_timestamp()-interval '1 second';set role authenticated",
  );
  await q('select public.refresh_world()');
  expect((await world()).buildings.some((b: any) => b.id === id)).toBe(true);
});
it('closes a police vote once everyone except the mayor and target has voted, and exposes offline exiles', async () => {
  await as();
  await act('propose_exile', { user_id: bob });
  const p = (await world()).governance.exile_proposal;
  expect(p.elector_count).toBe(1);
  expect(p.can_vote).toBe(false);
  await as(cam);
  await act('vote_exile', { proposal_id: p.id, round: p.round, yes: true });
  expect((await world()).governance.exile_proposal.status).toBe('accepted');
  const people = (await q('select public.online_residents() as r'))[0].r,
    b = people.find((p: any) => p.id === bob);
  expect(b).toMatchObject({ x: 61, y: 30, online: false, exiled: true });
  await as(bob);
  expect((await world()).exile).toBeTruthy();
});
it('forbids direct access to old action functions and private ledgers', async () => {
  await as();
  await expect(q('select * from public.treasury_ledger')).rejects.toThrow('permission denied');
});
it('collects public-building income into the treasury rather than a personal wallet', async () => {
  const id = await building('bakery', null);
  await q(
    "update public.buildings set public_funded=true,built_at=clock_timestamp()-interval '25 hours' where id=$1",
    [id],
  );
  await as(bob);
  const request = crypto.randomUUID();
  await act('claim_income', { id }, request);
  await act('claim_income', { id }, request);
  const w = await world();
  expect(w.treasury).toBe(20);
  expect(w.island.gold).toBe(1000);
});
it('freezes presence coordinates and prevents chat when the debt deadline is exceeded', async () => {
  await as();
  await q('select public.heartbeat_presence(30,31)');
  await db.exec('reset role');
  await q('update public.profiles set gold=-3 where id=$1', [alice]);
  await q(
    "update public.profiles set debt_since=clock_timestamp()-interval '7 hours' where id=$1",
    [alice],
  );
  await as();
  await q('select public.heartbeat_presence(31,32)');
  const self = (await q('select public.online_residents() as r'))[0].r.find(
    (p: any) => p.id === alice,
  );
  expect(self).toMatchObject({ x: 30, y: 31 });
  await expect(
    q('select public.send_message($1,$2)', ['Test', crypto.randomUUID()]),
  ).rejects.toThrow('seules les ventes');
});
it('does not restart the six-hour deadline when another day of taxes is charged', async () => {
  const id = await building();
  await q('update public.profiles set gold=-3 where id=$1', [alice]);
  await q(
    "update public.profiles set debt_since=clock_timestamp()-interval '5 hours' where id=$1",
    [alice],
  );
  await q(
    "update public.buildings set tax_last_at=clock_timestamp()-interval '25 hours' where id=$1",
    [id],
  );
  await as();
  await q('select public.refresh_world()');
  const w = await world();
  expect(w.island.gold).toBe(-6);
  expect(Date.parse(w.debt.deadline) - Date.parse(w.server_time)).toBeLessThan(3600000 + 1000);
});
it('assigned municipal homes still produce no income for anyone', async () => {
  const id = await building('house', null, bob);
  await q(
    "update public.buildings set public_funded=true,built_at=clock_timestamp()-interval '25 hours' where id=$1",
    [id],
  );
  await as();
  await expect(act('claim_income', { id })).rejects.toThrow('Aucun revenu');
});
it('an early police tie opens the one-hour runoff, then closes when its electors vote', async () => {
  const dora = '00000000-0000-0000-0000-000000000004';
  await q('insert into auth.users values($1)', [dora]);
  await q("insert into public.profiles(id,username) values($1,'Dora')", [dora]);
  await as();
  await act('propose_exile', { user_id: bob });
  let p = (await world()).governance.exile_proposal;
  await as(cam);
  await act('vote_exile', { proposal_id: p.id, round: 1, yes: true });
  await as(dora);
  await act('vote_exile', { proposal_id: p.id, round: 1, yes: false });
  p = (await world()).governance.exile_proposal;
  expect(p.round).toBe(2);
  expect(p.status).toBe('open');
  expect(Date.parse(p.closes_at) - Date.now()).toBeGreaterThan(3590000);
  expect(Date.parse(p.closes_at) - Date.now()).toBeLessThan(3601000);
  for (const id of [cam, dora]) {
    await as(id);
    await act('vote_exile', { proposal_id: p.id, round: 2, yes: true });
  }
  expect((await world()).governance.exile_proposal.status).toBe('accepted');
});
