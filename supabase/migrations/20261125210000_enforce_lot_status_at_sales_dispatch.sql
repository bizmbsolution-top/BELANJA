do $$
declare v_def text;
begin
 select pg_get_functiondef('public.confirm_sales_dispatch_with_audit(uuid,uuid)'::regprocedure) into v_def;
 v_def := replace(v_def,
   'l.warehouse_id as lot_warehouse_id',
   'l.warehouse_id as lot_warehouse_id, l.is_problematic, l.is_cancelled, l.is_returned, l.source_receipt_id, l.tenant_id');
 v_def := replace(v_def,
   '    select coalesce(sum(case when movement_type in (''sale_dispatch'',''issue'',''transfer_out'',''purchase_return'') then -weight_kg else weight_kg end),0)',
   '    if v_alloc.is_problematic or v_alloc.is_cancelled or v_alloc.is_returned then raise exception ''Lot dikarantina, dibatalkan, atau sudah di-Return; Penjualan tidak dapat dikirim''; end if;' || chr(10) ||
   '    if not exists (select 1 from public.purchase_payment_requests p where p.receipt_id=v_alloc.source_receipt_id and p.tenant_id=v_alloc.tenant_id and p.status=''Lunas'') then raise exception ''Lot belum lunas''; end if;' || chr(10) ||
   '    select coalesce(sum(case when movement_type in (''sale_dispatch'',''issue'',''transfer_out'',''purchase_return'') then -weight_kg else weight_kg end),0)');
 execute v_def;
end $$;