-- Add catalogue entries; existing buildings, wallets and timers are unchanged.
begin;
update public.game_rules set value=value || '{
 "roy_merlin":{"price":700,"points":20,"size":4,"commerce":true},
 "chocolatier":{"price":450,"points":20,"size":2,"commerce":true},
 "farm":{"price":400,"points":30,"size":4,"commerce":false},
 "hotel":{"price":900,"points":20,"size":3,"commerce":true}
}'::jsonb where key='buildings';
update public.shared_world set revision=revision+1 where singleton=true;
commit;
