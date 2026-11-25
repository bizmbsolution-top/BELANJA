-- Prevent sales allocations from consuming quantities in active quarantine.
create or replace function public.enforce_sales_allocation_excludes_quarantine()
returns trigger language plpgsql set search_path=public,pg_temp as $$
declare
  v_lot public.inventory_lots%rowtype;
  v_order_status text;
  v_stock numeric;
  v_quarantine numeric;
  v_reserved numeric;
begin
  select * into v_lot from public.inventory_lots where id=new.lot_id for update;
  if not found then raise exception 'Inventory Lot tidak ditemukan'; end if;
  select status into v_order_status from public.sales_orders where id=new.sales_order_id and tenant_id=new.tenant_id;
  if v_order_status is distinct from 'Draft' then raise exception 'Alokasi hanya dapat dibuat untuk Draft Penjualan'; end if;
  select coalesce(sum(case when movement_type in ('sale_dispatch','purchase_return') then -weight_kg else weight_kg end),0)
    into v_stock from public.inventory_movements where lot_id=new.lot_id;
  select coalesce(sum(quarantined_weight_kg-returned_weight_kg-released_weight_kg),0)
    into v_quarantine from public.inventory_lot_quarantines where lot_id=new.lot_id and status='Active';
  if v_lot.is_problematic then v_quarantine:=greatest(v_quarantine,v_stock); end if;
  select coalesce(sum(a.allocated_weight_kg),0) into v_reserved
    from public.sales_order_lot_allocations a
    join public.sales_orders s on s.id=a.sales_order_id
    where a.lot_id=new.lot_id and s.status='Draft'
      and (tg_op='INSERT' or a.id<>new.id);
  if v_reserved+new.allocated_weight_kg > greatest(v_stock-v_quarantine,0)+0.0001 then
    raise exception 'Stok normal Lot tidak mencukupi setelah dikurangi Karantina';
  end if;
  return new;
end; $$;

drop trigger if exists sales_allocation_quarantine_guard on public.sales_order_lot_allocations;
create trigger sales_allocation_quarantine_guard
before insert or update of lot_id,allocated_weight_kg,sales_order_id
on public.sales_order_lot_allocations
for each row execute function public.enforce_sales_allocation_excludes_quarantine();

revoke all on function public.enforce_sales_allocation_excludes_quarantine() from public,anon,authenticated;
