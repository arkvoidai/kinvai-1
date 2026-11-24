-- Legacy deployments use record_payment_event; leave their deliveries claimable by new code.
alter table public.payment_events alter column processing_status set default 'received';
