-- Distinguish a completed duplicate from an in-flight delivery that the provider should retry.
drop function if exists public.claim_payment_event(public.payment_provider,text,text,jsonb);
create function public.claim_payment_event(
 p_provider public.payment_provider,p_event_id text,p_event_type text,p_payload jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
 v_claim_token uuid:=pg_catalog.gen_random_uuid(); v_now timestamptz:=pg_catalog.clock_timestamp();
 v_claimed_token uuid; v_status text;
begin
 if p_event_id is null or pg_catalog.length(pg_catalog.btrim(p_event_id))=0 then raise exception 'event_id_required'; end if;
 insert into public.payment_events(provider,event_id,event_type,payload,processing_status,attempts,locked_at,lock_token,processed_at,last_error)
 values(p_provider,p_event_id,p_event_type,coalesce(p_payload,'{}'::jsonb),'processing',1,v_now,v_claim_token,null,null)
 on conflict(provider,event_id) do update
  set event_type=excluded.event_type,payload=excluded.payload,processing_status='processing',
      attempts=payment_events.attempts+1,locked_at=v_now,lock_token=v_claim_token,processed_at=null,last_error=null
  where payment_events.processing_status in ('failed','received')
     or (payment_events.processing_status='processing' and
        (payment_events.locked_at is null or payment_events.locked_at<v_now-interval '5 minutes'))
 returning lock_token into v_claimed_token;
 if v_claimed_token is not null then return pg_catalog.jsonb_build_object('status','claimed','lock_token',v_claimed_token); end if;
 select processing_status into v_status from public.payment_events where provider=p_provider and event_id=p_event_id;
 if v_status in ('processed','needs_review') then return pg_catalog.jsonb_build_object('status','processed'); end if;
 return pg_catalog.jsonb_build_object('status','busy');
end; $function$;
revoke all on function public.claim_payment_event(public.payment_provider,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.claim_payment_event(public.payment_provider,text,text,jsonb) to service_role;
