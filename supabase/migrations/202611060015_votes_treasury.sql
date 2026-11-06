-- Community votes, municipal treasury, recurring taxes and visible offline exiles.
-- Apply after 14. No reset; tax clocks start at installation.
begin;
alter table public.shared_world add column treasury bigint not null default 0 check(treasury>=0);
alter table public.buildings add column public_funded boolean not null default false;
alter table public.buildings add column tax_last_at timestamptz not null default clock_timestamp();
alter table public.profiles drop constraint profiles_gold_check;
alter table public.profiles add column debt_since timestamptz;
create function public.track_debt() returns trigger language plpgsql set search_path='' as $$
begin
 if new.gold>=0 then new.debt_since:=null;
 elsif old.gold>=0 or old.debt_since is null then new.debt_since:=clock_timestamp();end if;
 return new;
end $$;
create trigger debt_clock before update of gold on public.profiles for each row execute function public.track_debt();
create table public.treasury_ledger (
 id uuid primary key default gen_random_uuid(), user_id uuid references public.profiles(id) on delete set null,
 amount bigint not null, reason text not null, created_at timestamptz not null default clock_timestamp()
);
create table public.demolition_proposals (
 id uuid primary key default gen_random_uuid(), proposer_id uuid references public.profiles(id) on delete set null,
 target_type text not null check(target_type in ('building','plot')), target_id text not null,
 snapshot jsonb not null, starts_at timestamptz not null default clock_timestamp(),
 closes_at timestamptz not null default clock_timestamp()+interval '24 hours',
 status text not null default 'open' check(status in ('open','accepted','rejected')), finalized_at timestamptz
);
create unique index one_demolition_per_target on public.demolition_proposals(target_type,target_id) where status='open';
create table public.demolition_electors (
 proposal_id uuid references public.demolition_proposals(id) on delete cascade,
 user_id uuid references public.profiles(id) on delete cascade, primary key(proposal_id,user_id)
);
create table public.demolition_votes (
 proposal_id uuid not null,user_id uuid not null,yes boolean not null,primary key(proposal_id,user_id),
 foreign key(proposal_id,user_id) references public.demolition_electors(proposal_id,user_id) on delete cascade
);
alter table public.treasury_ledger enable row level security;
alter table public.demolition_proposals enable row level security;
alter table public.demolition_electors enable row level security;
alter table public.demolition_votes enable row level security;
revoke all on public.treasury_ledger,public.demolition_proposals,public.demolition_electors,public.demolition_votes from public,anon,authenticated;

-- Points have no gameplay role anymore; keep zeroed columns for older clients.
update public.game_rules set value=(select jsonb_object_agg(key,value||'{"points":0}'::jsonb) from jsonb_each(value)) where key='buildings';
update public.islands set score=0;

create function public.collect_building_taxes() returns void language plpgsql security definer set search_path='' as $$
declare w uuid; ts timestamptz:=clock_timestamp(); r record; total bigint:=0;
begin
 select island_id into strict w from public.shared_world where singleton=true;
 perform 1 from public.islands where id=w for update;
 -- Aggregate elapsed whole days, not one query per day or per building.
 for r in select coalesce(b.assigned_to,b.created_by) as owner_id,
 sum(floor(extract(epoch from(ts-b.tax_last_at))/86400)::bigint*3)::bigint as amount
 from public.buildings b where b.island_id=w and not b.public_funded
 and coalesce(b.assigned_to,b.created_by) is not null and b.tax_last_at<=ts-interval '24 hours'
 group by coalesce(b.assigned_to,b.created_by) order by owner_id loop
   update public.profiles set gold=gold-r.amount where id=r.owner_id;
   insert into public.treasury_ledger(user_id,amount,reason) values(r.owner_id,r.amount,'tax');
   total:=total+r.amount;
 end loop;
 update public.buildings set tax_last_at=tax_last_at+floor(extract(epoch from(ts-tax_last_at))/86400)*interval '24 hours'
 where island_id=w and tax_last_at<=ts-interval '24 hours';
 if total>0 then update public.shared_world set treasury=treasury+total,revision=revision+1 where singleton=true;end if;
end $$;
revoke all on function public.collect_building_taxes() from public,anon,authenticated;

alter function public.ensure_civic_state() rename to ensure_civic_state_before_common;
revoke all on function public.ensure_civic_state_before_common() from public,anon,authenticated;
create function public.ensure_civic_state() returns void language plpgsql security definer set search_path='' as $$
declare w uuid; ts timestamptz:=clock_timestamp(); p public.demolition_proposals;
 yes_count int; no_count int; elector_count int; changed boolean:=false;
begin
 select island_id into strict w from public.shared_world where singleton=true;
 perform 1 from public.islands where id=w for update;
 perform public.collect_building_taxes();
 -- Neither the proposing mayor nor the target participates in a police ballot.
 delete from public.exile_electors r using public.exile_proposals xp
 where r.proposal_id=xp.id and xp.status='open' and r.user_id in (xp.proposer_id,xp.target_id);
 update public.exile_proposals xp set closes_at=ts where xp.status='open' and xp.closes_at>ts
 and exists(select 1 from public.exile_electors r where r.proposal_id=xp.id)
 and not exists(select 1 from public.exile_electors r where r.proposal_id=xp.id
   and not exists(select 1 from public.banishments z where z.user_id=r.user_id and z.ends_at>ts)
   and not exists(select 1 from public.exile_votes v where v.proposal_id=xp.id and v.round=xp.round and v.user_id=r.user_id));
 if found then changed:=true;end if;
 perform public.ensure_civic_state_before_common();
 for p in select * from public.demolition_proposals where status='open' for update loop
   select count(*) into elector_count from public.demolition_electors where proposal_id=p.id;
   select count(*) filter(where yes),count(*) filter(where not yes) into yes_count,no_count from public.demolition_votes where proposal_id=p.id;
   if no_count>0 or p.closes_at<=ts or (elector_count>0 and yes_count=elector_count) then
     if no_count=0 and elector_count>0 and yes_count=elector_count then
       if p.target_type='building' then
         insert into public.demolitions(mayor_id,building) select p.proposer_id,to_jsonb(b) from public.buildings b where b.id=p.target_id::uuid and b.island_id=w;
         delete from public.buildings where id=p.target_id::uuid and island_id=w;
       else
         delete from public.farm_plots where id=p.target_id::bigint and island_id=w;
       end if;
       update public.demolition_proposals set status='accepted',finalized_at=ts where id=p.id;
     else update public.demolition_proposals set status='rejected',finalized_at=ts where id=p.id;
     end if;
     changed:=true;
   end if;
 end loop;
 if changed then update public.shared_world set revision=revision+1 where singleton=true;end if;
end $$;
revoke all on function public.ensure_civic_state() from public,anon,authenticated;

alter function public.civic_view() rename to civic_view_before_common;
revoke all on function public.civic_view_before_common() from public,anon,authenticated;
create function public.civic_view() returns jsonb language sql stable security definer set search_path='' as $$
 select public.civic_view_before_common()||jsonb_build_object(
 'demolition_proposals',coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object(
   'elector_count',(select count(*) from public.demolition_electors where proposal_id=p.id),
   'yes',(select count(*) from public.demolition_votes where proposal_id=p.id and yes),
   'no',(select count(*) from public.demolition_votes where proposal_id=p.id and not yes),
   'my_vote',(select yes from public.demolition_votes where proposal_id=p.id and user_id=auth.uid()),
   'can_vote',exists(select 1 from public.demolition_electors where proposal_id=p.id and user_id=auth.uid())) order by p.starts_at)
   from public.demolition_proposals p where p.status='open'),'[]'::jsonb),
 'exile_proposal',case when jsonb_typeof(public.civic_view_before_common()->'exile_proposal')='object' then (public.civic_view_before_common()->'exile_proposal')||jsonb_build_object(
   'elector_count',(select count(*) from public.exile_electors r join public.exile_proposals p on p.id=r.proposal_id where p.status='open' and not exists(select 1 from public.banishments z where z.user_id=r.user_id and z.ends_at>clock_timestamp())),
   'voted_count',(select count(*) from public.exile_votes v join public.exile_proposals p on p.id=v.proposal_id where p.status='open' and v.round=p.round and not exists(select 1 from public.banishments z where z.user_id=v.user_id and z.ends_at>clock_timestamp()))) else 'null'::jsonb end)
$$;
revoke all on function public.civic_view() from public,anon,authenticated;

alter function public.load_world(uuid) rename to load_world_before_common;
revoke all on function public.load_world_before_common(uuid) from public,anon,authenticated;
create function public.load_world(p_owner uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; p public.profiles;begin
 result:=public.load_world_before_common(p_owner);
 if result is null then return null;end if;
 select * into p from public.profiles where id=auth.uid();
 return result||jsonb_build_object('treasury',(select treasury from public.shared_world where singleton=true),
 'debt',case when p.gold<0 then jsonb_build_object('deadline',p.debt_since+interval '6 hours','blocked',p.debt_since<=clock_timestamp()-interval '6 hours') else null end);
end $$;
revoke all on function public.load_world(uuid) from public,anon;
grant execute on function public.load_world(uuid) to authenticated;

-- Zero-cost actions and selling must remain possible during the six-hour grace period.
do $$ declare definition text;begin
 definition:=pg_get_functiondef('public.game_action_before_luck(text,jsonb,uuid)'::regprocedure);
 if strpos(definition,'if prof.gold<cost then')=0 then raise exception 'Version de game_action inattendue';end if;
 execute replace(definition,'if prof.gold<cost then','if cost>0 and prof.gold<cost then');
end $$;

alter function public.game_action(text,jsonb,uuid) rename to game_action_before_common;
revoke all on function public.game_action_before_common(text,jsonb,uuid) from public,anon,authenticated;
create function public.game_action(p_action text,p_payload jsonb,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); w uuid; prof public.profiles; prior public.economy_transactions;
 result jsonb; item jsonb; cfg jsonb; proposal uuid; d public.demolition_proposals; bd public.buildings;
 cost bigint; reward bigint; cycle bigint; ts timestamptz:=clock_timestamp();
begin
 if u is null then raise exception 'Connexion requise';end if;
 if p_request is null or p_payload is null or p_action is null then raise exception 'Requête invalide';end if;
 select i.id into strict w from public.islands i join public.shared_world s on s.island_id=i.id for update of i;
 perform public.ensure_civic_state();
 select * into prof from public.profiles where id=u for update;
 if not found then raise exception 'Profil requis';end if;
 select * into prior from public.economy_transactions where user_id=u and request_id=p_request;
 if found then
   if prior.action<>p_action or prior.payload<>p_payload then raise exception 'Identifiant de requête réutilisé';end if;
   if p_action in ('scratch','pol_deal') then return public.game_action_before_common(p_action,p_payload,p_request);end if;
   return jsonb_build_object('replayed',true,'gold_delta',prior.gold_delta);
 end if;
 if prof.gold<0 and prof.debt_since<=ts-interval '6 hours' and p_action<>'sell' then raise exception 'Dette impayée depuis 6 h : jeu bloqué, vendez au marché pour rembourser';end if;
 if p_action not in ('demolish','propose_demolition','vote_demolition','municipal_build','claim_income') then
   return public.game_action_before_common(p_action,p_payload,p_request);
 end if;
 if exists(select 1 from public.banishments where user_id=u and ends_at>ts) then raise exception 'Action impossible pendant l’exil';end if;
 if prof.last_action_at>ts-interval '150 milliseconds' then raise exception 'Action trop rapide';end if;
 if p_action in ('demolish','propose_demolition') then
   if not exists(select 1 from public.shared_world where singleton=true and mayor_id=u) then raise exception 'Seul le maire peut proposer une démolition';end if;
   if coalesce(p_payload->>'target_type','building')='building' then
     select to_jsonb(b) into item from public.buildings b where id=(p_payload->>'id')::uuid and island_id=w;
   elsif p_payload->>'target_type'='plot' then
     select to_jsonb(f) into item from public.farm_plots f where id=(p_payload->>'id')::bigint and island_id=w;
   else raise exception 'Type de cible invalide';end if;
   if item is null then raise exception 'Élément introuvable';end if;
   insert into public.demolition_proposals(proposer_id,target_type,target_id,snapshot) values(u,coalesce(p_payload->>'target_type','building'),p_payload->>'id',item) returning id into proposal;
   insert into public.demolition_electors select proposal,id from public.profiles p where not exists(select 1 from public.banishments z where z.user_id=p.id and z.ends_at>ts);
   insert into public.demolition_votes values(proposal,u,true);
 elsif p_action='vote_demolition' then
   select * into d from public.demolition_proposals where id=(p_payload->>'proposal_id')::uuid for update;
   if not found or d.status<>'open' or d.closes_at<=ts then raise exception 'Vote fermé';end if;
   if p_payload->>'yes' is null or p_payload->>'yes' not in ('true','false') then raise exception 'Choisissez oui ou non';end if;
   if not exists(select 1 from public.demolition_electors where proposal_id=d.id and user_id=u) then raise exception 'Vous ne participez pas à ce vote';end if;
   insert into public.demolition_votes values(d.id,u,(p_payload->>'yes')::boolean);
 elsif p_action='municipal_build' then
   if not exists(select 1 from public.shared_world where singleton=true and mayor_id=u) then raise exception 'Seul le maire peut utiliser la bourse';end if;
   select value->(p_payload->>'kind') into cfg from public.game_rules where key='buildings';
   if cfg is null then raise exception 'Bâtiment inconnu';end if;
   cost:=(cfg->>'price')::bigint;
   if not public.check_placement(w,(p_payload->>'x')::int,(p_payload->>'y')::int,(cfg->>'size')::int) or p_payload->>'x' is null or p_payload->>'y' is null then raise exception 'Emplacement indisponible';end if;
   update public.shared_world set treasury=treasury-cost where singleton=true and treasury>=cost;
   if not found then raise exception 'Bourse commune insuffisante';end if;
   insert into public.buildings(island_id,kind,x,y,size,public_funded) values(w,p_payload->>'kind',(p_payload->>'x')::int,(p_payload->>'y')::int,(cfg->>'size')::int,true);
   insert into public.treasury_ledger(user_id,amount,reason) values(u,-cost,'construction');
 elsif p_action='claim_income' then
   select * into bd from public.buildings where id=(p_payload->>'id')::uuid and island_id=w for update;
   if not found or not bd.public_funded then return public.game_action_before_common(p_action,p_payload,p_request);end if;
   select value->bd.kind into cfg from public.game_rules where key='buildings';
   reward:=coalesce((cfg->>'income_gold')::bigint,0);
   if bd.kind in ('cottage','house') and bd.assigned_to is not null then reward:=0;end if;
   cycle:=floor(extract(epoch from(ts-coalesce(bd.income_started_at,bd.built_at)))/86400)::bigint;
   if reward<=0 or cycle<1 or cycle<=bd.income_claimed_cycle then raise exception 'Aucun revenu disponible';end if;
   update public.buildings set income_claimed_cycle=cycle where id=bd.id;
   insert into public.commerce_claims values(bd.id,cycle,u,reward,default);
   update public.shared_world set treasury=treasury+reward where singleton=true;
   insert into public.treasury_ledger(user_id,amount,reason) values(u,reward,'income');
 end if;
 update public.profiles set last_action_at=ts where id=u;
 insert into public.economy_transactions(user_id,request_id,action,payload,gold_delta) values(u,p_request,p_action,p_payload,0);
 perform public.ensure_civic_state();
 update public.shared_world set revision=revision+1 where singleton=true;
 return jsonb_build_object('replayed',false,'gold_delta',0);
end $$;
revoke all on function public.game_action(text,jsonb,uuid) from public,anon;
grant execute on function public.game_action(text,jsonb,uuid) to authenticated;

alter function public.heartbeat_presence(integer,integer) rename to heartbeat_presence_before_debt;
revoke all on function public.heartbeat_presence_before_debt(integer,integer) from public,anon,authenticated;
create function public.heartbeat_presence(p_x integer,p_y integer) returns void language plpgsql security definer set search_path='' as $$
declare xx integer:=p_x; yy integer:=p_y;begin
 if auth.uid() is null then raise exception 'Connexion requise';end if;
 if exists(select 1 from public.profiles where id=auth.uid() and gold<0 and debt_since<=clock_timestamp()-interval '6 hours') then
   select coalesce(x,30),coalesce(y,31) into xx,yy from public.player_presence where user_id=auth.uid();
   xx:=coalesce(xx,30); yy:=coalesce(yy,31);
 end if;
 perform public.heartbeat_presence_before_debt(xx,yy);
end $$;
revoke all on function public.heartbeat_presence(integer,integer) from public,anon;
grant execute on function public.heartbeat_presence(integer,integer) to authenticated;

create function public.block_debt_chat() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.profiles where id=new.user_id and gold<0 and debt_since<=clock_timestamp()-interval '6 hours') then raise exception 'Jeu bloqué : seules les ventes au marché sont possibles';end if;
 return new;
end $$;
create trigger debt_chat before insert on public.chat_messages for each row execute function public.block_debt_chat();

create or replace function public.online_residents() returns jsonb language sql security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'username',p.username,'island',w.island_id,
 'x',case when z.user_id is not null then case when public.is_exile_land(s.x,s.y) then s.x else 61 end else case when public.is_land(s.x,s.y) then s.x else 30 end end,
 'y',case when z.user_id is not null then case when public.is_exile_land(s.x,s.y) then s.y else 30 end else case when public.is_land(s.x,s.y) then s.y else 31 end end,
 'online',coalesce(s.last_seen_at>clock_timestamp()-interval '90 seconds',false),
 'exiled',z.user_id is not null,'avatar',to_jsonb(a)-'user_id') order by p.id),'[]'::jsonb)
 from public.profiles p join public.avatars a on a.user_id=p.id cross join public.shared_world w
 left join public.player_presence s on s.user_id=p.id
 left join public.banishments z on z.user_id=p.id and z.ends_at>clock_timestamp()
 where auth.uid() is not null and (z.user_id is not null or s.last_seen_at>clock_timestamp()-interval '90 seconds')
$$;
-- Apply the electorate correction to any vote that was already open.
select public.ensure_civic_state();
do $$ begin
 if exists(select 1 from pg_namespace where nspname='cron') then
   perform cron.schedule('island-civic-transitions','* * * * *','select public.ensure_civic_state();');
 end if;
end $$;
commit;
