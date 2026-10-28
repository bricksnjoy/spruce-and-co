update public.document_sequences set prefix = replace(prefix, 'SC-RCT/', 'SC-BILL/')
 where type = 'bill' and prefix in ('SC-RCT/{YY}/', 'TEST-SC-RCT/{YY}/');
