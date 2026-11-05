-- Casino and one shared weekly visitor. No world reset.
begin;
update public.game_rules set value=value||'{"casino":{"price":0,"points":0,"size":3,"commerce":true,"income_gold":0}}'::jsonb where key='buildings';
create table public.luck_state (
 singleton boolean primary key default true check(singleton),
 jackpot_at timestamptz,
 pol_at timestamptz not null default clock_timestamp(),
 pol_id uuid not null default gen_random_uuid()
);
insert into public.luck_state(singleton) values(true);
alter table public.luck_state enable row level security;
revoke all on public.luck_state from public,anon,authenticated;
create table public.luck_results (
 user_id uuid not null references public.profiles(id), request_id uuid not null,
 action text not null, payload jsonb not null, payout integer not null,
 primary key(user_id,request_id)
);
alter table public.luck_results enable row level security;
revoke all on public.luck_results from public,anon,authenticated;

-- Exact probabilities out of 10,000. Big lots fall back to zero during cooldown.
create function public.scratch_payout(roll integer, eligible boolean) returns integer
language sql immutable set search_path='' as $$
 select case when roll<0 or roll>=10000 then null
 when roll<3500 then 0 when roll<5500 then 1 when roll<6500 then 5
 when roll<8300 then 10 when roll<9100 then 25 when roll<9500 then 50
 when not eligible then 0 when roll<9900 then 100 else 250 end
$$;
revoke all on function public.scratch_payout(integer,boolean) from public,anon,authenticated;

alter function public.load_world(uuid) rename to load_world_before_luck;
revoke all on function public.load_world_before_luck(uuid) from public,anon,authenticated;
create function public.load_world(p_owner uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; state public.luck_state; ts timestamptz:=clock_timestamp(); begin
 result:=public.load_world_before_luck(p_owner);
 if result is null then return null;end if;
 -- A missed visit also schedules a new, randomly timed 24-hour window.
 update public.luck_state set pol_at=ts+interval '7 days'+random()*interval '24 hours',pol_id=gen_random_uuid()
 where singleton=true and pol_at+interval '24 hours'<=ts;
 select * into state from public.luck_state where singleton=true;
 -- Select a free cell at view time: construction cannot hide the visitor.
 return result||jsonb_build_object('pol',case when state.pol_at<=ts and state.pol_at+interval '24 hours'>ts
 then (select jsonb_build_object('id',state.pol_id,'x',cx,'y',cy,'until',state.pol_at+interval '24 hours')
 from generate_series(0,59) gx(cx) cross join generate_series(0,59) gy(cy)
 where public.is_land(cx,cy) and not(cx=30 and cy=31)
 and not exists(select 1 from public.buildings b where b.island_id=(result->'island'->>'id')::uuid and cx>=b.x and cx<b.x+b.size and cy>=b.y and cy<b.y+b.size)
 and not exists(select 1 from public.trees t where t.island_id=(result->'island'->>'id')::uuid and t.cut_at is null and t.x=cx and t.y=cy)
 and not exists(select 1 from public.farm_plots f where f.island_id=(result->'island'->>'id')::uuid and f.x=cx and f.y=cy)
 order by md5(state.pol_id::text||':'||cx::text||':'||cy::text) limit 1) else null end);
end $$;
revoke all on function public.load_world(uuid) from public,anon;
grant execute on function public.load_world(uuid) to authenticated;

alter function public.game_action(text,jsonb,uuid) rename to game_action_before_luck;
revoke all on function public.game_action_before_luck(text,jsonb,uuid) from public,anon,authenticated;
create function public.game_action(p_action text,p_payload jsonb,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); prof public.profiles; state public.luck_state; prior public.luck_results;
 w uuid; payout integer; cost integer:=0; ts timestamptz:=clock_timestamp(); begin
 if p_action not in ('scratch','pol_deal') then return public.game_action_before_luck(p_action,p_payload,p_request);end if;
 if u is null then raise exception 'Connexion requise';end if;
 if p_request is null or p_payload is null then raise exception 'Requête invalide';end if;
 select i.id into strict w from public.islands i join public.shared_world s on s.island_id=i.id for update of i;
 select * into prof from public.profiles where id=u for update;
 if not found then raise exception 'Profil requis';end if;
 select * into prior from public.luck_results where user_id=u and request_id=p_request;
 if found then
 if prior.action<>p_action or prior.payload<>p_payload then raise exception 'Identifiant de requête réutilisé';end if;
 return jsonb_build_object('payout',prior.payout,'replayed',true);end if;
 if exists(select 1 from public.economy_transactions where user_id=u and request_id=p_request) then raise exception 'Identifiant de requête réutilisé';end if;
 if exists(select 1 from public.banishments where user_id=u and ends_at>ts) then raise exception 'Action impossible pendant l’exil';end if;
 if prof.last_action_at>ts-interval '150 milliseconds' then raise exception 'Action trop rapide';end if;
 select * into state from public.luck_state where singleton=true for update;
 if p_action='scratch' then
 if not exists(select 1 from public.buildings where id=(p_payload->>'id')::uuid and island_id=w and kind='casino') then raise exception 'Casino introuvable';end if;
 cost:=5;
 if prof.gold<cost then raise exception 'Il faut 5 pièces pour jouer';end if;
 payout:=public.scratch_payout(floor(random()*10000)::integer,state.jackpot_at is null or state.jackpot_at<=ts-interval '14 days');
 if payout>=100 then update public.luck_state set jackpot_at=ts where singleton=true;end if;
 else
 if (p_payload->>'id')::uuid is distinct from state.pol_id or state.pol_at>ts or state.pol_at+interval '24 hours'<=ts then raise exception 'Pol est déjà reparti';end if;
 if p_payload->>'choice'='safe' then payout:=50;
 elsif p_payload->>'choice'='risk' then payout:=case when random()<0.5 then 100 else 0 end;
 else raise exception 'Choix invalide';end if;
 update public.luck_state set pol_at=ts+interval '7 days'+random()*interval '24 hours',pol_id=gen_random_uuid() where singleton=true;
 end if;
 update public.profiles set gold=gold-cost+payout,last_action_at=ts where id=u;
 insert into public.economy_transactions(user_id,request_id,action,payload,gold_delta) values(u,p_request,p_action,p_payload,payout-cost);
 insert into public.luck_results values(u,p_request,p_action,p_payload,payout);
 update public.shared_world set revision=revision+1 where singleton=true;
 return jsonb_build_object('payout',payout,'replayed',false);
end $$;
revoke all on function public.game_action(text,jsonb,uuid) from public,anon;
grant execute on function public.game_action(text,jsonb,uuid) to authenticated;
commit;
