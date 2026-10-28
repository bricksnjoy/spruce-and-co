-- Bills are entered once bought, as receipts: number them SC-RCT/… (only where the default prefix is unchanged).
update public.document_sequences set prefix = replace(prefix, 'SC-BILL/', 'SC-RCT/')
 where type = 'bill' and prefix in ('SC-BILL/{YY}/', 'TEST-SC-BILL/{YY}/');
