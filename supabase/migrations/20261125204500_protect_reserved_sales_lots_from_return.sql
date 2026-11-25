do $$
declare v_def text;
begin
 select pg_get_functiondef('public.return_purchase_lot_with_audit(uuid,uuid,numeric,text)'::regprocedure) into v_def;
 v_def := replace(v_def,
   '  if v_available <= 0 then raise exception ''Lot tidak memiliki stok tersisa untuk di-Return''; end if;',
   '  if exists (select 1 from public.sales_order_lot_allocations a join public.sales_orders s on s.id=a.sales_order_id where a.lot_id=v_lot.id and s.status=''Draft'') then raise exception ''Lot sudah dialokasikan pada Draft Penjualan; selesaikan atau batalkan Draft terlebih dahulu''; end if;' || chr(10) ||
   '  if v_available <= 0 then raise exception ''Lot tidak memiliki stok tersisa untuk di-Return''; end if;');
 execute v_def;
end $$;