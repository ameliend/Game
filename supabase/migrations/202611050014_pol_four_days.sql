-- Shorter visitor interval. Preserve current visits, balances and casino rules.
begin;
do $$
declare signature text; definition text;
 old_interval text := 'interval ''7 days''+random()*interval ''24 hours''';
 new_interval text := 'interval ''4 days''+random()*interval ''24 hours''';
begin
 foreach signature in array array['public.load_world(uuid)', 'public.game_action(text,jsonb,uuid)'] loop
   definition := pg_get_functiondef(signature::regprocedure);
   if strpos(definition,old_interval)>0 then
     execute replace(definition,old_interval,new_interval);
   elsif strpos(definition,new_interval)=0 then
     raise exception 'Fonction % inattendue : appliquer la migration 13 avant la 14',signature;
   end if;
 end loop;
 -- Bring existing long waits forward; do not interrupt an ongoing 24-hour visit.
 update public.luck_state
 set pol_at=clock_timestamp()+interval '4 days'+random()*interval '24 hours'
 where singleton=true and pol_at>clock_timestamp()+interval '5 days';
 update public.shared_world set revision=revision+1 where singleton=true;
end $$;
commit;
