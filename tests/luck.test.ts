import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, afterEach, expect, it } from 'vitest';
const db = new PGlite();
const user = '00000000-0000-0000-0000-000000000001';
let casino: string;
const query = async (sql: string, params: any[] = []) => (await db.query<any>(sql, params)).rows;
const act = (type: string, payload: object, request = crypto.randomUUID()) =>
  query('select public.game_action($1,$2::jsonb,$3) as r', [
    type,
    JSON.stringify(payload),
    request,
  ]);
beforeAll(async () => {
  await db.exec(
    "create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;",
  );
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    await db.exec(readFileSync(new URL(file, dir), 'utf8'));
  }
  await db.query('insert into auth.users values($1)', [user]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.query('select public.create_village($1,$2,$3::jsonb)', [
    'Alice',
    'Test',
    JSON.stringify({ skin: '#dba77c', hair: '#754d32', shirt: '#eaa66d', pants: '#486f70' }),
  ]);
  await db.exec('delete from public.trees;');
  const cell = (
    await query(
      'select x,y from generate_series(0,59)x cross join generate_series(0,59)y where public.check_placement((select island_id from public.shared_world),x,y,3) limit 1',
    )
  )[0];
  casino =
    (await query(
      "select public.game_action('build',jsonb_build_object('kind','casino','x',$1::int,'y',$2::int),gen_random_uuid())",
      [cell.x, cell.y],
    ),
    (await query("select id from public.buildings where kind='casino'"))[0].id);
}, 30000);
beforeEach(async () => {
  await db.exec('begin;update public.profiles set last_action_at=null;');
});
afterEach(async () => {
  await db.exec('rollback');
});
afterAll(async () => {
  await db.close();
});
it('uses exactly the requested 65/30/5 distribution and enforces cooldown fallback', async () => {
  const rows = await query(
    'select public.scratch_payout(r,true) as prize,count(*)::int as n from generate_series(0,9999) r group by 1 order by 1',
  );
  expect(rows).toEqual([
    { prize: 0, n: 3500 },
    { prize: 1, n: 2000 },
    { prize: 5, n: 1000 },
    { prize: 10, n: 1800 },
    { prize: 25, n: 800 },
    { prize: 50, n: 400 },
    { prize: 100, n: 400 },
    { prize: 250, n: 100 },
  ]);
  expect((await query('select public.scratch_payout(9999,false) as prize'))[0].prize).toBe(0);
});
it('builds a free casino with no daily income and exposes a free, visible visitor', async () => {
  await db.exec('set local role authenticated');
  const w = (await query('select public.load_world() as w'))[0].w;
  expect(w.island.gold).toBe(150);
  expect(w.pol.id).toBeTruthy();
  expect(w.buildings.some((b: any) => b.id === casino)).toBe(true);
  await expect(act('claim_income', { id: casino })).rejects.toThrow('ne produit pas');
});
it('charges 5, credits only the server payout, and replays an identical result without charging again', async () => {
  await db.exec('set local role authenticated');
  const request = crypto.randomUUID(),
    payload = { id: casino };
  const result = (await act('scratch', payload, request))[0].r;
  const again = (await act('scratch', payload, request))[0].r;
  expect([0, 1, 5, 10, 25, 50, 100, 250]).toContain(result.payout);
  expect(again).toEqual({ ...result, replayed: true });
  const w = (await query('select public.load_world() as w'))[0].w;
  expect(w.island.gold).toBe(145 + result.payout);
});
it('rejects a ticket without sufficient funds', async () => {
  await db.exec('update public.profiles set gold=4;set local role authenticated');
  await expect(act('scratch', { id: casino })).rejects.toThrow('5 pièces');
});
it('awards Pol once globally, hides him and schedules the next random window 4 to 5 days later', async () => {
  const id = (await query('select pol_id from public.luck_state'))[0].pol_id;
  await db.exec('set local role authenticated');
  expect((await act('pol_deal', { id, choice: 'safe' }))[0].r.payout).toBe(50);
  const w = (await query('select public.load_world() as w'))[0].w;
  expect(w.pol).toBe(null);
  expect(w.island.gold).toBe(200);
  await db.exec('reset role');
  expect(
    (
      await query(
        "select pol_at>clock_timestamp()+interval '4 days'-interval '1 minute' and pol_at<=clock_timestamp()+interval '5 days' as valid from public.luck_state",
      )
    )[0].valid,
  ).toBe(true);
  await db.exec('update public.profiles set last_action_at=null;set local role authenticated');
  await expect(act('pol_deal', { id, choice: 'risk' })).rejects.toThrow('déjà reparti');
});
it('gives exactly 0 or 100 for the risky deal, without a stake', async () => {
  const id = (await query('select pol_id from public.luck_state'))[0].pol_id;
  await db.exec('set local role authenticated');
  const payout = (await act('pol_deal', { id, choice: 'risk' }))[0].r.payout;
  expect([0, 100]).toContain(payout);
  expect((await query('select public.load_world() as w'))[0].w.island.gold).toBe(150 + payout);
});
it('missed 24h visits expire and are rescheduled rather than staying forever', async () => {
  await db.exec(
    "update public.luck_state set pol_at=clock_timestamp()-interval '25 hours';set local role authenticated",
  );
  expect((await query('select public.load_world() as w'))[0].w.pol).toBe(null);
  await db.exec('reset role');
  expect(
    (
      await query(
        "select pol_at between clock_timestamp()+interval '4 days'-interval '1 minute' and clock_timestamp()+interval '5 days' as valid from public.luck_state",
      )
    )[0].valid,
  ).toBe(true);
});
it('prevents callers bypassing the wrapper or editing the jackpot cooldown', async () => {
  await db.exec('set local role authenticated');
  await expect(query('select * from public.luck_state')).rejects.toThrow('permission denied');
});
it('caps the big prize across successive tickets for fourteen days', async () => {
  // Force a jackpot roll while preserving the real eligibility decision in game_action.
  await db.exec(
    "create or replace function public.scratch_payout(roll integer,eligible boolean) returns integer language sql immutable set search_path='' as $$ select case when eligible then 250 else 0 end $$;set local role authenticated",
  );
  expect((await act('scratch', { id: casino }))[0].r.payout).toBe(250);
  await db.exec(
    'reset role;update public.profiles set last_action_at=null;set local role authenticated',
  );
  expect((await act('scratch', { id: casino }))[0].r.payout).toBe(0);
  await db.exec(
    "reset role;update public.luck_state set jackpot_at=clock_timestamp()-interval '14 days 1 second';update public.profiles set last_action_at=null;set local role authenticated",
  );
  expect((await act('scratch', { id: casino }))[0].r.payout).toBe(250);
});
it('keeps former world functions private so callers cannot bypass luck protections', async () => {
  const rows = await query(
    "select has_function_privilege('authenticated','public.game_action_before_luck(text,jsonb,uuid)','execute') as action,has_function_privilege('authenticated','public.load_world_before_luck(uuid)','execute') as world",
  );
  expect(rows[0]).toEqual({ action: false, world: false });
});
