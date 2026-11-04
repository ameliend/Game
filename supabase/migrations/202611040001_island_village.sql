-- All game writes go through authenticated, atomic SECURITY DEFINER functions.
begin;
create table public.game_rules (key text primary key, value jsonb not null);
insert into public.game_rules values
('timing','{"mature_seconds":28800,"wither_seconds":43200,"regrow_seconds":1800,"tree_wood":5,"wood_price":4,"initial_gold":100}'),
('crops','{"carrot":{"seed":5,"price":12,"yield":2},"wheat":{"seed":10,"price":18,"yield":2},"tomato":{"seed":20,"price":30,"yield":2},"strawberry":{"seed":35,"price":50,"yield":2}}'),
('buildings','{"cottage":{"price":150,"points":10,"size":2},"house":{"price":400,"points":25,"size":3},"bakery":{"price":300,"points":20,"size":2},"school":{"price":600,"points":40,"size":3},"supermarket":{"price":800,"points":20,"size":3},"townhall":{"price":1000,"points":70,"size":3},"restaurant":{"price":500,"points":20,"size":2},"hospital":{"price":1200,"points":60,"size":3},"park":{"price":250,"points":5,"size":2},"fountain":{"price":100,"points":5,"size":1},"road":{"price":10,"points":0,"size":1}}');
create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 username text not null check (username ~ '^[a-zA-Z0-9_]{3,20}$'),
 tutorial_step integer not null default 0 check (tutorial_step between 0 and 5),
 is_admin boolean not null default false,
 last_action_at timestamptz,
 last_chat_at timestamptz
);
create unique index profiles_username_unique on public.profiles(lower(username));
create table public.islands (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null unique references public.profiles(id) on delete cascade,
 name text not null check (char_length(name) between 2 and 30), gold bigint not null default 100 check(gold>=0), score integer not null default 0 check(score>=0)
);
create table public.avatars (user_id uuid primary key references public.profiles(id) on delete cascade, skin text not null, hair text not null, shirt text not null, pants text not null);
create table public.inventories (user_id uuid not null references public.profiles(id) on delete cascade,item text not null check(item in ('wood','carrot','wheat','tomato','strawberry')),quantity integer not null default 0 check(quantity>=0),primary key(user_id,item));
create table public.trees (id bigint generated always as identity primary key,island_id uuid not null references public.islands(id) on delete cascade,x integer not null,y integer not null,cut_at timestamptz,unique(island_id,x,y));
create table public.farm_plots (id bigint generated always as identity primary key,island_id uuid not null references public.islands(id) on delete cascade,x integer not null,y integer not null,unique(island_id,x,y));
create table public.plantations (plot_id bigint primary key references public.farm_plots(id) on delete cascade,crop text not null check(crop in ('carrot','wheat','tomato','strawberry')),planted_at timestamptz not null default now());
create table public.buildings (id uuid primary key default gen_random_uuid(),island_id uuid not null references public.islands(id) on delete cascade,kind text not null,x integer not null,y integer not null,size integer not null check(size between 1 and 3));
create table public.economy_transactions (id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id) on delete cascade,request_id uuid not null,action text not null,payload jsonb not null,gold_delta bigint not null,created_at timestamptz not null default now(),unique(user_id,request_id));
create table public.chat_messages(id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id) on delete cascade,username text not null,content text not null check(char_length(content) between 1 and 500),created_at timestamptz not null default now(),request_id uuid not null,unique(user_id,request_id));
create table public.chat_reports(message_id uuid not null references public.chat_messages(id) on delete cascade,reporter_id uuid not null references public.profiles(id) on delete cascade,created_at timestamptz not null default now(),primary key(message_id,reporter_id));
create index chat_messages_created on public.chat_messages(created_at desc);
create index buildings_island on public.buildings(island_id);
create index trees_island on public.trees(island_id);
create index farm_plots_island on public.farm_plots(island_id);
-- Enable RLS on every exposed table, revoke direct writes including catalog edits.
do $$ declare t text; begin
 foreach t in array array['game_rules','profiles','islands','avatars','inventories','trees','farm_plots','plantations','buildings','economy_transactions','chat_messages','chat_reports'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon, authenticated',t);
 end loop;
end $$;
grant select on public.chat_messages to authenticated;
create policy chat_read on public.chat_messages for select to authenticated using(true);
grant select on public.economy_transactions to authenticated;
create policy own_transactions on public.economy_transactions for select to authenticated using(user_id=auth.uid());
grant select on public.inventories to authenticated;
create policy own_inventory on public.inventories for select to authenticated using(user_id=auth.uid());
-- No general profile SELECT: community() exposes only safe, public fields.
create function public.is_land(x integer,y integer) returns boolean language sql immutable set search_path='' as $$
 select x between 0 and 29 and y between 0 and 29 and power(x-14.5,2)/169+power(y-14.5,2)/144<=1
$$;
create function public.check_placement(p_island uuid,p_x integer,p_y integer,p_size integer,p_ignore uuid default null) returns boolean language sql stable set search_path='' as $$
 select p_size between 1 and 3 and p_x between 0 and 29 and p_y between 0 and 29 and not exists(
 select 1 from generate_series(p_x,p_x+p_size-1) as gx(cx) cross join generate_series(p_y,p_y+p_size-1) as gy(cy)
 where not public.is_land(cx,cy)
 or exists(select 1 from public.trees t where t.island_id=p_island and t.x=cx and t.y=cy)
 or exists(select 1 from public.farm_plots f where f.island_id=p_island and f.x=cx and f.y=cy)
 or exists(select 1 from public.buildings b where b.island_id=p_island and (p_ignore is null or b.id<>p_ignore) and cx>=b.x and cx<b.x+b.size and cy>=b.y and cy<b.y+b.size))
$$;
create function public.create_village(p_username text,p_name text,p_avatar jsonb) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); isl uuid; a text; begin
 if u is null then raise exception 'Connexion requise'; end if;
 if exists(select 1 from public.profiles where id=u) then raise exception 'Village déjà créé';end if;
 if p_username is null or p_username !~ '^[a-zA-Z0-9_]{3,20}$' or p_name is null or char_length(trim(p_name)) not between 2 and 30 then raise exception 'Pseudonyme ou nom invalide';end if;
 foreach a in array array['skin','hair','shirt','pants'] loop
 if coalesce(p_avatar->>a,'') !~ '^#[0-9a-fA-F]{6}$' then raise exception 'Couleur invalide';end if;
 end loop;
 insert into public.profiles(id,username) values(u,p_username);
 insert into public.avatars values(u,p_avatar->>'skin',p_avatar->>'hair',p_avatar->>'shirt',p_avatar->>'pants');
 insert into public.islands(owner_id,name,gold) select u,trim(p_name),(value->>'initial_gold')::int from public.game_rules where key='timing' returning id into isl;
 insert into public.inventories(user_id,item) select u,unnest(array['wood','carrot','wheat','tomato','strawberry']);
 insert into public.trees(island_id,x,y) select isl,x,y from (values(6,10),(8,8),(10,6),(13,5),(18,6),(21,9),(23,13),(22,19),(18,23),(12,24),(7,20),(5,15)) v(x,y);
 insert into public.farm_plots(island_id,x,y) select isl,x,y from(values(12,12),(13,12),(12,13),(13,13)) v(x,y);
end $$;
create function public.load_world(p_owner uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); target uuid; isl public.islands; result jsonb; begin
 if u is null then raise exception 'Connexion requise';end if;
 target:=coalesce(p_owner,u);
 select * into isl from public.islands where owner_id=target;
 if not found then return null;end if;
 select jsonb_build_object(
 'island',jsonb_build_object('id',isl.id,'owner_id',isl.owner_id,'name',isl.name,'gold',case when target=u then isl.gold else 0 end,'score',isl.score),
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
create function public.game_action(p_action text,p_payload jsonb,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare u uuid:=auth.uid(); prof public.profiles; isl public.islands; timing jsonb; cfg jsonb; prior public.economy_transactions; tr public.trees; pl public.plantations; bd public.buildings;
 cost bigint:=0; reward bigint:=0; qty integer; stock integer; v_item text; kind text; xx integer; yy integer; sz integer; a text; ts timestamptz:=clock_timestamp();
begin
 if u is null then raise exception 'Connexion requise';end if;
 if p_request is null or p_payload is null or p_action is null then raise exception 'Requête invalide';end if;
 -- Per-owner lock serializes all mutations, including inventory, timestamps and placement.
 select * into prof from public.profiles where id=u for update;
 if not found then raise exception 'Créez votre village';end if;
 select * into prior from public.economy_transactions where user_id=u and request_id=p_request;
 if found then
 if prior.action<>p_action or prior.payload<>p_payload then raise exception 'Identifiant de requête réutilisé';end if;
 return jsonb_build_object('replayed',true,'gold_delta',prior.gold_delta);
 end if;
 if prof.last_action_at is not null and ts-prof.last_action_at<interval '150 milliseconds' then raise exception 'Action trop rapide, réessayez';end if;
 select * into strict isl from public.islands where owner_id=u for update;
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
 kind:=bd.kind;sz:=bd.size;
 else
 kind:=p_payload->>'kind';select value->kind into cfg from public.game_rules where key='buildings';
 if cfg is null then raise exception 'Bâtiment inconnu';end if;
 sz:=(cfg->>'size')::int;cost:=(cfg->>'price')::int;
 end if;
 if not public.check_placement(isl.id,xx,yy,sz,bd.id) then raise exception 'Emplacement indisponible';end if;
 if p_action='move' then update public.buildings set x=xx,y=yy where id=bd.id;
 else
 insert into public.buildings(island_id,kind,x,y,size) values(isl.id,kind,xx,yy,sz);
 update public.islands set score=score+(cfg->>'points')::int where id=isl.id;
 end if;
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
 if isl.gold<cost then raise exception 'Fonds insuffisants';end if;
 update public.islands set gold=gold-cost+reward where id=isl.id;
 update public.profiles set last_action_at=ts,
 tutorial_step=case when tutorial_step=1 and p_action='chop' then 2
 when tutorial_step=2 and p_action='sell' then 3
 when tutorial_step=3 and p_action='plant' then 4
 when tutorial_step=4 and p_action='build' then 5 else tutorial_step end where id=u;
 insert into public.economy_transactions(user_id,request_id,action,payload,gold_delta) values(u,p_request,p_action,p_payload,reward-cost);
 return jsonb_build_object('replayed',false,'gold_delta',reward-cost);
end $$;
create function public.community() returns table(id uuid,username text,island_name text,island_id uuid,score integer,building_count bigint) language sql security definer set search_path='' as $$
 select p.id,p.username,i.name,i.id,i.score,(select count(*) from public.buildings b where b.island_id=i.id) from public.profiles p join public.islands i on i.owner_id=p.id where auth.uid() is not null order by i.score desc,lower(p.username) limit 100
$$;
create function public.send_message(p_content text,p_request uuid) returns void language plpgsql security definer set search_path='' as $$
declare p public.profiles; ts timestamptz:=clock_timestamp();begin
 if auth.uid() is null then raise exception 'Connexion requise';end if;
 select * into p from public.profiles where id=auth.uid() for update;
 if not found then raise exception 'Créez votre village';end if;
 if exists(select 1 from public.chat_messages where user_id=p.id and request_id=p_request) then return;end if;
 if p.last_chat_at is not null and ts-p.last_chat_at<interval '2 seconds' then raise exception 'Patientez 2 secondes entre les messages';end if;
 if p_content is null or char_length(trim(p_content)) not between 1 and 500 then raise exception 'Message : 1 à 500 caractères';end if;
 insert into public.chat_messages(user_id,username,content,request_id,created_at) values(p.id,p.username,trim(p_content),p_request,ts);
 update public.profiles set last_chat_at=ts where id=p.id;
end $$;
create function public.delete_message(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Connexion requise';end if;
 delete from public.chat_messages where id=p_id and (user_id=auth.uid() or exists(select 1 from public.profiles where id=auth.uid() and is_admin));
 if not found then raise exception 'Suppression non autorisée';end if;
end $$;
create function public.report_message(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Connexion requise';end if;
 insert into public.chat_reports(message_id,reporter_id) values(p_id,auth.uid()) on conflict do nothing;
end $$;
-- PostgreSQL grants EXECUTE to PUBLIC by default; explicitly narrow every entrypoint.
revoke all on function public.is_land(integer,integer),public.check_placement(uuid,integer,integer,integer,uuid),public.create_village(text,text,jsonb),public.load_world(uuid),public.game_action(text,jsonb,uuid),public.community(),public.send_message(text,uuid),public.delete_message(uuid),public.report_message(uuid) from public,anon,authenticated;
grant execute on function public.create_village(text,text,jsonb),public.load_world(uuid),public.game_action(text,jsonb,uuid),public.community(),public.send_message(text,uuid),public.delete_message(uuid),public.report_message(uuid) to authenticated;
alter table public.chat_messages replica identity full;
-- Supabase provides the publication; a local test database may not.
do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
 alter publication supabase_realtime add table public.chat_messages;
 end if;
end $$;
commit;
