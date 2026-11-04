-- Expand dimensions to 60x60; preserve relative layouts, IDs and growth timestamps.
begin;
insert into public.game_rules(key,value) values('world','{"size":60,"trees_per_day":10,"timezone":"Europe/Paris"}');
create or replace function public.is_land(x integer,y integer) returns boolean language sql immutable set search_path='' as $$
 select x between 0 and 59 and y between 0 and 59 and power(x-29.5,2)/676+power(y-29.5,2)/576<=1
$$;
-- Defer unique coordinate checks during translation so original positions cannot collide
-- temporarily with the translated positions of rows not yet updated.
alter table public.trees drop constraint trees_island_id_x_y_key;
alter table public.trees add constraint trees_island_id_x_y_key unique(island_id,x,y) deferrable initially immediate;
alter table public.farm_plots drop constraint farm_plots_island_id_x_y_key;
alter table public.farm_plots add constraint farm_plots_island_id_x_y_key unique(island_id,x,y) deferrable initially immediate;
set constraints trees_island_id_x_y_key, farm_plots_island_id_x_y_key deferred;
update public.trees set x=x+15,y=y+15 where island_id=(select island_id from public.shared_world where singleton=true);
update public.farm_plots set x=x+15,y=y+15 where island_id=(select island_id from public.shared_world where singleton=true);
update public.buildings set x=x+15,y=y+15 where island_id=(select island_id from public.shared_world where singleton=true);
set constraints trees_island_id_x_y_key, farm_plots_island_id_x_y_key immediate;
alter table public.shared_world add column last_tree_spawn_day date not null default ((now() at time zone 'Europe/Paris')::date-1);
create table public.tree_spawn_days(day date primary key,spawned integer not null check(spawned between 0 and 10),created_at timestamptz not null default now());
alter table public.tree_spawn_days enable row level security;
revoke all on public.tree_spawn_days from public,anon,authenticated;
create or replace function public.check_placement(p_island uuid,p_x integer,p_y integer,p_size integer,p_ignore uuid default null) returns boolean language sql stable set search_path='' as $$
 select p_size between 1 and 3 and p_x between 0 and 59 and p_y between 0 and 59 and not exists(
 select 1 from generate_series(p_x,p_x+p_size-1) as gx(cx) cross join generate_series(p_y,p_y+p_size-1) as gy(cy)
 where not public.is_land(cx,cy)
 or exists(select 1 from public.trees t where t.island_id=p_island and t.x=cx and t.y=cy)
 or exists(select 1 from public.farm_plots f where f.island_id=p_island and f.x=cx and f.y=cy)
 or exists(select 1 from public.buildings b where b.island_id=p_island and (p_ignore is null or b.id<>p_ignore) and cx>=b.x and cx<b.x+b.size and cy>=b.y and cy<b.y+b.size))
$$;

-- Private server scheduler. Caller supplies no date or quantity, including through RPC.
create function public.ensure_daily_trees() returns integer language plpgsql security definer set search_path='' as $$
declare w uuid; last_day date; today date:=(clock_timestamp() at time zone 'Europe/Paris')::date;
 d date; n int; total int:=0;
begin
 select island_id into strict w from public.shared_world where singleton=true;
 perform 1 from public.islands where id=w for update;
 select last_tree_spawn_day into last_day from public.shared_world where singleton=true;
 if last_day>=today then return 0;end if;
 for d in select generate_series(last_day+1,today,interval '1 day')::date loop
 insert into public.trees(island_id,x,y)
 select w,cx,cy from generate_series(0,59) as gx(cx) cross join generate_series(0,59) as gy(cy)
 where public.check_placement(w,cx,cy,1) and not (cx=30 and cy=31)
 order by random() limit 10;
 get diagnostics n=row_count;
 insert into public.tree_spawn_days(day,spawned) values(d,n);
 total:=total+n;
 end loop;
 update public.shared_world set last_tree_spawn_day=today,revision=revision+1 where singleton=true;
 return total;
end $$;
revoke all on function public.ensure_daily_trees() from public,anon,authenticated;
create or replace function public.load_world(p_owner uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); target uuid; isl public.islands; result jsonb; begin
 if u is null then raise exception 'Connexion requise';end if;
 target:=u;
 if not exists(select 1 from public.profiles where id=u) then return null;end if;
 perform public.ensure_daily_trees();
 select i.* into isl from public.islands i join public.shared_world w on w.island_id=i.id;
 if not found then return null;end if;
 select jsonb_build_object(
 'island',jsonb_build_object('id',isl.id,'owner_id',isl.owner_id,'name',isl.name,'gold',(select gold from public.profiles where id=u),'score',isl.score),
 'profile',(select jsonb_build_object('id',id,'username',username,'tutorial_step',case when target=u then tutorial_step else 5 end,'is_admin',case when target=u then is_admin else false end) from public.profiles where id=target),
 'avatar',(select to_jsonb(a)-'user_id' from public.avatars a where user_id=target),
 'inventory',case when target=u then coalesce((select jsonb_object_agg(item,quantity) from public.inventories where user_id=u),'{}'::jsonb) else '{}'::jsonb end,
 'trees',coalesce((select jsonb_agg(to_jsonb(t)-'island_id' order by id) from public.trees t where island_id=isl.id),'[]'::jsonb),
 'plots',coalesce((select jsonb_agg(to_jsonb(p)-'island_id' order by id) from public.farm_plots p where island_id=isl.id),'[]'::jsonb),
 'plantations',coalesce((select jsonb_agg(to_jsonb(p)) from public.plantations p join public.farm_plots f on f.id=p.plot_id where f.island_id=isl.id),'[]'::jsonb),
 'buildings',coalesce((select jsonb_agg(to_jsonb(b)-'island_id') from public.buildings b where island_id=isl.id),'[]'::jsonb),
 'server_time',clock_timestamp()) into result;
 return result;
end $$;
create or replace function public.game_action(p_action text,p_payload jsonb,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare u uuid:=auth.uid(); prof public.profiles; isl public.islands; timing jsonb; cfg jsonb; prior public.economy_transactions; tr public.trees; pl public.plantations; bd public.buildings;
 cost bigint:=0; reward bigint:=0; qty integer; stock integer; v_item text; kind text; xx integer; yy integer; sz integer; a text; ts timestamptz:=clock_timestamp();
begin
 if u is null then raise exception 'Connexion requise';end if;
 if p_request is null or p_payload is null or p_action is null then raise exception 'Requête invalide';end if;
 -- All world mutations and daily spawning use the same island lock.
 perform public.ensure_daily_trees();
 select i.* into strict isl from public.islands i join public.shared_world w on w.island_id=i.id for update of i;
 select * into prof from public.profiles where id=u for update;
 if not found then raise exception 'Créez votre village';end if;
 select * into prior from public.economy_transactions where user_id=u and request_id=p_request;
 if found then
 if prior.action<>p_action or prior.payload<>p_payload then raise exception 'Identifiant de requête réutilisé';end if;
 return jsonb_build_object('replayed',true,'gold_delta',prior.gold_delta);
 end if;
 if prof.last_action_at is not null and ts-prof.last_action_at<interval '150 milliseconds' then raise exception 'Action trop rapide, réessayez';end if;

 select value into timing from public.game_rules where key='timing';
 if p_action='chop' then
 select * into tr from public.trees where id=(p_payload->>'id')::bigint and island_id=isl.id for update;
 if not found then raise exception 'Arbre introuvable sur votre île';end if;
 if tr.cut_at is not null and ts<tr.cut_at+make_interval(secs=>(timing->>'regrow_seconds')::int) then raise exception 'Cet arbre repousse';end if;
 update public.trees set cut_at=ts where id=tr.id;
 update public.inventories set quantity=quantity+(timing->>'tree_wood')::int where user_id=u and item='wood';
 elsif p_action='sell' then
 v_item:=p_payload->>'item';qty:=(p_payload->>'quantity')::integer;
 if qty is null or qty<=0 then raise exception 'Quantité invalide';end if;
 select quantity into stock from public.inventories i where user_id=u and i.item=v_item for update;
 if stock is null or stock<qty then raise exception 'Stock insuffisant';end if;
 if v_item='wood' then reward:=qty::bigint*(timing->>'wood_price')::int;
 else select value->v_item into cfg from public.game_rules where key='crops';reward:=qty::bigint*(cfg->>'price')::int;end if;
 if reward is null then raise exception 'Ressource invalide';end if;
 update public.inventories i set quantity=quantity-qty where user_id=u and i.item=v_item;
 elsif p_action in ('plant','harvest','clear') then
 perform 1 from public.farm_plots where id=(p_payload->>'id')::bigint and island_id=isl.id for update;
 if not found then raise exception 'Parcelle introuvable sur votre île';end if;
 select * into pl from public.plantations where plot_id=(p_payload->>'id')::bigint for update;
 if p_action='plant' then
 if found then raise exception 'Parcelle occupée';end if;
 kind:=p_payload->>'crop'; select value->kind into cfg from public.game_rules where key='crops';
 if cfg is null then raise exception 'Culture inconnue';end if;
 cost:=(cfg->>'seed')::int;
 insert into public.plantations(plot_id,crop,planted_at) values((p_payload->>'id')::bigint,kind,ts);
 else
 if not found then raise exception 'Parcelle vide';end if;
 if p_action='harvest' then
 if ts<pl.planted_at+make_interval(secs=>(timing->>'mature_seconds')::int) then raise exception 'Plantation encore en croissance';end if;
 if ts>=pl.planted_at+make_interval(secs=>(timing->>'wither_seconds')::int) then raise exception 'Plantation fanée';end if;
 select value->pl.crop into cfg from public.game_rules where key='crops';
 update public.inventories set quantity=quantity+(cfg->>'yield')::int where user_id=u and item=pl.crop;
 else
 if ts<pl.planted_at+make_interval(secs=>(timing->>'wither_seconds')::int) then raise exception 'Plantation non fanée';end if;
 end if;
 delete from public.plantations where plot_id=pl.plot_id;
 end if;
 elsif p_action in ('build','move') then
 xx:=(p_payload->>'x')::int;yy:=(p_payload->>'y')::int;
 if xx is null or yy is null then raise exception 'Position invalide';end if;
 if p_action='move' then
 select * into bd from public.buildings where id=(p_payload->>'id')::uuid and island_id=isl.id for update;
 if not found then raise exception 'Bâtiment introuvable sur votre île';end if;
 if bd.created_by is distinct from u and not prof.is_admin then raise exception 'Seul le constructeur ou un administrateur peut déplacer ce bâtiment';end if;
 kind:=bd.kind;sz:=bd.size;
 else
 kind:=p_payload->>'kind';select value->kind into cfg from public.game_rules where key='buildings';
 if cfg is null then raise exception 'Bâtiment inconnu';end if;
 sz:=(cfg->>'size')::int;cost:=(cfg->>'price')::int;
 end if;
 if not public.check_placement(isl.id,xx,yy,sz,bd.id) then raise exception 'Emplacement indisponible';end if;
 if p_action='move' then update public.buildings set x=xx,y=yy where id=bd.id;
 else
 insert into public.buildings(island_id,kind,x,y,size,created_by) values(isl.id,kind,xx,yy,sz,u);
 update public.islands set score=score+(cfg->>'points')::int where id=isl.id;
 end if;
 elsif p_action='assign' then
 select * into bd from public.buildings where id=(p_payload->>'id')::uuid and island_id=isl.id for update;
 if not found then raise exception 'Maison introuvable';end if;
 if bd.kind not in ('cottage','house') then raise exception 'Seules les maisons peuvent être attribuées';end if;
 if bd.created_by is distinct from u and not prof.is_admin then raise exception 'Seul le constructeur ou un administrateur peut attribuer cette maison';end if;
 if nullif(p_payload->>'user_id','') is not null and not exists(select 1 from public.profiles where id=(p_payload->>'user_id')::uuid) then raise exception 'Utilisateur introuvable';end if;
 update public.buildings set assigned_to=nullif(p_payload->>'user_id','')::uuid where id=bd.id;
 elsif p_action='avatar' then
 foreach a in array array['skin','hair','shirt','pants'] loop
 if coalesce(p_payload->>a,'') !~ '^#[0-9a-fA-F]{6}$' then raise exception 'Couleur invalide';end if;
 end loop;
 update public.avatars set skin=p_payload->>'skin',hair=p_payload->>'hair',shirt=p_payload->>'shirt',pants=p_payload->>'pants' where user_id=u;
 elsif p_action='tutorial' then
 qty:=(p_payload->>'step')::int;
 if qty is null or qty not between 0 and 5 then raise exception 'Étape invalide';end if;
 update public.profiles set tutorial_step=greatest(tutorial_step,qty) where id=u;
 else raise exception 'Action inconnue';end if;
 if prof.gold<cost then raise exception 'Fonds insuffisants';end if;
 update public.profiles set gold=gold-cost+reward where id=u;
 update public.shared_world set revision=revision+1 where singleton=true;
 update public.profiles set last_action_at=ts,
 tutorial_step=case when tutorial_step=1 and p_action='chop' then 2
 when tutorial_step=2 and p_action='sell' then 3
 when tutorial_step=3 and p_action='plant' then 4
 when tutorial_step=4 and p_action='build' then 5 else tutorial_step end where id=u;
 insert into public.economy_transactions(user_id,request_id,action,payload,gold_delta) values(u,p_request,p_action,p_payload,reward-cost);
 return jsonb_build_object('replayed',false,'gold_delta',reward-cost);
end $$;

-- Add today's batch now; future batches run on login/action and via Cron when available.
select public.ensure_daily_trees();
do $$ begin
 if exists(select 1 from pg_namespace where nspname='cron') then
 perform cron.schedule('island-daily-trees','*/5 * * * *','select public.ensure_daily_trees();');
 end if;
end $$;
commit;
