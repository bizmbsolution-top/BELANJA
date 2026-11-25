-- Sales eligibility is based on receipt/rejection status, not payment status.
-- An accepted, physically received Lot remains sellable while payment is pending.
-- Rejected/cancelled/problematic/returned Lots remain blocked at draft and dispatch.

do $$
declare
  v_def text;
  v_old text;
begin
  select pg_get_functiondef('public.create_sales_draft_with_audit(uuid,uuid,uuid,text,numeric,text,jsonb)'::regprocedure)
    into v_def;

  v_old := '    if v_lot.is_problematic then raise exception ''Lot is marked Bermasalah and cannot be added to Sales''; end if;' || chr(10) ||
    '    if not exists (' || chr(10) ||
    '      select 1 from public.purchase_payment_requests p' || chr(10) ||
    '      where p.receipt_id = v_lot.source_receipt_id' || chr(10) ||
    '        and p.tenant_id = v_lot.tenant_id' || chr(10) ||
    '        and p.status = ''Lunas''' || chr(10) ||
    '    ) then raise exception ''Lot is not fully paid and cannot be added to Sales''; end if;';

  if position(v_old in v_def) = 0 then
    raise exception 'Expected sales draft payment gate was not found; migration stopped';
  end if;

  v_def := replace(v_def, v_old,
    '    if v_lot.is_problematic or v_lot.is_cancelled or v_lot.is_returned or exists (' || chr(10) ||
    '      select 1 from public.purchase_receipts r where r.id=v_lot.source_receipt_id and r.status in (''Ditolak'',''Dibatalkan'')' || chr(10) ||
    '    ) then raise exception ''Lot berstatus Reject/Ditolak, Karantina, Dibatalkan, atau sudah di-Return; tidak dapat ditambahkan ke Sales''; end if;');
  execute v_def;

  select pg_get_functiondef('public.confirm_sales_dispatch_with_audit(uuid,uuid)'::regprocedure)
    into v_def;

  v_old := '    if v_alloc.is_problematic or v_alloc.is_cancelled or v_alloc.is_returned then raise exception ''Lot dikarantina, dibatalkan, atau sudah di-Return; Penjualan tidak dapat dikirim''; end if;' || chr(10) ||
    '    if not exists (select 1 from public.purchase_payment_requests p where p.receipt_id=v_alloc.source_receipt_id and p.tenant_id=v_alloc.tenant_id and p.status=''Lunas'') then raise exception ''Lot belum lunas''; end if;';

  if position(v_old in v_def) = 0 then
    raise exception 'Expected sales dispatch payment gate was not found; migration stopped';
  end if;

  v_def := replace(v_def, v_old,
    '    if v_alloc.is_problematic or v_alloc.is_cancelled or v_alloc.is_returned or exists (' || chr(10) ||
    '      select 1 from public.purchase_receipts r where r.id=v_alloc.source_receipt_id and r.status in (''Ditolak'',''Dibatalkan'')' || chr(10) ||
    '    ) then raise exception ''Lot berstatus Reject/Ditolak, Karantina, Dibatalkan, atau sudah di-Return; Penjualan tidak dapat dikirim''; end if;');
  execute v_def;
end $$;
