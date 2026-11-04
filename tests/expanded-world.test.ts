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
  await db.exec(
    readFileSync(
      new URL('../supabase/migrations/202611040003_expand_daily_trees.sql', import.meta.url),
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

describe('Terrain agrandi et arbres quotidiens', () => {
  it('conserve les positions relatives avec un décalage de 15 cases et ouvre les nouvelles zones', async () => {
    const w = (await scalar('select public.load_world()')) as any;
    expect(w.trees.find((t: any) => t.id === 1)).toMatchObject({ x: 21, y: 25 });
    expect(w.plots[0]).toMatchObject({ x: 27, y: 27 });
    const rows = await admin(
      'select public.is_land(40,40) as land, public.is_land(60,30) as outside',
    );
    expect(rows[0]).toEqual({ land: true, outside: false });
  });
  it('génère exactement dix arbres pour le jour courant et pas dix par joueur', async () => {
    const first = (await scalar('select public.load_world()')) as any;
    expect(first.trees).toHaveLength(34);
    await asUser(B);
    const second = (await scalar('select public.load_world()')) as any;
    expect(second.trees).toEqual(first.trees);
    expect(await admin('select * from public.tree_spawn_days')).toHaveLength(1);
    expect((await admin('select spawned from public.tree_spawn_days'))[0].spawned).toBe(10);
  });
  it('génère sur des cases distinctes, à terre, hors des cultures, bâtiments et point d’arrivée', async () => {
    const rows = await admin(
      'select t.x,t.y,public.is_land(t.x,t.y) as land, exists(select 1 from public.farm_plots f where f.x=t.x and f.y=t.y) as occupied from public.trees t where t.id>24',
    );
    expect(rows).toHaveLength(10);
    expect(new Set(rows.map((r) => `${r.x},${r.y}`)).size).toBe(10);
    for (const r of rows) {
      expect(r.land).toBe(true);
      expect(r.occupied).toBe(false);
      expect(r.x === 30 && r.y === 31).toBe(false);
    }
  });
  it('rattrape les jours manqués une seule fois même après plusieurs chargements', async () => {
    await admin(
      "delete from public.tree_spawn_days where day=(clock_timestamp() at time zone 'Europe/Paris')::date",
    );
    await admin(
      "update public.shared_world set last_tree_spawn_day=(clock_timestamp() at time zone 'Europe/Paris')::date-3 where singleton=true",
    );
    const w = (await scalar('select public.load_world()')) as any;
    expect(w.trees).toHaveLength(64);
    await asUser(B);
    expect(((await scalar('select public.load_world()')) as any).trees).toHaveLength(64);
    expect(await admin('select * from public.tree_spawn_days')).toHaveLength(3);
  });
  it('ne permet pas de choisir une date future ni d’appeler le générateur directement', async () => {
    await rejected(() => q('select public.ensure_daily_trees()'), /permission denied/);
    const w = (await scalar('select public.load_world()')) as any;
    expect(w.trees).toHaveLength(34);
  });
  it('ne fait apparaître aucun arbre dans un monde plein et journalise zéro', async () => {
    await admin(
      "delete from public.tree_spawn_days where day=(clock_timestamp() at time zone 'Europe/Paris')::date",
    );
    await admin(
      "update public.shared_world set last_tree_spawn_day=(clock_timestamp() at time zone 'Europe/Paris')::date-1 where singleton=true",
    );
    await admin(
      "insert into public.buildings(island_id,kind,x,y,size,created_by) select w.island_id,'road',x,y,1,$1 from public.shared_world w cross join generate_series(0,59)x cross join generate_series(0,59)y where public.check_placement(w.island_id,x,y,1)",
      [A],
    );
    const count = ((await scalar('select public.load_world()')) as any).trees.length;
    expect(count).toBe(34);
    expect((await admin('select spawned from public.tree_spawn_days'))[0].spawned).toBe(0);
  });
  it('C’est parti : sauvegarde le tutoriel avec une révision ciblée et idempotente', async () => {
    const request = crypto.randomUUID();
    const before = Number(await scalar('select revision from public.shared_world'));
    await action('tutorial', { step: 1 }, request);
    await action('tutorial', { step: 1 }, request);
    const w = (await scalar('select public.load_world()')) as any;
    expect(w.profile.tutorial_step).toBe(1);
    expect(Number(await scalar('select revision from public.shared_world'))).toBe(before + 1);
    const rows = await admin(
      "select pg_get_functiondef('public.game_action(text,jsonb,uuid)'::regprocedure) as definition",
    );
    expect(rows[0].definition).toContain(
      'update public.shared_world set revision=revision+1 where singleton=true;',
    );
  });
});
