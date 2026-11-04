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
describe('Achat de parcelles communes', () => {
  it('utilise le même prix que le catalogue frontend', async () => {
    const rows = await admin("select value from public.game_rules where key='farm_plot'");
    expect(rows[0].value).toEqual({ price: FARM_PLOT.price, size: 1 });
  });
  it('débite 25 pièces seulement après création et partage la parcelle', async () => {
    const w = (await scalar('select public.load_world()')) as any;
    const cell = await freeCell();
    const rev = Number(await scalar('select revision from public.shared_world'));
    await action('add_plot', { ...cell, price: 0, user_id: B });
    expect(await gold()).toBe(75);
    const own = (await scalar('select public.load_world()')) as any;
    expect(own.plots).toHaveLength(w.plots.length + 1);
    expect(Number(await scalar('select revision from public.shared_world'))).toBe(rev + 1);
    await asUser(B);
    const other = (await scalar('select public.load_world()')) as any;
    expect(other.plots).toEqual(own.plots);
    expect(await gold()).toBe(100);
  });
  it('refuse eau, arbres, parcelles existantes et coordonnées hors carte sans débit', async () => {
    const w = (await scalar('select public.load_world()')) as any;
    for (const cell of [
      { x: 0, y: 0 },
      { x: 60, y: 30 },
      { x: w.trees[0].x, y: w.trees[0].y },
      { x: w.plots[0].x, y: w.plots[0].y },
    ])
      await rejected(() => action('add_plot', cell), /Emplacement indisponible/);
    await rejected(() => action('add_plot', {}), /Position invalide/);
    expect(await gold()).toBe(100);
    expect(((await scalar('select public.load_world()')) as any).plots).toHaveLength(
      w.plots.length,
    );
  });
  it('refuse une case bâtie', async () => {
    const cell = await freeCell();
    await action('build', { kind: 'road', ...cell });
    await cooldown();
    await rejected(() => action('add_plot', cell), /Emplacement indisponible/);
    expect(await gold()).toBe(90);
  });
  it('annule toute création en cas de fonds insuffisants', async () => {
    await admin('update public.profiles set gold=24 where id=$1', [A]);
    const cell = await freeCell();
    const before = (await scalar('select public.load_world()')) as any;
    await rejected(() => action('add_plot', cell), /Fonds insuffisants/);
    expect(await gold()).toBe(24);
    expect(((await scalar('select public.load_world()')) as any).plots).toEqual(before.plots);
  });
  it('ne facture pas deux fois un rejeu et réserve la case entre deux utilisateurs', async () => {
    const cell = await freeCell();
    const request = crypto.randomUUID();
    await action('add_plot', cell, request);
    expect(((await action('add_plot', cell, request)) as any).replayed).toBe(true);
    expect(await gold()).toBe(75);
    await asUser(B);
    await rejected(() => action('add_plot', cell), /Emplacement indisponible/);
    expect(await gold()).toBe(100);
  });
  it('permet de planter sur la nouvelle parcelle', async () => {
    const cell = await freeCell();
    await action('add_plot', cell);
    await cooldown();
    const w = (await scalar('select public.load_world()')) as any;
    const p = w.plots.find((p: any) => p.x === cell.x && p.y === cell.y);
    await action('plant', { id: p.id, crop: 'carrot' });
    expect(await gold()).toBe(70);
    expect(((await scalar('select public.load_world()')) as any).plantations).toContainEqual(
      expect.objectContaining({ plot_id: p.id, crop: 'carrot' }),
    );
  });
});
