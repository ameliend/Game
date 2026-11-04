import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, it } from 'vitest';
import { BUILDINGS, CROPS, RULES, FARM_PLOT } from '../src/config/game';
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
  await db.exec(`insert into public.buildings(id,island_id,kind,x,y,size,created_by,assigned_to)
 select '11111111-1111-1111-1111-111111111111',w.island_id,'cottage',x,y,2,'${A}','${B}' from public.shared_world w cross join generate_series(0,59)x cross join generate_series(0,59)y where public.check_placement(w.island_id,x,y,2) limit 1`);
  await db.exec(
    readFileSync(
      new URL(
        '../supabase/migrations/202611040005_final_assignments_road_price.sql',
        import.meta.url,
      ),
      'utf8',
    ),
  );
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

const legacyId = '11111111-1111-1111-1111-111111111111';
async function house() {
  await admin('update public.profiles set gold=500 where id=$1', [A]);
  const cell = (
    await admin(
      'select x,y from generate_series(0,59)x cross join generate_series(0,59)y where public.check_placement((select island_id from public.shared_world),x,y,2) limit 1',
    )
  )[0];
  await action('build', { kind: 'cottage', ...cell });
  await cooldown();
  return ((await scalar('select public.load_world()')) as any).buildings.find(
    (b: any) => b.id !== legacyId,
  );
}
describe('Attributions définitives et routes à une pièce', () => {
  it('verrouille les maisons déjà attribuées avant la migration', async () => {
    const b = ((await scalar('select public.load_world()')) as any).buildings.find(
      (b: any) => b.id === legacyId,
    );
    expect(b.assigned_to).toBe(B);
    expect(b.assigned_at).toBeTruthy();
    await rejected(() => action('assign', { id: legacyId, user_id: A }), /définitivement/);
  });
  it('autorise la première attribution, puis interdit le changement et le retrait', async () => {
    const b = await house();
    await action('assign', { id: b.id, user_id: B });
    await cooldown();
    await rejected(() => action('assign', { id: b.id, user_id: A }), /définitivement/);
    await rejected(() => action('assign', { id: b.id, user_id: null }), /définitivement/);
    const updated = ((await scalar('select public.load_world()')) as any).buildings.find(
      (v: any) => v.id === b.id,
    );
    expect(updated.assigned_to).toBe(B);
    expect(updated.assigned_at).toBeTruthy();
  });
  it('ne permet pas à un administrateur de réattribuer une maison', async () => {
    await asUser(B);
    await admin('update public.profiles set is_admin=true where id=$1', [B]);
    await rejected(() => action('assign', { id: legacyId, user_id: A }), /définitivement/);
  });
  it('garde l’attribution verrouillée après suppression du compte bénéficiaire', async () => {
    await admin('delete from public.profiles where id=$1', [B]);
    const b = ((await scalar('select public.load_world()')) as any).buildings.find(
      (v: any) => v.id === legacyId,
    );
    expect(b.assigned_to).toBeNull();
    expect(b.assigned_at).toBeTruthy();
    await rejected(() => action('assign', { id: legacyId, user_id: A }), /définitivement/);
  });
  it('accepte le rejeu idempotent de la première attribution sans nouvelle écriture', async () => {
    const b = await house(),
      id = crypto.randomUUID();
    await action('assign', { id: b.id, user_id: B }, id);
    expect(((await action('assign', { id: b.id, user_id: B }, id)) as any).replayed).toBe(true);
  });
  it('refuse une attribution vide ou un utilisateur inexistant sans verrouiller la maison', async () => {
    const b = await house();
    await rejected(() => action('assign', { id: b.id, user_id: null }), /Choisissez/);
    await rejected(
      () => action('assign', { id: b.id, user_id: '00000000-0000-0000-0000-000000000099' }),
      /introuvable/,
    );
    expect(
      ((await scalar('select public.load_world()')) as any).buildings.find(
        (v: any) => v.id === b.id,
      ).assigned_at,
    ).toBeNull();
  });
  it('facture chaque case de route à une pièce, selon le catalogue serveur', async () => {
    const rules = (await admin("select value from public.game_rules where key='buildings'"))[0]
      .value as any;
    expect(rules.road.price).toBe(1);
    expect(BUILDINGS.road.price).toBe(1);
    const p = await freeCell();
    await action('build', { kind: 'road', ...p, price: 0 });
    expect(await gold()).toBe(99);
    await asUser(B);
    const p2 = await freeCell();
    await action('build', { kind: 'road', ...p2 });
    expect(await gold()).toBe(99);
  });
});
