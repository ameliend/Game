begin;
alter table public.buildings add column built_at timestamptz not null default clock_timestamp();
alter table public.buildings add column income_claimed_cycle bigint not null default 0 check(income_claimed_cycle>=0);
alter table public.buildings drop constraint buildings_size_check;
alter table public.buildings add constraint buildings_size_check check(size between 1 and 4);
update public.game_rules set value=jsonb_set(value,'{supermarket,size}','4'::jsonb)
 || '{"butcher":{"price":350,"points":20,"size":2},"pharmacy":{"price":450,"points":20,"size":2},"barber":{"price":250,"points":20,"size":2},"nail_salon":{"price":250,"points":20,"size":2}}'::jsonb where key='buildings';
update public.game_rules g set value=(select jsonb_object_agg(k,v||jsonb_build_object('commerce',k in ('bakery','supermarket','restaurant','butcher','pharmacy','barber','nail_salon'))) from jsonb_each(g.value) as entries(k,v)) where key='buildings';
insert into public.game_rules(key,value) values('civic','{"income_seconds":86400,"income_gold":20,"election_seconds":1296000,"voting_seconds":86400}');
create or replace function public.check_placement(p_island uuid,p_x integer,p_y integer,p_size integer,p_ignore uuid default null) returns boolean language sql stable set search_path='' as $$
 select p_size between 1 and 4 and p_x between 0 and 59 and p_y between 0 and 59 and not exists(
 select 1 from generate_series(p_x,p_x+p_size-1) as gx(cx) cross join generate_series(p_y,p_y+p_size-1) as gy(cy)
 where not public.is_land(cx,cy)
 or exists(select 1 from public.trees t where t.island_id=p_island and t.x=cx and t.y=cy)
 or exists(select 1 from public.farm_plots f where f.island_id=p_island and f.x=cx and f.y=cy)
 or exists(select 1 from public.buildings b where b.island_id=p_island and (p_ignore is null or b.id<>p_ignore) and cx>=b.x and cx<b.x+b.size and cy>=b.y and cy<b.y+b.size))
$$;


do $$ declare b record; xx int; yy int; begin
 for b in select * from public.buildings where kind='supermarket' order by id loop
 xx:=b.x;yy:=b.y;
 if not public.check_placement(b.island_id,xx,yy,4,b.id) then
 select x,y into xx,yy from generate_series(0,59)x cross join generate_series(0,59)y where public.check_placement(b.island_id,x,y,4,b.id) order by (x-b.x)^2+(y-b.y)^2,x,y limit 1;
 if not found then raise exception 'Agrandissement Megazone impossible : aucune zone 4x4 disponible. Migration annulée.';end if;
 end if;
 update public.buildings set x=xx,y=yy,size=4 where id=b.id;
 end loop;
end $$;
alter table public.shared_world add column regime text not null default 'communism' check(regime in ('communism','capitalism'));
alter table public.shared_world add column mayor_id uuid references public.profiles(id) on delete set null;
alter table public.shared_world add column civic_epoch timestamptz;
create table public.elections(id uuid primary key default gen_random_uuid(),starts_at timestamptz not null unique,closes_at timestamptz not null,finalized_at timestamptz,winner_id uuid references public.profiles(id) on delete set null,result text check(result in ('elected','tie','no_votes')),check(closes_at>starts_at));
create table public.election_candidates(election_id uuid references public.elections(id) on delete cascade,user_id uuid references public.profiles(id) on delete cascade,username text not null,primary key(election_id,user_id));
create table public.election_votes(election_id uuid not null,voter_id uuid references public.profiles(id) on delete cascade,candidate_id uuid not null,created_at timestamptz not null default clock_timestamp(),primary key(election_id,voter_id),foreign key(election_id,candidate_id) references public.election_candidates(election_id,user_id) on delete cascade,check(voter_id<>candidate_id));
create table public.commerce_claims(building_id uuid references public.buildings(id) on delete cascade,cycle bigint not null check(cycle>0),user_id uuid references public.profiles(id) on delete set null,amount bigint not null check(amount>0),created_at timestamptz not null default clock_timestamp(),primary key(building_id,cycle));
alter table public.elections enable row level security;
alter table public.election_candidates enable row level security;
alter table public.election_votes enable row level security;
alter table public.commerce_claims enable row level security;
revoke all on public.elections,public.election_candidates,public.election_votes,public.commerce_claims from public,anon,authenticated;

-- Idempotent server-side transitions. The island lock also serializes votes and claims.
create function public.ensure_civic_state() returns void language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare w uuid; epoch timestamptz; ts timestamptz; cfg jsonb; start_time timestamptz; end_time timestamptz; election_id uuid; row_e public.elections; winner uuid; leaders int; best bigint; changed boolean:=false;
begin
 select island_id into strict w from public.shared_world where singleton=true;
 perform 1 from public.islands where id=w for update;
 ts:=clock_timestamp();
 select civic_epoch into epoch from public.shared_world where singleton=true;
 if epoch is null then
 select min(built_at) into epoch from public.buildings where island_id=w and kind='townhall';
 if epoch is null then return;end if;
 update public.shared_world set civic_epoch=epoch where singleton=true;changed:=true;
 end if;
 if ts<epoch then return;end if;
 select value into cfg from public.game_rules where key='civic';
 start_time:=epoch+make_interval(secs=>(floor(extract(epoch from (ts-epoch))/(cfg->>'election_seconds')::int)*(cfg->>'election_seconds')::int)::double precision);
 end_time:=start_time+make_interval(secs=>(cfg->>'voting_seconds')::int);
 insert into public.elections(starts_at,closes_at) values(start_time,end_time) on conflict(starts_at) do nothing returning id into election_id;
 if election_id is not null then
 insert into public.election_candidates(election_id,user_id,username) select election_id,id,username from public.profiles;
 changed:=true;
 end if;
 for row_e in select * from public.elections where finalized_at is null and closes_at<=ts order by starts_at for update loop
 select coalesce(max(n),0) into best from(select count(*) n from public.election_votes where election_id=row_e.id group by candidate_id) v;
 select count(*),min(candidate_id::text)::uuid into leaders,winner from (select candidate_id from public.election_votes where election_id=row_e.id group by candidate_id having count(*)=best) v;
 if best>0 and leaders=1 then
 update public.shared_world set mayor_id=winner where singleton=true;
 else winner:=null;end if;
 update public.elections set finalized_at=ts,winner_id=winner,result=case when best=0 then 'no_votes' when leaders<>1 then 'tie' else 'elected' end where id=row_e.id;
 changed:=true;
 end loop;
 if changed then update public.shared_world set revision=revision+1 where singleton=true;end if;
end $$;
create function public.civic_view() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('regime',w.regime,'mayor_id',w.mayor_id,'epoch',w.civic_epoch,'election',
 (select to_jsonb(e)||jsonb_build_object('candidates',coalesce((select jsonb_agg(jsonb_build_object('id',c.user_id,'username',c.username,'votes',(select count(*) from public.election_votes v where v.election_id=e.id and v.candidate_id=c.user_id)) order by c.username) from public.election_candidates c where c.election_id=e.id),'[]'::jsonb),'my_vote',(select candidate_id from public.election_votes where election_id=e.id and voter_id=auth.uid())) from public.elections e order by starts_at desc limit 1)) from public.shared_world w where singleton=true
$$;
revoke all on function public.ensure_civic_state(),public.civic_view() from public,anon,authenticated;
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
 'trees',coalesce((select jsonb_agg(to_jsonb(t)-'island_id' order by id) from public.trees t where island_id=isl.id),'[]'::jsonb),
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


select public.ensure_civic_state();
update public.shared_world set revision=revision+1 where singleton=true;
do $$ begin
 if exists(select 1 from pg_namespace where nspname='cron') then
 perform cron.schedule('island-civic-transitions','*/5 * * * *','select public.ensure_civic_state();');
 end if;
end $$;
commit;
