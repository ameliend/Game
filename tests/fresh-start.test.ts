import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { BUILDINGS, MAIN_ISLAND, RULES, buildingIncome } from '../src/config/game';
import { land } from '../src/utils/rules';
const db = new PGlite(),
  dir = new URL('../supabase/migrations/', import.meta.url);
const filename = '202611050012_fresh_start_fences_catalogue.sql';
const latest = readFileSync(new URL(filename, dir), 'utf8');
const alice = '00000000-0000-0000-0000-000000000001',
  bob = '00000000-0000-0000-0000-000000000002',
  cam = '00000000-0000-0000-0000-000000000003';
const avatar = { skin: '#dba77c', hair: '#754d32', shirt: '#eaa66d', pants: '#486f70' };
const expected: [keyof typeof BUILDINGS, number, number][] = [
  ['cottage', 150, 10],
  ['nail_salon', 250, 15],
  ['barber', 250, 15],
  ['bakery', 300, 20],
  ['coffeeshop', 300, 20],
  ['butcher', 350, 25],
  ['house', 400, 30],
  ['farm', 400, 30],
  ['pharmacy', 450, 35],
  ['chocolatier', 450, 35],
  ['sexshop', 500, 40],
  ['restaurant', 500, 40],
  ['school', 600, 45],
  ['roy_merlin', 700, 50],
  ['supermarket', 800, 55],
  ['hotel', 900, 60],
  ['townhall', 1000, 0],
  ['hospital', 1200, 80],
  ['gym', 600, 20],
];
let townhall: string, oldBuilt: string;
async function register(id: string, name: string) {
  await db.query('insert into auth.users values($1)', [id]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.query('select public.create_village($1,$2,$3::jsonb)', [
    name,
    'Test',
    JSON.stringify(avatar),
  ]);
}
async function as(id = alice) {
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
async function free(size: number) {
  await db.exec('reset role');
  const cell = (
    await db.query<any>(
      'select x,y from generate_series(0,59)x cross join generate_series(0,59)y where public.check_placement((select island_id from public.shared_world),x,y,$1) and not(x=30 and y=31) limit 1',
      [size],
    )
  ).rows[0];
  await db.exec('set role authenticated');
  return cell;
}
async function matureBuilding(kind: keyof typeof BUILDINGS, assigned: string | null = null) {
  const cell = await free(BUILDINGS[kind].size);
  await db.exec('reset role');
  const id = (
    await db.query<any>(
      "insert into public.buildings(island_id,kind,x,y,size,created_by,assigned_to,built_at) select island_id,$1,$2,$3,$4,$5,$6,clock_timestamp()-interval '25 hours' from public.shared_world returning id",
      [kind, cell.x, cell.y, BUILDINGS[kind].size, alice, assigned],
    )
  ).rows[0].id;
  await db.exec('set role authenticated');
  return id;
}
beforeAll(async () => {
  await db.exec(
    "create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;",
  );
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql') && f < filename)
    .sort();
  await db.exec(readFileSync(new URL(files[0], dir), 'utf8'));
  await register(alice, 'Alice');
  for (const f of files.slice(1)) await db.exec(readFileSync(new URL(f, dir), 'utf8'));
  await register(bob, 'Bob');
  await register(cam, 'Cam');
  await db.exec(
    'delete from public.buildings;delete from public.trees;delete from public.farm_plots;',
  );
  const hall = (
    await db.query<any>(
      "insert into public.buildings(island_id,kind,x,y,size,created_by,built_at) select island_id,'townhall',50,30,3,$1,'2026-01-01'::timestamptz from public.shared_world returning *",
      [alice],
    )
  ).rows[0];
  townhall = hall.id;
  oldBuilt = hall.built_at;
  await db.query(
    "insert into public.buildings(island_id,kind,x,y,size,created_by) select island_id,'gym',20,24,3,$1 from public.shared_world",
    [alice],
  );
  await db.query(
    "insert into public.buildings(island_id,kind,x,y,size,created_by) select island_id,'cottage',30,30,2,$1 from public.shared_world",
    [bob],
  );
  await db.exec(
    "insert into public.farm_plots(island_id,x,y) select island_id,40,40 from public.shared_world;insert into public.plantations select id,'carrot',clock_timestamp() from public.farm_plots;update public.inventories set quantity=77;",
  );
  for (const [id, gold] of [
    [alice, 999],
    [bob, 12],
    [cam, 500],
  ])
    await db.query('update public.profiles set gold=$2,tutorial_step=5 where id=$1', [id, gold]);
  await db.query(
    "update public.shared_world set regime='communism',mayor_id=$1,civic_epoch=clock_timestamp()-interval '14 days',next_election_at=clock_timestamp()+interval '7 days' where singleton=true",
    [alice],
  );
  const election = (
    await db.query<any>(
      "insert into public.elections(starts_at,round_started_at,closes_at) values(clock_timestamp()-interval '1 hour',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '23 hours') returning id",
    )
  ).rows[0].id;
  await db.query(
    'insert into public.election_candidates select $1,id,username,true from public.profiles',
    [election],
  );
  await db.query('insert into public.election_electors select $1,id from public.profiles', [
    election,
  ]);
  await db.query(
    'insert into public.election_votes(election_id,voter_id,candidate_id) values($1,$2,$3)',
    [election, bob, alice],
  );
  const proposal = (
    await db.query<any>(
      "insert into public.exile_proposals(proposer_id,target_id,starts_at,closes_at,status) values($1,$2,clock_timestamp()-interval '25 hours',clock_timestamp()-interval '1 hour','accepted') returning id",
      [alice, bob],
    )
  ).rows[0].id;
  await db.query(
    "insert into public.banishments values($1,$2,clock_timestamp()-interval '1 hour',clock_timestamp()+interval '23 hours')",
    [bob, proposal],
  );
  await db.query(
    'insert into public.player_presence(user_id,island_id,x,y) select $1,island_id,61,30 from public.shared_world',
    [bob],
  );
  await db.exec(latest);
}, 60000);
afterAll(async () => db.close());
beforeEach(async () => {
  await db.exec('reset role;begin');
  await as();
});
afterEach(async () => db.exec('rollback;reset role'));
it('réinitialise tous les soldes à 150 et conserve les comptes et avatars', async () => {
  await db.exec('reset role');
  const profiles = (
    await db.query<any>('select username,gold,tutorial_step from public.profiles order by username')
  ).rows;
  expect(profiles).toEqual([
    { username: 'Alice', gold: 150, tutorial_step: 0 },
    { username: 'Bob', gold: 150, tutorial_step: 0 },
    { username: 'Cam', gold: 150, tutorial_step: 0 },
  ]);
  expect((await db.query('select * from public.avatars')).rows).toHaveLength(3);
  expect(
    (
      await db.query<any>(
        "select gold_delta from public.economy_transactions where action='fresh_start' order by gold_delta",
      )
    ).rows.map((r) => r.gold_delta),
  ).toEqual([-849, -350, 138]);
});
it('ne conserve que la mairie, avec son identité, et la replace sur le terrain réduit', async () => {
  const w = await world();
  expect(w.buildings).toHaveLength(1);
  const h = w.buildings[0];
  expect(h).toMatchObject({ id: townhall, kind: 'townhall', created_by: alice });
  expect(new Date(h.built_at).toISOString()).toBe(new Date(oldBuilt).toISOString());
  expect({ x: h.x, y: h.y }).not.toEqual({ x: 50, y: 30 });
  for (let x = h.x; x < h.x + 3; x++)
    for (let y = h.y; y < h.y + 3; y++) expect(land(x, y)).toBe(true);
  expect(w.island.score).toBe(70);
  expect(w.generation).toBe(1);
});
it('vide les stocks et cultures et crée douze arbres sur des cases valides', async () => {
  const w = await world();
  expect(w.plots).toEqual([]);
  expect(w.plantations).toEqual([]);
  expect(w.trees).toHaveLength(12);
  expect(Object.values(w.inventory).every((v) => v === 0)).toBe(true);
  for (const t of w.trees) {
    expect(land(t.x, t.y)).toBe(true);
    expect(t.cut_at).toBeNull();
    expect({ x: t.x, y: t.y }).not.toEqual(RULES.spawn);
  }
});
it('retire le maire et les exils puis ouvre un nouveau scrutin en capitalisme', async () => {
  const w = await world();
  expect(w.governance.mayor_id).toBeNull();
  expect(w.governance.regime).toBe('capitalism');
  expect(w.exile).toBeUndefined();
  const e = w.governance.election;
  expect(e.finalized_at).toBeNull();
  expect(e.voted_count).toBe(0);
  expect(e.elector_count).toBe(3);
  expect(Date.parse(e.closes_at) - Date.parse(e.starts_at)).toBe(86400000);
  await db.exec('reset role');
  expect((await db.query('select * from public.banishments')).rows).toHaveLength(0);
  expect((await db.query('select * from public.exile_proposals')).rows).toHaveLength(0);
});
it('archive l’ancien état et ne rejoue pas le nouveau départ à une seconde exécution', async () => {
  const cell = await free(1);
  await act('build', { kind: 'fence', ...cell });
  const before = await world();
  await db.exec('reset role');
  const archive = (await db.query<any>('select snapshot from public.world_resets')).rows[0]
    .snapshot;
  expect(archive.election_votes).toHaveLength(1);
  expect(archive.buildings).toHaveLength(3);
  expect(archive.inventories.some((r: any) => r.quantity === 77)).toBe(true);
  await db.exec(latest.replace(/^begin;$/m, '').replace(/^commit;$/m, ''));
  await db.exec('set role authenticated');
  const after = await world();
  expect(after.island.gold).toBe(before.island.gold);
  expect(after.buildings).toEqual(before.buildings);
  expect(after.governance.election.id).toBe(before.governance.election.id);
  expect(after.generation).toBe(1);
});
it('donne aussi 150 pièces aux nouveaux habitants', async () => {
  await db.exec('reset role');
  const dana = crypto.randomUUID();
  await register(dana, 'Dana');
  await as(dana);
  expect((await world()).island.gold).toBe(150);
});
it('réduit exactement de 25 % le nombre de cases de terrain et garde le même tracé côté serveur', async () => {
  await db.exec('reset role');
  const cells = (
    await db.query<any>(
      'select x,y,public.is_land(x,y) as land from generate_series(0,59)x cross join generate_series(0,59)y',
    )
  ).rows;
  const count = cells.filter((r) => r.land).length;
  expect(count).toBe(1968 * 0.75);
  expect(count).toBe(MAIN_ISLAND.tiles);
  for (const r of cells) expect(land(r.x, r.y)).toBe(r.land);
});
it('synchronise tous les coûts et revenus du tableau, avec les exceptions demandées', async () => {
  await db.exec('reset role');
  const cfg = (await db.query<any>("select value from public.game_rules where key='buildings'"))
    .rows[0].value;
  for (const [kind, price, income] of expected) {
    expect(cfg[kind]).toMatchObject({ price, income_gold: income });
    expect(BUILDINGS[kind].price).toBe(price);
    expect(buildingIncome(kind)).toBe(income);
  }
  expect(cfg.house.points).toBe(25);
  expect(cfg.pharmacy.points).toBe(20);
  expect(cfg.fence).toMatchObject({ price: 1, size: 1, income_gold: 0 });
});
it.each(expected.filter(([, , income]) => income > 0))(
  '%s rapporte le montant indiqué de %i pièces de coût et %i pièces de revenu',
  async (kind, _price, income) => {
    const id = await matureBuilding(kind);
    const before = (await world()).island.gold;
    await act('claim_income', { id });
    expect((await world()).island.gold).toBe(before + income);
  },
);
it('ne donne de revenu à personne pour une maison attribuée ou une mairie, même en communisme', async () => {
  const id = await matureBuilding('house', bob);
  for (const regime of ['capitalism', 'communism']) {
    await db.exec('reset role');
    await db.query('update public.shared_world set regime=$1 where singleton=true', [regime]);
    for (const user of [alice, bob, cam])
      for (const building of [id, townhall]) {
        await as(user);
        await db.exec('savepoint claim');
        await expect(act('claim_income', { id: building })).rejects.toThrow(
          'ne produit pas de revenu',
        );
        await db.exec('rollback to savepoint claim');
      }
  }
});
it('réserve les revenus au constructeur en capitalisme et au premier habitant en communisme', async () => {
  const id = await matureBuilding('restaurant');
  await as(bob);
  await db.exec('savepoint claim');
  await expect(act('claim_income', { id })).rejects.toThrow('Seul le constructeur');
  await db.exec('rollback to savepoint claim');
  await db.exec('reset role');
  await db.query("update public.shared_world set regime='communism' where singleton=true");
  await db.exec('set role authenticated');
  await act('claim_income', { id });
  expect((await world()).island.gold).toBe(190);
  await as(alice);
  await db.exec('savepoint claim');
  await expect(act('claim_income', { id })).rejects.toThrow('déjà récupéré');
  await db.exec('rollback to savepoint claim');
});
it('construit trois clôtures à une pièce chacune sans ajouter de revenu ni de points', async () => {
  const before = await world();
  for (let i = 0; i < 3; i++) {
    await as();
    const cell = await free(1);
    await act('build', { kind: 'fence', ...cell });
  }
  const w = await world();
  expect(w.island.gold).toBe(before.island.gold - 3);
  expect(w.island.score).toBe(before.island.score);
  expect(w.buildings.filter((b: any) => b.kind === 'fence')).toHaveLength(3);
});
