begin;
update public.game_rules set value=value||'{"coffeeshop":{"price":300,"points":20,"size":2,"commerce":true},"sexshop":{"price":500,"points":20,"size":2,"commerce":true}}'::jsonb where key='buildings';
update public.game_rules set value=jsonb_set(value,'{election_seconds}','604800'::jsonb)||'{"runoff_seconds":3600,"exile_seconds":86400}'::jsonb where key='civic';
alter table public.shared_world add column mayor_term_ends_at timestamptz;
alter table public.shared_world add column next_election_at timestamptz;
alter table public.elections add column round integer not null default 1;
alter table public.elections add column round_started_at timestamptz;
update public.elections set round_started_at=starts_at where round_started_at is null;
alter table public.election_candidates add column active boolean not null default true;
alter table public.election_votes add column round integer not null default 1;
alter table public.election_votes drop constraint election_votes_pkey;
alter table public.election_votes add primary key(election_id,round,voter_id);
create table public.demolitions(id uuid primary key default gen_random_uuid(),mayor_id uuid references public.profiles(id) on delete set null,building jsonb not null,created_at timestamptz not null default clock_timestamp());
create table public.exile_proposals(id uuid primary key default gen_random_uuid(),proposer_id uuid references public.profiles(id) on delete set null,target_id uuid not null references public.profiles(id) on delete cascade,starts_at timestamptz not null,closes_at timestamptz not null,round integer not null default 1,status text not null default 'open' check(status in ('open','accepted','rejected')),finalized_at timestamptz);
create unique index one_exile_vote on public.exile_proposals((true)) where status='open';
create table public.exile_electors(proposal_id uuid references public.exile_proposals(id) on delete cascade,user_id uuid references public.profiles(id) on delete cascade,primary key(proposal_id,user_id));
create table public.exile_votes(proposal_id uuid not null,round integer not null,user_id uuid not null,yes boolean not null,primary key(proposal_id,round,user_id),foreign key(proposal_id,user_id) references public.exile_electors(proposal_id,user_id) on delete cascade);
create table public.banishments(user_id uuid primary key references public.profiles(id) on delete cascade,proposal_id uuid references public.exile_proposals(id),starts_at timestamptz not null,ends_at timestamptz not null);
alter table public.demolitions enable row level security;
alter table public.exile_proposals enable row level security;
alter table public.exile_electors enable row level security;
alter table public.exile_votes enable row level security;
alter table public.banishments enable row level security;
revoke all on public.demolitions,public.exile_proposals,public.exile_electors,public.exile_votes,public.banishments from public,anon,authenticated;

create or replace function public.ensure_civic_state() returns void language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare w uuid; epoch timestamptz; ts timestamptz:=clock_timestamp(); nxt timestamptz; term_end timestamptz; e public.elections; xp public.exile_proposals; best bigint; leaders int; winner uuid; tied uuid[]; eid uuid; yes_count int; no_count int; changed boolean:=false;
begin
 select island_id into strict w from public.shared_world where singleton=true;
 perform 1 from public.islands where id=w for update;
 ts:=clock_timestamp();
 -- Resolve community decisions before new periods are opened.
 for xp in select * from public.exile_proposals where status='open' and closes_at<=ts for update loop
 select count(*) filter(where yes),count(*) filter(where not yes) into yes_count,no_count from public.exile_votes where proposal_id=xp.id and round=xp.round;
 if yes_count=no_count and yes_count>0 then
 update public.exile_proposals set round=round+1,closes_at=xp.closes_at+interval '1 hour' where id=xp.id;
 else
 update public.exile_proposals set status=case when yes_count>no_count then 'accepted' else 'rejected' end,finalized_at=ts where id=xp.id;
 if yes_count>no_count then
 insert into public.banishments(user_id,proposal_id,starts_at,ends_at) values(xp.target_id,xp.id,xp.closes_at,xp.closes_at+interval '24 hours') on conflict(user_id) do update set proposal_id=excluded.proposal_id,starts_at=excluded.starts_at,ends_at=excluded.ends_at where public.banishments.ends_at<=ts;
 delete from public.player_presence where user_id=xp.target_id;
 end if;
 end if;changed:=true;
 end loop;
 select civic_epoch,next_election_at into epoch,nxt from public.shared_world where singleton=true;
 if epoch is null then
 select min(built_at) into epoch from public.buildings where island_id=w and kind='townhall';
 if epoch is null then if changed then update public.shared_world set revision=revision+1 where singleton=true;end if;return;end if;
 update public.shared_world set civic_epoch=epoch where singleton=true;
 end if;
 if nxt is null then
 select closes_at+interval '7 days' into nxt from public.elections where finalized_at is not null order by starts_at desc limit 1;
 nxt:=coalesce(nxt,epoch);
 update public.shared_world set next_election_at=nxt where singleton=true;
 end if;
 -- A bounded loop catches an overdue period and its run-off without stalling the map.
 for pass in 1..4 loop
 select * into e from public.elections where finalized_at is null order by starts_at desc limit 1 for update;
 if found then
 if ts<e.closes_at then exit;end if;
 select coalesce(max(n),0) into best from(select count(*) n from public.election_votes where election_id=e.id and round=e.round group by candidate_id) v;
 select count(*),min(candidate_id::text)::uuid,array_agg(candidate_id) into leaders,winner,tied from(select candidate_id from public.election_votes where election_id=e.id and round=e.round group by candidate_id having count(*)=best) v;
 if best>0 and leaders>1 then
 update public.election_candidates set active=user_id=any(tied) where election_id=e.id;
 update public.elections set round=round+1,round_started_at=e.closes_at,closes_at=e.closes_at+interval '1 hour' where id=e.id;
 else
 term_end:=e.closes_at+interval '7 days';
 update public.elections set finalized_at=ts,winner_id=case when best>0 then winner else null end,result=case when best=0 then 'no_votes' else 'elected' end where id=e.id;
 update public.shared_world set mayor_id=case when best>0 then winner else mayor_id end,mayor_term_ends_at=term_end,next_election_at=term_end where singleton=true;
 nxt:=term_end;
 end if;changed:=true;
 else
 if ts<nxt then exit;end if;
 insert into public.elections(starts_at,round_started_at,closes_at) values(nxt,nxt,nxt+interval '24 hours') returning id into eid;
 insert into public.election_candidates(election_id,user_id,username) select eid,id,username from public.profiles p where not exists(select 1 from public.banishments z where z.user_id=p.id and z.ends_at>ts);
 changed:=true;
 end if;
 end loop;
 if changed then update public.shared_world set revision=revision+1 where singleton=true;end if;
end $$;

create or replace function public.civic_view() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('regime',w.regime,'mayor_id',w.mayor_id,'epoch',w.civic_epoch,'term_ends_at',w.mayor_term_ends_at,'next_election_at',w.next_election_at,'election',
 (select to_jsonb(e)||jsonb_build_object('candidates',coalesce((select jsonb_agg(jsonb_build_object('id',c.user_id,'username',c.username,'votes',(select count(*) from public.election_votes v where v.election_id=e.id and v.round=e.round and v.candidate_id=c.user_id)) order by c.username) from public.election_candidates c where c.election_id=e.id and c.active),'[]'::jsonb),'my_vote',(select candidate_id from public.election_votes where election_id=e.id and round=e.round and voter_id=auth.uid())) from public.elections e order by starts_at desc limit 1),
 'exile_proposal',(select to_jsonb(p)||jsonb_build_object('target_name',(select username from public.profiles where id=p.target_id),'yes',(select count(*) from public.exile_votes where proposal_id=p.id and round=p.round and yes),'no',(select count(*) from public.exile_votes where proposal_id=p.id and round=p.round and not yes),'my_vote',(select yes from public.exile_votes where proposal_id=p.id and round=p.round and user_id=auth.uid()),'can_vote',exists(select 1 from public.exile_electors where proposal_id=p.id and user_id=auth.uid())) from public.exile_proposals p order by starts_at desc limit 1)) from public.shared_world w where singleton=true
$$;
create or replace function public.ensure_daily_trees() returns integer language plpgsql security definer set search_path='' as $$
declare w uuid; last_day date; today date:=(clock_timestamp() at time zone 'Europe/Paris')::date;
 d date; n int; total int:=0; tr public.trees; xx int; yy int; regrow int;
begin
 select island_id into strict w from public.shared_world where singleton=true;
 perform 1 from public.islands where id=w for update;
 select (value->>'regrow_seconds')::int into regrow from public.game_rules where key='timing';
 for tr in select * from public.trees where island_id=w and cut_at is not null and cut_at<=clock_timestamp()-make_interval(secs=>regrow) order by cut_at,id limit 5 for update loop
 select cx,cy into xx,yy from generate_series(0,59) gx(cx) cross join generate_series(0,59) gy(cy)
 where public.is_land(cx,cy)
 and not exists(select 1 from public.trees active_t where active_t.island_id=w and active_t.cut_at is null and active_t.x=cx and active_t.y=cy)
 and not exists(select 1 from public.farm_plots f where f.island_id=w and f.x=cx and f.y=cy)
 and not exists(select 1 from public.buildings b where b.island_id=w and cx>=b.x and cx<b.x+b.size and cy>=b.y and cy<b.y+b.size) and not(cx=tr.x and cy=tr.y) and not(cx=30 and cy=31)
 and not exists(select 1 from public.player_presence p where p.island_id=w and p.x=cx and p.y=cy and p.last_seen_at>clock_timestamp()-interval '90 seconds')
 order by random() limit 1;
 if found then update public.trees set x=xx,y=yy,cut_at=null where id=tr.id;total:=total+1;end if;
 end loop;
 select last_tree_spawn_day into last_day from public.shared_world where singleton=true;
 if last_day<today then
 for d in select generate_series(last_day+1,least(today,last_day+1),interval '1 day')::date loop
 insert into public.trees(island_id,x,y)
 select w,cx,cy from generate_series(0,59) gx(cx) cross join generate_series(0,59) gy(cy)
 where public.is_land(cx,cy)
 and not exists(select 1 from public.trees active_t where active_t.island_id=w and active_t.cut_at is null and active_t.x=cx and active_t.y=cy)
 and not exists(select 1 from public.farm_plots f where f.island_id=w and f.x=cx and f.y=cy)
 and not exists(select 1 from public.buildings b where b.island_id=w and cx>=b.x and cx<b.x+b.size and cy>=b.y and cy<b.y+b.size) and not(cx=30 and cy=31)
 and not exists(select 1 from public.player_presence p where p.island_id=w and p.x=cx and p.y=cy and p.last_seen_at>clock_timestamp()-interval '90 seconds')
 order by random() limit 10;
 get diagnostics n=row_count;
 insert into public.tree_spawn_days(day,spawned) values(d,n);total:=total+n;
 end loop;
 update public.shared_world set last_tree_spawn_day=least(today,last_day+1) where singleton=true;
 end if;
 if total>0 then update public.shared_world set revision=revision+1 where singleton=true;end if;
 return total;
end $$;
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
 'plots',coalesce((select jsonb_agg(to_jsonb(p)-'island_id' order by id) from public.farm_plots p where island_id=isl.id),'[]'::jsonb),
 'plantations',coalesce((select jsonb_agg(to_jsonb(p)) from public.plantations p join public.farm_plots f on f.id=p.plot_id where f.island_id=isl.id),'[]'::jsonb),
 'buildings',coalesce((select jsonb_agg(to_jsonb(b)-'island_id') from public.buildings b where island_id=isl.id),'[]'::jsonb),
 'governance',public.civic_view(),
 'server_time',clock_timestamp()) into result;
 select * into z from public.banishments where user_id=u and ends_at>clock_timestamp();
 if found then result:=result||jsonb_build_object('exile',jsonb_build_object('until',z.ends_at),'island',jsonb_build_object('id','exile:'||u::text,'owner_id',u,'name','Îlot d’exil','gold',(select gold from public.profiles where id=u),'score',0),'trees','[]'::jsonb,'plots','[]'::jsonb,'plantations','[]'::jsonb,'buildings','[]'::jsonb);end if;
 return result;
end $$;

create function public.refresh_world() returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Connexion requise';end if;
 perform public.ensure_daily_trees();perform public.ensure_civic_state();
end $$;
revoke all on function public.refresh_world() from public,anon,authenticated;
grant execute on function public.refresh_world() to authenticated;
create or replace function public.game_action(p_action text,p_payload jsonb,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare u uuid:=auth.uid(); prof public.profiles; isl public.islands; timing jsonb; cfg jsonb; prior public.economy_transactions; tr public.trees; pl public.plantations; bd public.buildings;
 cost bigint:=0; reward bigint:=0; qty integer; stock integer; v_item text; kind text; xx integer; yy integer; sz integer; a text; ts timestamptz:=clock_timestamp(); cycle bigint; e public.elections; regime text; proposal uuid; exile public.exile_proposals;
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
 if coalesce((p_payload->>'round')::int,1)<>e.round then raise exception 'Le scrutin a changé de tour. Actualisez la mairie';end if;
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
declare u uuid:=auth.uid(); w uuid;ts timestamptz:=clock_timestamp();begin
 if u is null or not exists(select 1 from public.profiles where id=u) then raise exception 'Connexion et profil requis';end if;
 if exists(select 1 from public.banishments where user_id=u and ends_at>ts) then delete from public.player_presence where user_id=u;return;end if;
 if p_x is null or p_y is null or not public.is_land(p_x,p_y) then raise exception 'Position invalide';end if;
 select island_id into strict w from public.shared_world where singleton=true;
 insert into public.player_presence(user_id,island_id,x,y,last_seen_at) values(u,w,p_x,p_y,ts)
 on conflict(user_id) do update set island_id=excluded.island_id,x=excluded.x,y=excluded.y,last_seen_at=excluded.last_seen_at
 where public.player_presence.last_seen_at<=ts-interval '200 milliseconds';
end $$;

update public.shared_world set revision=revision+1 where singleton=true;
commit;
