import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, it } from 'vitest';
import { BUILDINGS, CROPS, RULES } from '../src/config/game';
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

describe('Île commune et attribution', () => {
  it('donne à deux comptes la même carte, avec des portefeuilles distincts', async () => {
    const a = (await scalar('select public.load_world()')) as any;
    await asUser(B);
    const b = (await scalar('select public.load_world()')) as any;
    expect(a.island.id).toBe(b.island.id);
    expect(a.trees).toEqual(b.trees);
    expect(a.trees).toHaveLength(24);
    expect(a.plots).toHaveLength(8);
    expect(a.profile.id).toBe(A);
    expect(b.profile.id).toBe(B);
    await action('chop', { id: b.trees[0].id });
    expect(await inventory('wood')).toBe(5);
    await asUser(A);
    expect(await inventory('wood')).toBe(0);
  });
  it('conserve les anciens plans et soldes et évite les collisions', async () => {
    const w = (await scalar('select public.load_world()')) as any;
    expect(await gold()).toBe(100);
    expect(new Set(w.trees.map((t: any) => `${t.x},${t.y}`)).size).toBe(24);
    const archived = await admin('select * from public.legacy_world_archive');
    expect(archived).toHaveLength(2);
  });
  it('un nouvel habitant rejoint sans créer de nouvelle île ni ressources', async () => {
    const id = '00000000-0000-0000-0000-000000000003';
    const before = (await scalar('select public.load_world()')) as any;
    await admin('insert into auth.users values($1)', [id]);
    await asUser(id);
    await q('select public.create_village($1,$2,$3::jsonb)', [
      'Charlie',
      '',
      JSON.stringify(avatar),
    ]);
    const after = (await scalar('select public.load_world()')) as any;
    expect(after.island.id).toBe(before.island.id);
    expect(after.trees).toEqual(before.trees);
    expect(after.plots).toEqual(before.plots);
    expect(after.island.gold).toBe(100);
  });
  it('réserve un arbre globalement entre deux joueurs', async () => {
    const id = await treeId();
    await action('chop', { id });
    await asUser(B);
    await rejected(() => action('chop', { id }), /repousse/);
    expect(await inventory('wood')).toBe(0);
  });
  it('montre une construction et son attribution aux deux joueurs', async () => {
    await admin('update public.profiles set gold=500 where id=$1', [A]);
    // Pick a free footprint, independent of the migration relocation layout.
    const cells = await admin(
      "select x,y from generate_series(0,29)x cross join generate_series(0,29)y where public.check_placement('00000000-0000-0000-0000-000000000100',x,y,2) limit 1",
    );
    await action('build', { kind: 'cottage', ...cells[0] });
    await cooldown();
    let w = (await scalar('select public.load_world()')) as any;
    const id = w.buildings[0].id;
    await action('assign', { id, user_id: B });
    expect(await gold()).toBe(350);
    await asUser(B);
    w = (await scalar('select public.load_world()')) as any;
    expect(w.buildings[0]).toMatchObject({ id, created_by: A, assigned_to: B });
    expect(w.island.gold).toBe(100);
    await rejected(() => action('assign', { id, user_id: B }), /constructeur/);
    await rejected(() => action('move', { id, x: 15, y: 15 }), /constructeur/);
    await asUser(A);
    await cooldown();
    await action('assign', { id, user_id: null });
    expect(
      ((await scalar('select public.load_world()')) as any).buildings[0].assigned_to,
    ).toBeNull();
  });
  it('réserve les emplacements pour tous les bâtisseurs et refuse attribution aux commerces', async () => {
    await action('build', { kind: 'fountain', x: 15, y: 15 });
    const w = (await scalar('select public.load_world()')) as any;
    const id = w.buildings[0].id;
    await cooldown();
    await rejected(() => action('assign', { id, user_id: B }), /maisons/);
    await asUser(B);
    await rejected(() => action('build', { kind: 'fountain', x: 15, y: 15 }), /Emplacement/);
  });
  it('émet une révision transactionnelle et protège les modifications directes', async () => {
    const before = Number(await scalar('select revision from public.shared_world'));
    await action('chop', { id: await treeId() });
    expect(Number(await scalar('select revision from public.shared_world'))).toBe(before + 1);
    await rejected(() => q('update public.shared_world set revision=999'), /permission denied/);
    await rejected(() => q('update public.profiles set gold=999'), /permission denied/);
  });
  it('communauté : tous les habitants partagent le même identifiant d’île', async () => {
    const rows = await q('select * from public.community()');
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.island_id)).size).toBe(1);
  });
});

it('fusionne les maisons et cultures existantes sans perdre leur identité ni leur état', async () => {
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
    for (const [id, name] of [
      [A, 'Alice'],
      [B, 'Bob'],
    ]) {
      await legacy.query('insert into auth.users values($1)', [id]);
      await legacy.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
      await legacy.query('select public.create_village($1,$2,$3::jsonb)', [
        name,
        'Ancienne île',
        JSON.stringify(avatar),
      ]);
      await legacy.query(
        "insert into public.buildings(island_id,kind,x,y,size) select id,'cottage',15,15,2 from public.islands where owner_id=$1",
        [id],
      );
      await legacy.query(
        "insert into public.plantations(plot_id,crop,planted_at) select f.id,'carrot','2026-11-04T10:00:00Z'::timestamptz from public.farm_plots f join public.islands i on i.id=f.island_id where i.owner_id=$1",
        [id],
      );
    }
    const before = (await legacy.query('select * from public.buildings order by id')).rows as any[];
    await legacy.exec(
      readFileSync(
        new URL('../supabase/migrations/202611040002_shared_island.sql', import.meta.url),
        'utf8',
      ),
    );
    const after = (await legacy.query('select * from public.buildings order by id')).rows as any[];
    expect(after.map((b) => b.id)).toEqual(before.map((b) => b.id));
    expect(new Set(after.map((b) => b.island_id)).size).toBe(1);
    expect(after.every((b) => b.created_by === A || b.created_by === B)).toBe(true);
    const crops = (await legacy.query('select * from public.plantations')).rows as any[];
    expect(crops).toHaveLength(8);
    expect(
      crops.every((p) => new Date(p.planted_at).toISOString() === '2026-11-04T10:00:00.000Z'),
    ).toBe(true);
  } finally {
    await legacy.close();
  }
}, 60_000);
