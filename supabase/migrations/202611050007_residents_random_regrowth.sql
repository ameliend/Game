begin;
create table public.player_presence(user_id uuid primary key references public.profiles(id) on delete cascade,island_id uuid not null references public.islands(id) on delete cascade,x integer not null,y integer not null,last_seen_at timestamptz not null default clock_timestamp());
alter table public.player_presence enable row level security;
revoke all on public.player_presence from public,anon,authenticated;
grant select on public.player_presence to authenticated;
create policy presence_read on public.player_presence for select to authenticated using(true);
create index player_presence_seen on public.player_presence(last_seen_at);
create function public.heartbeat_presence(p_x integer,p_y integer) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); w uuid;ts timestamptz:=clock_timestamp();begin
 if u is null or not exists(select 1 from public.profiles where id=u) then raise exception 'Connexion et profil requis';end if;
 if p_x is null or p_y is null or not public.is_land(p_x,p_y) then raise exception 'Position invalide';end if;
 select island_id into strict w from public.shared_world where singleton=true;
 insert into public.player_presence(user_id,island_id,x,y,last_seen_at) values(u,w,p_x,p_y,ts)
 on conflict(user_id) do update set island_id=excluded.island_id,x=excluded.x,y=excluded.y,last_seen_at=excluded.last_seen_at
 where public.player_presence.last_seen_at<=ts-interval '200 milliseconds';
end $$;
create function public.online_residents() returns jsonb language sql security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'username',p.username,'island',s.island_id,'x',s.x,'y',s.y,'avatar',to_jsonb(a)-'user_id') order by p.id),'[]'::jsonb) from public.player_presence s join public.profiles p on p.id=s.user_id join public.avatars a on a.user_id=p.id where auth.uid() is not null and s.last_seen_at>clock_timestamp()-interval '90 seconds'
$$;
create function public.leave_presence() returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Connexion requise';end if;
 delete from public.player_presence where user_id=auth.uid();
end $$;
revoke all on function public.heartbeat_presence(integer,integer),public.online_residents(),public.leave_presence() from public,anon,authenticated;
grant execute on function public.heartbeat_presence(integer,integer),public.online_residents(),public.leave_presence() to authenticated;
-- Pending cut trees no longer occupy their previous coordinates.
alter table public.trees drop constraint trees_island_id_x_y_key;
create unique index active_tree_coordinates on public.trees(island_id,x,y) where cut_at is null;
create or replace function public.check_placement(p_island uuid,p_x integer,p_y integer,p_size integer,p_ignore uuid default null) returns boolean language sql stable set search_path='' as $$
 select p_size between 1 and 4 and p_x between 0 and 59 and p_y between 0 and 59 and not exists(
 select 1 from generate_series(p_x,p_x+p_size-1) as gx(cx) cross join generate_series(p_y,p_y+p_size-1) as gy(cy)
 where not public.is_land(cx,cy)
 or exists(select 1 from public.trees t where t.island_id=p_island and t.cut_at is null and t.x=cx and t.y=cy)
 or exists(select 1 from public.farm_plots f where f.island_id=p_island and f.x=cx and f.y=cy)
 or exists(select 1 from public.buildings b where b.island_id=p_island and (p_ignore is null or b.id<>p_ignore) and cx>=b.x and cx<b.x+b.size and cy>=b.y and cy<b.y+b.size))
$$;


create or replace function public.ensure_daily_trees() returns integer language plpgsql security definer set search_path='' as $$
declare w uuid; last_day date; today date:=(clock_timestamp() at time zone 'Europe/Paris')::date;
 d date; n int; total int:=0; tr public.trees; xx int; yy int; regrow int;
begin
 select island_id into strict w from public.shared_world where singleton=true;
 perform 1 from public.islands where id=w for update;
 select (value->>'regrow_seconds')::int into regrow from public.game_rules where key='timing';
 for tr in select * from public.trees where island_id=w and cut_at is not null and cut_at<=clock_timestamp()-make_interval(secs=>regrow) order by cut_at,id for update loop
 select cx,cy into xx,yy from generate_series(0,59) gx(cx) cross join generate_series(0,59) gy(cy)
 where public.check_placement(w,cx,cy,1) and not(cx=tr.x and cy=tr.y) and not(cx=30 and cy=31)
 and not exists(select 1 from public.player_presence p where p.island_id=w and p.x=cx and p.y=cy and p.last_seen_at>clock_timestamp()-interval '90 seconds')
 order by random() limit 1;
 if found then update public.trees set x=xx,y=yy,cut_at=null where id=tr.id;total:=total+1;end if;
 end loop;
 select last_tree_spawn_day into last_day from public.shared_world where singleton=true;
 if last_day<today then
 for d in select generate_series(last_day+1,today,interval '1 day')::date loop
 insert into public.trees(island_id,x,y)
 select w,cx,cy from generate_series(0,59) gx(cx) cross join generate_series(0,59) gy(cy)
 where public.check_placement(w,cx,cy,1) and not(cx=30 and cy=31)
 and not exists(select 1 from public.player_presence p where p.island_id=w and p.x=cx and p.y=cy and p.last_seen_at>clock_timestamp()-interval '90 seconds')
 order by random() limit 10;
 get diagnostics n=row_count;
 insert into public.tree_spawn_days(day,spawned) values(d,n);total:=total+n;
 end loop;
 update public.shared_world set last_tree_spawn_day=today where singleton=true;
 end if;
 if total>0 then update public.shared_world set revision=revision+1 where singleton=true;end if;
 return total;
end $$;
create or replace function public.load_world(p_owner uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); target uuid; isl public.islands; result jsonb; begin
 if u is null then raise exception 'Connexion requise';end if;
 target:=u;
 if not exists(select 1 from public.profiles where id=u) then return null;end if;
 perform public.ensure_daily_trees();
 perform public.ensure_civic_state();
 select i.* into isl from public.islands i join public.shared_world w on w.island_id=i.id;
 if not found then return null;end if;
 select jsonb_build_object(
 'island',jsonb_build_object('id',isl.id,'owner_id',isl.owner_id,'name',isl.name,'gold',(select gold from public.profiles where id=u),'score',isl.score),
 'profile',(select jsonb_build_object('id',id,'username',username,'tutorial_step',case when target=u then tutorial_step else 5 end,'is_admin',case when target=u then is_admin else false end) from public.profiles where id=target),
 'avatar',(select to_jsonb(a)-'user_id' from public.avatars a where user_id=target),
 'inventory',case when target=u then coalesce((select jsonb_object_agg(item,quantity) from public.inventories where user_id=u),'{}'::jsonb) else '{}'::jsonb end,
 'trees',coalesce((select jsonb_agg(to_jsonb(t)-'island_id' order by id) from public.trees t where island_id=isl.id and cut_at is null),'[]'::jsonb),
 'plots',coalesce((select jsonb_agg(to_jsonb(p)-'island_id' order by id) from public.farm_plots p where island_id=isl.id),'[]'::jsonb),
 'plantations',coalesce((select jsonb_agg(to_jsonb(p)) from public.plantations p join public.farm_plots f on f.id=p.plot_id where f.island_id=isl.id),'[]'::jsonb),
 'buildings',coalesce((select jsonb_agg(to_jsonb(b)-'island_id') from public.buildings b where island_id=isl.id),'[]'::jsonb),
 'governance',public.civic_view(),
 'server_time',clock_timestamp()) into result;
 return result;
end $$;
create or replace function public.game_action(p_action text,p_payload jsonb,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare u uuid:=auth.uid(); prof public.profiles; isl public.islands; timing jsonb; cfg jsonb; prior public.economy_transactions; tr public.trees; pl public.plantations; bd public.buildings;
 cost bigint:=0; reward bigint:=0; qty integer; stock integer; v_item text; kind text; xx integer; yy integer; sz integer; a text; ts timestamptz:=clock_timestamp(); cycle bigint; e public.elections; regime text;
begin
 if u is null then raise exception 'Connexion requise';end if;
 if p_request is null or p_payload is null or p_action is null then raise exception 'Requête invalide';end if;
 -- All world mutations and daily spawning use the same island lock.
 perform public.ensure_daily_trees();
 perform public.ensure_civic_state();
 select i.* into strict isl from public.islands i join public.shared_world w on w.island_id=i.id for update of i;
 select * into prof from public.profiles where id=u for update;
 if not found then raise exception 'Créez votre village';end if;
 select * into prior from public.economy_transactions where user_id=u and request_id=p_request;
 if found then
 if prior.action<>p_action or prior.payload<>p_payload then raise exception 'Identifiant de requête réutilisé';end if;
 return jsonb_build_object('replayed',true,'gold_delta',prior.gold_delta);
 end if;
 if prof.last_action_at is not null and ts-prof.last_action_at<interval '150 milliseconds' then raise exception 'Action trop rapide, réessayez';end if;

 ts:=clock_timestamp();
 select value into timing from public.game_rules where key='timing';
 if p_action='chop' then
 select * into tr from public.trees where id=(p_payload->>'id')::bigint and island_id=isl.id for update;
 if not found then raise exception 'Arbre introuvable sur votre île';end if;
 if tr.cut_at is not null then raise exception 'Cet arbre repousse';end if;
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
 elsif p_action='add_plot' then
 xx:=(p_payload->>'x')::int;yy:=(p_payload->>'y')::int;
 if xx is null or yy is null then raise exception 'Position invalide';end if;
 if not public.check_placement(isl.id,xx,yy,1) then raise exception 'Emplacement indisponible';end if;
 select value into cfg from public.game_rules where key='farm_plot';
 cost:=(cfg->>'price')::bigint;
 if cost is null or cost<0 then raise exception 'Configuration parcelle invalide';end if;
 insert into public.farm_plots(island_id,x,y) values(isl.id,xx,yy);
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
 elsif p_action='claim_income' then
 select * into bd from public.buildings where id=(p_payload->>'id')::uuid and island_id=isl.id for update;
 if not found then raise exception 'Commerce introuvable';end if;
 select value->bd.kind into cfg from public.game_rules where key='buildings';
 if not coalesce((cfg->>'commerce')::boolean,false) then raise exception 'Ce bâtiment ne produit pas de revenu';end if;
 select value into cfg from public.game_rules where key='civic';
 cycle:=floor(extract(epoch from (ts-bd.built_at))/(cfg->>'income_seconds')::int)::bigint;
 if cycle<1 or bd.income_claimed_cycle>=cycle then raise exception 'Revenu pas encore disponible ou déjà récupéré';end if;
 select w.regime into regime from public.shared_world w where singleton=true;
 if regime='capitalism' and bd.created_by is distinct from u then raise exception 'Seul le constructeur peut récupérer ce revenu en capitalisme';end if;
 reward:=(cfg->>'income_gold')::bigint;
 update public.buildings set income_claimed_cycle=cycle where id=bd.id;
 insert into public.commerce_claims(building_id,cycle,user_id,amount) values(bd.id,cycle,u,reward);
 elsif p_action='vote' then
 select * into e from public.elections where id=(p_payload->>'election_id')::uuid for update;
 if not found or e.finalized_at is not null or ts<e.starts_at or ts>=e.closes_at then raise exception 'Le scrutin est fermé';end if;
 if (p_payload->>'candidate_id')::uuid=u then raise exception 'Impossible de voter pour soi';end if;
 if not exists(select 1 from public.election_candidates where election_id=e.id and user_id=(p_payload->>'candidate_id')::uuid) then raise exception 'Candidat introuvable';end if;
 if exists(select 1 from public.election_votes where election_id=e.id and voter_id=u) then raise exception 'Vous avez déjà voté';end if;
 insert into public.election_votes(election_id,voter_id,candidate_id) values(e.id,u,(p_payload->>'candidate_id')::uuid);
 elsif p_action='set_regime' then
 if not exists(select 1 from public.shared_world where singleton=true and mayor_id=u) then raise exception 'Seul le maire peut choisir le régime';end if;
 if p_payload->>'regime' is null or p_payload->>'regime' not in ('communism','capitalism') then raise exception 'Régime invalide';end if;
 update public.shared_world set regime=p_payload->>'regime' where singleton=true;
 elsif p_action='assign' then
 select * into bd from public.buildings where id=(p_payload->>'id')::uuid and island_id=isl.id for update;
 if not found then raise exception 'Maison introuvable';end if;
 if bd.kind not in ('cottage','house') then raise exception 'Seules les maisons peuvent être attribuées';end if;
 if bd.assigned_at is not null or bd.assigned_to is not null then raise exception 'Cette maison est déjà attribuée définitivement';end if;
 if nullif(p_payload->>'user_id','') is null then raise exception 'Choisissez un utilisateur';end if;
 if bd.created_by is distinct from u and not prof.is_admin then raise exception 'Seul le constructeur ou un administrateur peut attribuer cette maison';end if;
 if nullif(p_payload->>'user_id','') is not null and not exists(select 1 from public.profiles where id=(p_payload->>'user_id')::uuid) then raise exception 'Utilisateur introuvable';end if;
 update public.buildings set assigned_to=(p_payload->>'user_id')::uuid,assigned_at=ts where id=bd.id;
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
 perform public.ensure_civic_state();
 insert into public.economy_transactions(user_id,request_id,action,payload,gold_delta) values(u,p_request,p_action,p_payload,reward-cost);
 return jsonb_build_object('replayed',false,'gold_delta',reward-cost);
end $$;



select public.ensure_daily_trees();
update public.shared_world set revision=revision+1 where singleton=true;
do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then alter publication supabase_realtime add table public.player_presence;end if;
 if exists(select 1 from pg_namespace where nspname='cron') then perform cron.schedule('island-daily-trees','* * * * *','select public.ensure_daily_trees();');end if;
end $$;
commit;
