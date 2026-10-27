-- Bills still in the bin stay void.
drop function if exists public.rpc_restore_bill(uuid);
drop function if exists public.rpc_delete_bill(uuid);
drop table if exists public.bill_bin;
