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

const C = '00000000-0000-0000-0000-000000000003';
async function build(kind: string) {
  await admin('update public.profiles set gold=10000 where id=$1', [A]);
  const size = BUILDINGS[kind as keyof typeof BUILDINGS].size;
  const cell = (
    await admin(
      'select x,y from generate_series(0,59)x cross join generate_series(0,59)y where public.check_placement((select island_id from public.shared_world),x,y,$1) limit 1',
      [size],
    )
  )[0];
  await action('build', { kind, ...cell });
  await cooldown();
  return ((await scalar('select public.load_world()')) as any).buildings.find(
    (b: any) => b.kind === kind,
  );
}
async function ready(id: string, age = '24 hours') {
  await admin('update public.buildings set built_at=clock_timestamp()-$2::interval where id=$1', [
    id,
    age,
  ]);
}
async function world() {
  return (await scalar('select public.load_world()')) as any;
}
async function election() {
  return (await world()).governance.election;
}
async function closeElection() {
  await admin('update public.elections set closes_at=clock_timestamp() where finalized_at is null');
  return await world();
}
async function electB() {
  await build('townhall');
  const e = await election();
  await action('vote', { election_id: e.id, candidate_id: B });
  await asUser(C);
  await action('vote', { election_id: e.id, candidate_id: B });
  await asUser(A);
  await closeElection();
  await cooldown();
}
describe('Commerces et revenus serveur', () => {
  it('catalogue : quatre nouveaux commerces et Megazone 4x4', async () => {
    const rules = (await admin("select value from public.game_rules where key='buildings'"))[0]
      .value as any;
    // This suite exercises migration 6's catalogue; later migrations add entries.
    for (const k of Object.keys(rules)) {
      const v = BUILDINGS[k as keyof typeof BUILDINGS];
      expect(rules[k]).toEqual({
        price: v.price,
        points: v.points,
        size: v.size,
        commerce: v.category === 'Commerces',
      });
    }
    expect(BUILDINGS.supermarket).toMatchObject({ name: 'Megazone', size: 4 });
    const civic = (await admin("select value from public.game_rules where key='civic'"))[0]
      .value as any;
    expect(civic).toEqual({
      income_seconds: CIVIC_RULES.incomeMs / 1000,
      income_gold: CIVIC_RULES.incomeGold,
      election_seconds: 15 * 24 * 60 * 60, // migration 6 predates weekly mandates
      voting_seconds: CIVIC_RULES.votingMs / 1000,
    });
  });
  it('autorise un Megazone 4x4, avec vraie empreinte', async () => {
    const b = await build('supermarket');
    expect(b.size).toBe(4);
    await rejected(() => action('add_plot', { x: b.x + 3, y: b.y + 3 }), /Emplacement/);
  });
  it('construit les nouveaux commerces avec timestamps serveur', async () => {
    for (const kind of ['butcher', 'pharmacy', 'barber', 'nail_salon']) {
      const b = await build(kind);
      expect(b.built_at).toBeTruthy();
      expect(b.size).toBe(2);
      expect(b.income_claimed_cycle).toBe(0);
      await cooldown();
    }
  });
  it('interdit une collecte avant 24h', async () => {
    const b = await build('bakery');
    await ready(b.id, '23 hours 59 minutes');
    await rejected(() => action('claim_income', { id: b.id }), /pas encore/);
  });
  it('communisme : le premier visiteur reçoit le revenu sans débit du constructeur', async () => {
    const b = await build('bakery');
    await ready(b.id);
    await asUser(B);
    await action('claim_income', { id: b.id, amount: 999999 });
    expect(await gold()).toBe(120);
    await asUser(A);
    expect(await gold()).toBe(9700);
    await rejected(() => action('claim_income', { id: b.id }), /déjà récupéré/);
  });
  it('une seule collecte par période, avec rejeu idempotent', async () => {
    const b = await build('butcher');
    await ready(b.id);
    const id = crypto.randomUUID();
    await action('claim_income', { id: b.id }, id);
    expect(((await action('claim_income', { id: b.id }, id)) as any).replayed).toBe(true);
    expect(await gold()).toBe(9670);
    await cooldown();
    await rejected(() => action('claim_income', { id: b.id }), /déjà récupéré/);
    expect(await admin('select * from public.commerce_claims')).toHaveLength(1);
  });
  it('reste ancré à la construction, ne cumule pas les jours manqués', async () => {
    const b = await build('barber');
    await ready(b.id, '5 days');
    await action('claim_income', { id: b.id });
    expect(await gold()).toBe(9770);
    await cooldown();
    await rejected(() => action('claim_income', { id: b.id }), /déjà récupéré/);
    await ready(b.id, '6 days');
    await action('claim_income', { id: b.id });
    expect(await gold()).toBe(9790);
  });
  it('ne donne pas de revenu aux maisons ou bâtiments publics', async () => {
    const b = await build('cottage');
    await ready(b.id);
    await rejected(() => action('claim_income', { id: b.id }), /ne produit pas/);
  });
  it('refuse la collecte sur un identifiant inconnu', async () => {
    await rejected(() => action('claim_income', { id: crypto.randomUUID() }), /introuvable/);
  });
});
describe('Mairie, élections et régimes économiques', () => {
  it('ne propose pas de scrutin avant la première mairie', async () => {
    expect((await world()).governance.election).toBeNull();
    await rejected(() => action('set_regime', { regime: 'capitalism' }), /Seul le maire/);
  });
  it('ouvre un scrutin de 24h à la construction, avec tous les habitants', async () => {
    const b = await build('townhall'),
      e = await election();
    expect(e.candidates).toHaveLength(3);
    expect(e.starts_at).toBe(b.built_at);
    expect(Date.parse(e.closes_at) - Date.parse(e.starts_at)).toBe(86400000);
  });
  it('interdit le vote pour soi, le double vote et le candidat inexistant', async () => {
    await build('townhall');
    const e = await election();
    await rejected(() => action('vote', { election_id: e.id, candidate_id: A }), /soi/);
    await rejected(
      () => action('vote', { election_id: e.id, candidate_id: crypto.randomUUID() }),
      /introuvable/,
    );
    await action('vote', { election_id: e.id, candidate_id: B });
    await cooldown();
    await rejected(() => action('vote', { election_id: e.id, candidate_id: C }), /déjà voté/);
    expect((await election()).my_vote).toBe(B);
  });
  it('ne divulgue pas les votes individuels des autres habitants', async () => {
    await build('townhall');
    const e = await election();
    await action('vote', { election_id: e.id, candidate_id: B });
    await asUser(B);
    expect((await election()).my_vote).toBeNull();
    await rejected(() => q('select * from public.election_votes'), /permission denied/);
  });
  it('élit le candidat majoritaire à la fermeture et refuse les votes tardifs', async () => {
    await electB();
    const w = await world();
    expect(w.governance.mayor_id).toBe(B);
    expect(w.governance.election.result).toBe('elected');
    await rejected(
      () => action('vote', { election_id: w.governance.election.id, candidate_id: C }),
      /fermé/,
    );
  });
  it('ne désigne pas un maire arbitraire en cas d’égalité', async () => {
    await build('townhall');
    const e = await election();
    await action('vote', { election_id: e.id, candidate_id: B });
    await asUser(B);
    await action('vote', { election_id: e.id, candidate_id: A });
    const w = await closeElection();
    expect(w.governance.mayor_id).toBeNull();
    expect(w.governance.election.result).toBe('tie');
  });
  it('ne désigne personne sans vote', async () => {
    await build('townhall');
    const w = await closeElection();
    expect(w.governance.mayor_id).toBeNull();
    expect(w.governance.election.result).toBe('no_votes');
  });
  it('ouvre le scrutin suivant exactement un cycle de 15 jours plus tard', async () => {
    await build('townhall');
    const first = await election();
    await admin(
      "update public.elections set starts_at=starts_at-interval '15 days',closes_at=closes_at-interval '15 days' where id=$1",
      [first.id],
    );
    await admin(
      "update public.shared_world set civic_epoch=civic_epoch-interval '15 days' where singleton=true",
    );
    const next = await election();
    const previous = (await admin('select * from public.elections where id=$1', [first.id]))[0];
    expect(next.id).not.toBe(first.id);
    expect(Date.parse(next.starts_at) - new Date(previous.starts_at as string).getTime()).toBe(
      15 * 86400000,
    );
  });
  it('capitalisme : seul le constructeur peut récolter, même face au maire', async () => {
    const b = await build('pharmacy');
    await electB();
    await asUser(B);
    await action('set_regime', { regime: 'capitalism' });
    await ready(b.id);
    await cooldown();
    await rejected(() => action('claim_income', { id: b.id }), /constructeur/);
    await asUser(A);
    await action('claim_income', { id: b.id });
    expect(await gold()).toBe(9020);
  });
  it('seul le maire choisit un régime valide, le communisme réouvre les collectes', async () => {
    const b = await build('nail_salon');
    await electB();
    await rejected(() => action('set_regime', { regime: 'capitalism' }), /Seul le maire/);
    await asUser(B);
    await rejected(() => action('set_regime', { regime: 'autre' }), /invalide/);
    await action('set_regime', { regime: 'capitalism' });
    await cooldown();
    await action('set_regime', { regime: 'communism' });
    await ready(b.id);
    await asUser(C);
    await action('claim_income', { id: b.id });
    expect(await gold()).toBe(120);
  });
  it('les écritures directes de régime, maire et récompenses sont interdites', async () => {
    await rejected(
      () => q("update public.shared_world set regime='capitalism' where singleton=true"),
      /permission denied/,
    );
    await rejected(
      () =>
        q('update public.buildings set income_claimed_cycle=0 where id=$1', [crypto.randomUUID()]),
      /permission denied/,
    );
    await rejected(() => q('select public.ensure_civic_state()'), /permission denied/);
  });
});

it('agrandit et replace un ancien supermarché en conservant son identité', async () => {
  const legacy = new PGlite();
  try {
    await legacy.exec(
      "create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;",
    );
    await legacy.exec(
      readFileSync(
        new URL('../supabase/migrations/202611040001_island_village.sql', import.meta.url),
        'utf8',
      ),
    );
    await legacy.query('insert into auth.users values($1)', [A]);
    await legacy.query("select set_config('request.jwt.claim.sub',$1,false)", [A]);
    await legacy.query('select public.create_village($1,$2,$3::jsonb)', [
      'Alice',
      'Test',
      JSON.stringify(avatar),
    ]);
    for (const name of [
      '202611040002_shared_island.sql',
      '202611040003_expand_daily_trees.sql',
      '202611040004_buy_farm_plots.sql',
      '202611040005_final_assignments_road_price.sql',
    ])
      await legacy.exec(
        readFileSync(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8'),
      );
    const cell = (
      await legacy.query<any>(
        'select x,y from generate_series(0,59)x cross join generate_series(0,59)y where (select bool_and(public.check_placement((select island_id from public.shared_world),x+dx,y+dy,1)) from generate_series(0,3)dx cross join generate_series(0,3)dy) limit 1',
      )
    ).rows[0];
    const original = (
      await legacy.query<any>(
        "insert into public.buildings(island_id,kind,x,y,size,created_by) select island_id,'supermarket',$1,$2,3,$3 from public.shared_world returning *",
        [cell.x, cell.y, A],
      )
    ).rows[0];
    await legacy.query(
      "insert into public.buildings(island_id,kind,x,y,size,created_by) select island_id,'road',$1,$2,1,$3 from public.shared_world",
      [cell.x + 3, cell.y, A],
    );
    await legacy.exec(
      readFileSync(
        new URL('../supabase/migrations/202611050006_commerce_and_elections.sql', import.meta.url),
        'utf8',
      ),
    );
    const after = (
      await legacy.query<any>('select * from public.buildings where id=$1', [original.id])
    ).rows[0];
    expect(after.id).toBe(original.id);
    expect(after.created_by).toBe(A);
    expect(after.size).toBe(4);
    expect(after.x !== original.x || after.y !== original.y).toBe(true);
    expect(
      (
        await legacy.query<any>('select public.check_placement($1,$2,$3,4,$4) as valid', [
          after.island_id,
          after.x,
          after.y,
          after.id,
        ])
      ).rows[0].valid,
    ).toBe(true);
  } finally {
    await legacy.close();
  }
}, 60_000);
