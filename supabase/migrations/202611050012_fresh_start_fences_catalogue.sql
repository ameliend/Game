-- Migration 12: requested fresh start (once), smaller island, fences, revised catalogue.
-- Apply after migration 11. The one-time reset archives the previous game state.
begin;
alter table public.profiles alter column gold set default 150;
alter table public.shared_world alter column regime set default 'capitalism';
alter table public.shared_world add column if not exists generation integer not null default 0;
alter table public.buildings add column if not exists income_started_at timestamptz;
update public.game_rules set value=jsonb_set(value,'{initial_gold}','150'::jsonb) where key='timing';
update public.game_rules set value=value||'{"default_regime":"capitalism"}'::jsonb where key='civic';
update public.game_rules set value=value||'{"land_tiles":1476,"land_center":29.5,"land_radius_x_squared":509.028,"land_radius_y_squared":433.728}'::jsonb where key='world';
update public.game_rules set value='{"cottage":{"price":150,"points":10,"size":2,"commerce":false,"income_gold":10},"house":{"price":400,"points":25,"size":3,"commerce":false,"income_gold":30},"bakery":{"price":300,"points":20,"size":2,"commerce":true,"income_gold":20},"butcher":{"price":350,"points":20,"size":2,"commerce":true,"income_gold":25},"pharmacy":{"price":450,"points":20,"size":2,"commerce":true,"income_gold":35},"barber":{"price":250,"points":20,"size":2,"commerce":true,"income_gold":15},"nail_salon":{"price":250,"points":20,"size":2,"commerce":true,"income_gold":15},"roy_merlin":{"price":700,"points":20,"size":4,"commerce":true,"income_gold":50},"chocolatier":{"price":450,"points":20,"size":2,"commerce":true,"income_gold":35},"farm":{"price":400,"points":30,"size":4,"commerce":false,"income_gold":30},"hotel":{"price":900,"points":20,"size":3,"commerce":true,"income_gold":60},"coffeeshop":{"price":300,"points":20,"size":2,"commerce":true,"income_gold":20},"sexshop":{"price":500,"points":20,"size":2,"commerce":true,"income_gold":40},"gym":{"price":600,"points":20,"size":3,"commerce":true,"income_gold":20},"school":{"price":600,"points":40,"size":3,"commerce":false,"income_gold":45},"supermarket":{"price":800,"points":20,"size":4,"commerce":true,"income_gold":55},"townhall":{"price":1000,"points":70,"size":3,"commerce":false,"income_gold":0},"restaurant":{"price":500,"points":20,"size":2,"commerce":true,"income_gold":40},"hospital":{"price":1200,"points":60,"size":3,"commerce":false,"income_gold":80},"park":{"price":250,"points":5,"size":2,"commerce":false,"income_gold":0},"fountain":{"price":100,"points":5,"size":1,"commerce":false,"income_gold":0},"road":{"price":1,"points":0,"size":1,"commerce":false,"income_gold":0},"fence":{"price":1,"points":0,"size":1,"commerce":false,"income_gold":0}}'::jsonb where key='buildings';

create or replace function public.is_land(x integer,y integer) returns boolean language sql immutable set search_path='' as $$
 select x between 0 and 59 and y between 0 and 59
 and power(x-29.5,2)/509.028+power(y-29.5,2)/433.728<=1
$$;
create table if not exists public.world_resets(
 reset_key text primary key,
 created_at timestamptz not null,
 snapshot jsonb not null
);
alter table public.world_resets enable row level security;
revoke all on public.world_resets from public,anon,authenticated;

create or replace function public.load_world(p_owner uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); target uuid; isl public.islands; result jsonb; z public.banishments; begin
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
 'trees',coalesce((select jsonb_agg(to_jsonb(t)-'island_id' order by id) from public.trees t where island_id=isl.id and cut_at is null),'[]'::jsonb),
 'plots',coalesce((select jsonb_agg((to_jsonb(p)-'island_id')||coalesce(public.plot_property(isl.id,p.x,p.y),jsonb_build_object('owner_id',null,'owner_name',null,'house_id',null)) order by p.id) from public.farm_plots p where p.island_id=isl.id),'[]'::jsonb),
 'plantations',coalesce((select jsonb_agg(to_jsonb(p)) from public.plantations p join public.farm_plots f on f.id=p.plot_id where f.island_id=isl.id),'[]'::jsonb),
 'buildings',coalesce((select jsonb_agg(to_jsonb(b)-'island_id') from public.buildings b where island_id=isl.id),'[]'::jsonb),
 'governance',public.civic_view(),
 'generation',(select generation from public.shared_world where singleton=true),
 'server_time',clock_timestamp()) into result;
 select * into z from public.banishments where user_id=u and ends_at>clock_timestamp();
 if found then result:=result||jsonb_build_object('exile',jsonb_build_object('until',z.ends_at));end if;
 return result;
end $$;

create or replace function public.game_action(p_action text,p_payload jsonb,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare u uuid:=auth.uid(); prof public.profiles; isl public.islands; timing jsonb; cfg jsonb; prior public.economy_transactions; tr public.trees; pl public.plantations; bd public.buildings;
 cost bigint:=0; reward bigint:=0; qty integer; stock integer; v_item text; kind text; xx integer; yy integer; sz integer; a text; ts timestamptz:=clock_timestamp(); cycle bigint; e public.elections; regime text; proposal uuid; exile public.exile_proposals; plot public.farm_plots; property jsonb;
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
 if exists(select 1 from public.banishments z where z.user_id=u and z.ends_at>clock_timestamp()) and p_action not in ('avatar','tutorial') then raise exception 'Vous êtes en exil pendant 24 h : les actions sur l’île principale sont suspendues';end if;
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
 select * into plot from public.farm_plots where id=(p_payload->>'id')::bigint and island_id=isl.id for update;
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
 property:=public.plot_property(isl.id,plot.x,plot.y);
 if property is not null and (property->>'owner_id')::uuid is distinct from u then
   raise exception 'Récolte réservée à % : cette parcelle dépend de sa maison',property->>'owner_name';
 end if;
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
 if bd.created_by is distinct from u and not prof.is_admin and not exists(select 1 from public.shared_world where singleton=true and mayor_id=u) then raise exception 'Seul le constructeur, le maire ou un administrateur peut déplacer ce bâtiment';end if;
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
 if not found then raise exception 'Bâtiment introuvable';end if;
 select value->bd.kind into cfg from public.game_rules where key='buildings';
 if coalesce((cfg->>'income_gold')::bigint,0)<=0 or (bd.kind in('cottage','house') and bd.assigned_to is not null) then
   raise exception 'Ce bâtiment ne produit pas de revenu';
 end if;
 reward:=(cfg->>'income_gold')::bigint;
 select value into cfg from public.game_rules where key='civic';
 cycle:=floor(extract(epoch from(ts-coalesce(bd.income_started_at,bd.built_at)))/(cfg->>'income_seconds')::int)::bigint;
 if cycle<1 or bd.income_claimed_cycle>=cycle then raise exception 'Revenu pas encore disponible ou déjà récupéré';end if;
 select w.regime into regime from public.shared_world w where singleton=true;
 if regime='capitalism' and bd.created_by is distinct from u then raise exception 'Seul le constructeur peut récupérer ce revenu en capitalisme';end if;
 update public.buildings set income_claimed_cycle=cycle where id=bd.id;
 insert into public.commerce_claims(building_id,cycle,user_id,amount) values(bd.id,cycle,u,reward);
 elsif p_action='vote' then
 select * into e from public.elections where id=(p_payload->>'election_id')::uuid for update;
 if not found or e.finalized_at is not null or ts<e.starts_at or ts>=e.closes_at then raise exception 'Le scrutin est fermé';end if;
 if coalesce((p_payload->>'round')::int,1)<>e.round then raise exception 'Le scrutin a changé de tour. Actualisez la mairie';end if;
 if not exists(select 1 from public.election_electors where election_id=e.id and user_id=u) then raise exception 'Vous ne participez pas à ce scrutin';end if;
 if (p_payload->>'candidate_id')::uuid=u then raise exception 'Impossible de voter pour soi';end if;
 if not exists(select 1 from public.election_candidates where election_id=e.id and user_id=(p_payload->>'candidate_id')::uuid and active) then raise exception 'Candidat introuvable';end if;
 if exists(select 1 from public.election_votes where election_id=e.id and round=e.round and voter_id=u) then raise exception 'Vous avez déjà voté';end if;
 insert into public.election_votes(election_id,round,voter_id,candidate_id) values(e.id,e.round,u,(p_payload->>'candidate_id')::uuid);
 elsif p_action='demolish' then
 if not exists(select 1 from public.shared_world where singleton=true and mayor_id=u) then raise exception 'Seul le maire peut démolir';end if;
 select * into bd from public.buildings where id=(p_payload->>'id')::uuid and island_id=isl.id for update;
 if not found then raise exception 'Bâtiment introuvable';end if;
 select value->bd.kind into cfg from public.game_rules where key='buildings';
 if bd.kind not in ('cottage','house') and not coalesce((cfg->>'commerce')::boolean,false) then raise exception 'Seules les maisons et commerces peuvent être démolis';end if;
 insert into public.demolitions(mayor_id,building) values(u,to_jsonb(bd));
 delete from public.buildings where id=bd.id;
 update public.islands set score=greatest(0,score-(cfg->>'points')::int) where id=isl.id;
 elsif p_action='propose_exile' then
 if not exists(select 1 from public.shared_world where singleton=true and mayor_id=u) then raise exception 'Seul le maire peut proposer un exil';end if;
 if (p_payload->>'user_id')::uuid=u or not exists(select 1 from public.profiles where id=(p_payload->>'user_id')::uuid) then raise exception 'Habitant invalide';end if;
 if exists(select 1 from public.banishments where user_id=(p_payload->>'user_id')::uuid and ends_at>ts) then raise exception 'Cet habitant est déjà en exil';end if;
 insert into public.exile_proposals(proposer_id,target_id,starts_at,closes_at) values(u,(p_payload->>'user_id')::uuid,ts,ts+interval '24 hours') returning id into proposal;
 insert into public.exile_electors(proposal_id,user_id) select proposal,id from public.profiles p where p.id<>(p_payload->>'user_id')::uuid and not exists(select 1 from public.banishments z where z.user_id=p.id and z.ends_at>ts);
 elsif p_action='vote_exile' then
 select * into exile from public.exile_proposals where id=(p_payload->>'proposal_id')::uuid for update;
 if not found or exile.status<>'open' or ts>=exile.closes_at then raise exception 'Le vote est fermé';end if;
 if coalesce((p_payload->>'round')::int,1)<>exile.round then raise exception 'Le tour du vote a changé';end if;
 if not exists(select 1 from public.exile_electors where proposal_id=exile.id and user_id=u) then raise exception 'Vous ne participez pas à ce vote';end if;
 if p_payload->>'yes' is null or p_payload->>'yes' not in ('true','false') then raise exception 'Choisissez oui ou non';end if;
 insert into public.exile_votes(proposal_id,round,user_id,yes) values(exile.id,exile.round,u,(p_payload->>'yes')::boolean);
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

create or replace function public.heartbeat_presence(p_x integer,p_y integer) returns void language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); w uuid; ts timestamptz:=clock_timestamp(); xx integer:=p_x; yy integer:=p_y;
begin
 if u is null or not exists(select 1 from public.profiles where id=u) then raise exception 'Connexion et profil requis';end if;
 if exists(select 1 from public.banishments where user_id=u and ends_at>ts) then
   if not public.is_exile_land(xx,yy) then xx:=61;yy:=30;end if;
 elsif public.is_exile_land(xx,yy) or (xx between 57 and 59 and yy between 29 and 31) then
   xx:=30;yy:=31;
 elsif xx is null or yy is null or not public.is_land(xx,yy) then
   xx:=30;yy:=31; -- A resident on the former coastline returns to the arrival tile.
 end if;
 select island_id into strict w from public.shared_world where singleton=true;
 insert into public.player_presence(user_id,island_id,x,y,last_seen_at) values(u,w,xx,yy,ts)
 on conflict(user_id) do update set island_id=excluded.island_id,x=excluded.x,y=excluded.y,last_seen_at=excluded.last_seen_at
 where public.player_presence.last_seen_at<=ts-interval '200 milliseconds';
end $$;

-- No public reset RPC. This block is executed by the migration operator only.
do $$
declare w uuid; ts timestamptz; today date; r record; xx integer; yy integer;
begin
 select island_id into strict w from public.shared_world where singleton=true;
 -- Same lock order as game actions and maintenance.
 perform 1 from public.islands where id=w for update;
 perform 1 from public.shared_world where singleton=true for update;
 if exists(select 1 from public.world_resets where reset_key='fresh_start_20261105_v1') then
   raise notice 'Nouveau départ déjà effectué : soldes et progression conservés.';
   return;
 end if;
 ts:=clock_timestamp();today:=(ts at time zone 'Europe/Paris')::date;
 insert into public.world_resets(reset_key,created_at,snapshot)
 values('fresh_start_20261105_v1',ts,jsonb_build_object(
 'profiles',coalesce((select jsonb_agg(to_jsonb(t)) from public.profiles t),'[]'::jsonb),
 'islands',coalesce((select jsonb_agg(to_jsonb(t)) from public.islands t),'[]'::jsonb),
 'shared_world',coalesce((select jsonb_agg(to_jsonb(t)) from public.shared_world t),'[]'::jsonb),
 'inventories',coalesce((select jsonb_agg(to_jsonb(t)) from public.inventories t),'[]'::jsonb),
 'buildings',coalesce((select jsonb_agg(to_jsonb(t)) from public.buildings t),'[]'::jsonb),
 'trees',coalesce((select jsonb_agg(to_jsonb(t)) from public.trees t),'[]'::jsonb),
 'farm_plots',coalesce((select jsonb_agg(to_jsonb(t)) from public.farm_plots t),'[]'::jsonb),
 'plantations',coalesce((select jsonb_agg(to_jsonb(t)) from public.plantations t),'[]'::jsonb),
 'elections',coalesce((select jsonb_agg(to_jsonb(t)) from public.elections t),'[]'::jsonb),
 'election_candidates',coalesce((select jsonb_agg(to_jsonb(t)) from public.election_candidates t),'[]'::jsonb),
 'election_votes',coalesce((select jsonb_agg(to_jsonb(t)) from public.election_votes t),'[]'::jsonb),
 'election_electors',coalesce((select jsonb_agg(to_jsonb(t)) from public.election_electors t),'[]'::jsonb),
 'exile_proposals',coalesce((select jsonb_agg(to_jsonb(t)) from public.exile_proposals t),'[]'::jsonb),
 'exile_electors',coalesce((select jsonb_agg(to_jsonb(t)) from public.exile_electors t),'[]'::jsonb),
 'exile_votes',coalesce((select jsonb_agg(to_jsonb(t)) from public.exile_votes t),'[]'::jsonb),
 'banishments',coalesce((select jsonb_agg(to_jsonb(t)) from public.banishments t),'[]'::jsonb),
 'player_presence',coalesce((select jsonb_agg(to_jsonb(t)) from public.player_presence t),'[]'::jsonb),
 'commerce_claims',coalesce((select jsonb_agg(to_jsonb(t)) from public.commerce_claims t),'[]'::jsonb),
 'tree_spawn_days',coalesce((select jsonb_agg(to_jsonb(t)) from public.tree_spawn_days t),'[]'::jsonb)
 ));
 -- Keep the economy history and record the exact wallet adjustment for each resident.
 insert into public.economy_transactions(user_id,request_id,action,payload,gold_delta)
 select id,'4af01123-7584-42b3-b55f-000000000150'::uuid,'fresh_start',
 jsonb_build_object('reset','fresh_start_20261105_v1','before',gold,'after',150),150-gold
 from public.profiles on conflict(user_id,request_id) do nothing;
 update public.profiles set gold=150,tutorial_step=0,last_action_at=null;
 update public.inventories set quantity=0;
 delete from public.banishments;
 delete from public.exile_proposals;
 delete from public.elections;
 delete from public.player_presence;
 delete from public.buildings where island_id=w and kind<>'townhall';
 delete from public.farm_plots where island_id=w; -- Cascades to the growing crops.
 delete from public.trees where island_id=w;
 delete from public.tree_spawn_days;
 -- A shared town hall guarantees that the first fresh election can open even
 -- when the previous world had no town hall yet. Existing town halls keep their IDs.
 if not exists(select 1 from public.buildings where island_id=w and kind='townhall') then
   insert into public.buildings(island_id,kind,x,y,size,created_by) values(w,'townhall',29,27,3,null);
 end if;
 -- Keep each town hall at its old location when it fits. Relocate an outlying
 -- town hall to the closest valid footprint on the new coastline.
 for r in select * from public.buildings where island_id=w and kind='townhall' order by id loop
   if not public.check_placement(w,r.x,r.y,r.size,r.id)
      or (30 between r.x and r.x+r.size-1 and 31 between r.y and r.y+r.size-1) then
     select cx,cy into xx,yy from generate_series(0,59) gx(cx) cross join generate_series(0,59) gy(cy)
     where not exists(
       select 1 from generate_series(cx,cx+r.size-1) tx(px) cross join generate_series(cy,cy+r.size-1) ty(py)
       where not public.is_land(px,py)
     )
     and not exists(select 1 from public.buildings b where b.island_id=w and b.id<>r.id
       and cx<b.x+b.size and cx+r.size>b.x and cy<b.y+b.size and cy+r.size>b.y)
     and not(30 between cx and cx+r.size-1 and 31 between cy and cy+r.size-1)
     order by power(cx-r.x,2)+power(cy-r.y,2),cy,cx limit 1;
     if not found then raise exception 'Nouveau départ annulé : impossible de replacer la mairie';end if;
     update public.buildings set x=xx,y=yy where id=r.id;
   end if;
 end loop;
 update public.buildings set income_started_at=ts,income_claimed_cycle=0 where island_id=w;
 -- Regenerate a small starting woodland; subsequent daily spawning stays at 10.
 insert into public.trees(island_id,x,y)
 select w,cx,cy from generate_series(0,59) gx(cx) cross join generate_series(0,59) gy(cy)
 where public.is_land(cx,cy) and not(cx=30 and cy=31)
 and not exists(select 1 from public.buildings b where b.island_id=w
   and cx>=b.x and cx<b.x+b.size and cy>=b.y and cy<b.y+b.size)
 order by random() limit 12;
 insert into public.tree_spawn_days(day,spawned) values(today,0);
 update public.islands set gold=0,score=coalesce((select sum((g.value->b.kind->>'points')::int)
   from public.buildings b cross join public.game_rules g where b.island_id=w and g.key='buildings'),0) where id=w;
 update public.shared_world set regime='capitalism',mayor_id=null,mayor_term_ends_at=null,
   civic_epoch=ts,next_election_at=ts,last_tree_spawn_day=today,generation=generation+1,revision=revision+1
 where singleton=true;
 perform public.ensure_civic_state(); -- Opens the new 24-hour ballot immediately.
end $$;

commit;
