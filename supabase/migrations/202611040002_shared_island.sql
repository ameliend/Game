-- Upgrade private islands to one shared world. Existing wallets and entities survive.
begin;
alter table public.profiles add column gold bigint not null default 100 check(gold>=0);
update public.profiles p set gold=i.gold from public.islands i where i.owner_id=p.id;
alter table public.islands alter column owner_id drop not null;
insert into public.islands(id,owner_id,name,gold,score) values('00000000-0000-0000-0000-000000000100',null,'Beuteu Island',0,0);
create table public.shared_world(singleton boolean primary key default true check(singleton),island_id uuid not null unique references public.islands(id),revision bigint not null default 0);
insert into public.shared_world(island_id) values('00000000-0000-0000-0000-000000000100');
alter table public.shared_world enable row level security;
revoke all on public.shared_world from anon,authenticated;
grant select on public.shared_world to authenticated;
create policy world_read on public.shared_world for select to authenticated using(true);
alter table public.buildings add column created_by uuid references public.profiles(id) on delete set null;
alter table public.buildings add column assigned_to uuid references public.profiles(id) on delete set null;
alter table public.buildings add constraint houses_only_assignment check(assigned_to is null or kind in ('cottage','house'));
update public.buildings b set created_by=i.owner_id from public.islands i where b.island_id=i.id;
-- Preserve a snapshot of the original layouts before collision-safe consolidation.
create table public.legacy_world_archive(island_id uuid primary key,snapshot jsonb not null);
alter table public.legacy_world_archive enable row level security;
revoke all on public.legacy_world_archive from anon,authenticated;
insert into public.legacy_world_archive
select i.id,jsonb_build_object('island',to_jsonb(i),'trees',(select jsonb_agg(t) from public.trees t where t.island_id=i.id),'plots',(select jsonb_agg(f) from public.farm_plots f where f.island_id=i.id),'plantations',(select jsonb_agg(p) from public.plantations p join public.farm_plots f on f.id=p.plot_id where f.island_id=i.id),'buildings',(select jsonb_agg(b) from public.buildings b where b.island_id=i.id)) from public.islands i where i.owner_id is not null;
-- Retain IDs, growing crops and cut timestamps. Relocate overlapping footprints.
do $$ declare r record; tab text; xx int; yy int; sz int; placed boolean; w uuid:='00000000-0000-0000-0000-000000000100';begin
 foreach tab in array array['trees','farm_plots','buildings'] loop
 for r in execute format('select id::text as id,x,y,%s as size from public.%I order by id',case when tab='buildings' then 'size' else '1' end,tab) loop
 xx:=r.x;yy:=r.y;sz:=r.size;placed:=public.check_placement(w,xx,yy,sz);
 if not placed then
 select gx.cx,gy.cy into xx,yy from generate_series(0,29) as gx(cx) cross join generate_series(0,29) as gy(cy) where public.check_placement(w,gx.cx,gy.cy,sz) order by gx.cx,gy.cy limit 1;
 placed:=found;
 end if;
 if not placed then raise exception 'Fusion annulée : île pleine. Aucune donnée modifiée.';end if;
 execute format('update public.%I set island_id=$1,x=$2,y=$3 where id::text=$4',tab) using w,xx,yy,r.id;
 end loop;end loop;
 if not exists(select 1 from public.trees) then
 insert into public.trees(island_id,x,y) select w,x,y from(values(6,10),(8,8),(10,6),(13,5),(18,6),(21,9),(23,13),(22,19),(18,23),(12,24),(7,20),(5,15)) v(x,y);
 end if;
 if not exists(select 1 from public.farm_plots) then
 insert into public.farm_plots(island_id,x,y) select w,x,y from(values(12,12),(13,12),(12,13),(13,13)) v(x,y);
 end if;
 update public.islands set score=coalesce((select sum((g.value->b.kind->>'points')::int) from public.buildings b cross join public.game_rules g where g.key='buildings'),0) where id=w;
end $$;

create or replace function public.create_village(p_username text,p_name text,p_avatar jsonb) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); isl uuid; a text; begin
 if u is null then raise exception 'Connexion requise'; end if;
 if exists(select 1 from public.profiles where id=u) then raise exception 'Village déjà créé';end if;
 if p_username is null or p_username !~ '^[a-zA-Z0-9_]{3,20}$' then raise exception 'Pseudonyme ou nom invalide';end if;
 foreach a in array array['skin','hair','shirt','pants'] loop
 if coalesce(p_avatar->>a,'') !~ '^#[0-9a-fA-F]{6}$' then raise exception 'Couleur invalide';end if;
 end loop;
 insert into public.profiles(id,username) values(u,p_username);
 insert into public.avatars values(u,p_avatar->>'skin',p_avatar->>'hair',p_avatar->>'shirt',p_avatar->>'pants');
 insert into public.inventories(user_id,item) select u,unnest(array['wood','carrot','wheat','tomato','strawberry']);
end $$;
create or replace function public.load_world(p_owner uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); target uuid; isl public.islands; result jsonb; begin
 if u is null then raise exception 'Connexion requise';end if;
 target:=u;
 if not exists(select 1 from public.profiles where id=u) then return null;end if;
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
 -- Per-owner lock serializes all mutations, including inventory, timestamps and placement.
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
 update public.shared_world set revision=revision+1;
 update public.profiles set last_action_at=ts,
 tutorial_step=case when tutorial_step=1 and p_action='chop' then 2
 when tutorial_step=2 and p_action='sell' then 3
 when tutorial_step=3 and p_action='plant' then 4
 when tutorial_step=4 and p_action='build' then 5 else tutorial_step end where id=u;
 insert into public.economy_transactions(user_id,request_id,action,payload,gold_delta) values(u,p_request,p_action,p_payload,reward-cost);
 return jsonb_build_object('replayed',false,'gold_delta',reward-cost);
end $$;
create or replace function public.community() returns table(id uuid,username text,island_name text,island_id uuid,score integer,building_count bigint) language sql security definer set search_path='' as $$
 select p.id,p.username,i.name,i.id,coalesce((select sum((g.value->b.kind->>'points')::int) from public.buildings b cross join public.game_rules g where b.created_by=p.id and g.key='buildings'),0)::int,(select count(*) from public.buildings b where b.created_by=p.id) from public.profiles p cross join public.shared_world w join public.islands i on i.id=w.island_id where auth.uid() is not null order by 5 desc,lower(p.username)
$$;
-- Notify all authenticated clients after a committed world mutation.
do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then alter publication supabase_realtime add table public.shared_world;end if;
end $$;
commit;
