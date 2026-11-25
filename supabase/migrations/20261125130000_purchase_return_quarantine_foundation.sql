-- Purchase Return Draft/Posted and quantity-based quarantine foundation.
-- Additive only: existing inventory and payment history are preserved.

alter table public.purchase_receipts
  add column if not exists received_weight_kg numeric,
  add column if not exists accepted_weight_kg numeric,
  add column if not exists rejected_weight_kg numeric,
  add column if not exists rejection_reason text;

update public.purchase_receipts
set received_weight_kg = case when weight_unit='ton' then weight*1000 else weight end,
    accepted_weight_kg = case when status='Diterima' then (case when weight_unit='ton' then weight*1000 else weight end) else 0 end,
    rejected_weight_kg = case when status='Ditolak' then (case when weight_unit='ton' then weight*1000 else weight end) else 0 end,
    rejection_reason = case when status='Ditolak' then decision_reason else null end
where received_weight_kg is null;

alter table public.purchase_receipts
  add constraint purchase_receipts_received_weight_nonnegative check (received_weight_kg is null or received_weight_kg >= 0),
  add constraint purchase_receipts_accepted_weight_nonnegative check (accepted_weight_kg is null or accepted_weight_kg >= 0),
  add constraint purchase_receipts_rejected_weight_nonnegative check (rejected_weight_kg is null or rejected_weight_kg >= 0),
  add constraint purchase_receipts_weight_split_check check (
    received_weight_kg is null or accepted_weight_kg is null or rejected_weight_kg is null
    or abs(received_weight_kg - accepted_weight_kg - rejected_weight_kg) <= 0.0001
  );

create table if not exists public.inventory_lot_quarantines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  lot_id uuid not null references public.inventory_lots(id) on delete restrict,
  quarantined_weight_kg numeric not null check (quarantined_weight_kg > 0),
  returned_weight_kg numeric not null default 0 check (returned_weight_kg >= 0),
  released_weight_kg numeric not null default 0 check (released_weight_kg >= 0),
  reason text not null check (length(btrim(reason)) >= 3),
  status text not null default 'Active' check (status in ('Active','Closed')),
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  closed_at timestamptz,
  closed_by uuid references auth.users(id),
  constraint inventory_lot_quarantines_consumed_check
    check (returned_weight_kg + released_weight_kg <= quarantined_weight_kg + 0.0001)
);
create index if not exists inventory_lot_quarantines_lot_idx
  on public.inventory_lot_quarantines(tenant_id, lot_id, status);
alter table public.inventory_lot_quarantines enable row level security;

create sequence if not exists public.purchase_return_code_seq;
create table if not exists public.purchase_returns (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('RTB-' || lpad(nextval('purchase_return_code_seq')::text,6,'0')),
  tenant_id uuid not null references public.tenants(id),
  status text not null default 'Draft' check (status in ('Draft','Posted','Cancelled')),
  return_date date not null default current_date,
  reason text not null check (length(btrim(reason)) >= 3),
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  posted_at timestamptz,
  posted_by uuid references auth.users(id),
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users(id)
);
create table if not exists public.purchase_return_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  purchase_return_id uuid not null references public.purchase_returns(id) on delete restrict,
  quarantine_id uuid not null references public.inventory_lot_quarantines(id) on delete restrict,
  lot_id uuid not null references public.inventory_lots(id) on delete restrict,
  weight_kg numeric not null check (weight_kg > 0),
  created_at timestamptz not null default now()
);
create index if not exists purchase_returns_tenant_status_idx on public.purchase_returns(tenant_id,status,created_at desc);
create index if not exists purchase_return_items_header_idx on public.purchase_return_items(tenant_id,purchase_return_id);
create index if not exists purchase_return_items_quarantine_idx on public.purchase_return_items(tenant_id,quarantine_id);
alter table public.purchase_returns enable row level security;
alter table public.purchase_return_items enable row level security;

create or replace function public.quarantine_inventory_lot_with_audit(
  p_lot_id uuid, p_actor_user_id uuid, p_weight_kg numeric, p_reason text
) returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_lot public.inventory_lots%rowtype;
  v_stock numeric;
  v_quarantined numeric;
  v_id uuid;
  v_reason text := left(btrim(coalesce(p_reason,'')),1000);
begin
  if p_lot_id is null or p_actor_user_id is null or p_weight_kg is null or p_weight_kg <= 0 or length(v_reason)<3 then
    raise exception 'Lot, berat karantina, dan alasan wajib valid';
  end if;
  select * into v_lot from public.inventory_lots where id=p_lot_id for update;
  if not found or v_lot.is_cancelled or v_lot.is_returned then raise exception 'Lot tidak tersedia untuk karantina'; end if;
  select coalesce(sum(case when movement_type in ('sale_dispatch','purchase_return') then -weight_kg else weight_kg end),0)
    into v_stock from public.inventory_movements where lot_id=p_lot_id;
  select coalesce(sum(quarantined_weight_kg-returned_weight_kg-released_weight_kg),0)
    into v_quarantined from public.inventory_lot_quarantines where lot_id=p_lot_id and status='Active';
  if exists(select 1 from public.sales_order_lot_allocations a join public.sales_orders s on s.id=a.sales_order_id where a.lot_id=p_lot_id and s.status='Draft') then
    raise exception 'Lot masih dialokasikan pada Draft Penjualan';
  end if;
  if p_weight_kg > v_stock-v_quarantined then raise exception 'Berat karantina melebihi stok normal yang tersedia'; end if;
  insert into public.inventory_lot_quarantines(tenant_id,lot_id,quarantined_weight_kg,reason,created_by)
    values(v_lot.tenant_id,v_lot.id,p_weight_kg,v_reason,p_actor_user_id) returning id into v_id;
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,before_data,after_data,tenant_id)
    values(p_actor_user_id,'lot.quarantined','inventory_lot',v_lot.id::text,
      jsonb_build_object('normal_stock_kg',v_stock-v_quarantined),
      jsonb_build_object('quarantine_id',v_id,'quarantined_weight_kg',p_weight_kg,'reason',v_reason),v_lot.tenant_id);
  return v_id;
end;
$$;

create or replace function public.create_purchase_return_draft_with_audit(
  p_actor_user_id uuid, p_tenant_id uuid, p_return_date date, p_reason text, p_notes text, p_items jsonb
) returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_item record;
  v_q public.inventory_lot_quarantines%rowtype;
  v_reserved numeric;
  v_available numeric;
  v_count integer;
begin
  if p_actor_user_id is null or p_tenant_id is null or p_return_date is null or length(btrim(coalesce(p_reason,'')))<3
    or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)<1 then raise exception 'Data Draft Return tidak lengkap'; end if;
  select count(*) into v_count from jsonb_to_recordset(p_items) as x(quarantine_id uuid,weight_kg numeric);
  if v_count<>(select count(distinct x.quarantine_id) from jsonb_to_recordset(p_items) as x(quarantine_id uuid,weight_kg numeric)) then
    raise exception 'Karantina duplikat dalam satu Draft'; end if;
  insert into public.purchase_returns(tenant_id,status,return_date,reason,notes,created_by)
    values(p_tenant_id,'Draft',p_return_date,left(btrim(p_reason),1000),nullif(left(btrim(coalesce(p_notes,'')),1000),''),p_actor_user_id)
    returning id into v_id;
  for v_item in select * from jsonb_to_recordset(p_items) as x(quarantine_id uuid,weight_kg numeric) order by quarantine_id loop
    if v_item.weight_kg is null or v_item.weight_kg<=0 then raise exception 'Berat Return Draft tidak valid'; end if;
    select * into v_q from public.inventory_lot_quarantines where id=v_item.quarantine_id and tenant_id=p_tenant_id for update;
    if not found or v_q.status<>'Active' then raise exception 'Data Karantina tidak tersedia'; end if;
    select coalesce(sum(i.weight_kg),0) into v_reserved
      from public.purchase_return_items i join public.purchase_returns r on r.id=i.purchase_return_id
      where i.quarantine_id=v_q.id and r.status='Draft';
    v_available:=v_q.quarantined_weight_kg-v_q.returned_weight_kg-v_q.released_weight_kg-v_reserved;
    if v_item.weight_kg>v_available then raise exception 'Berat melebihi saldo Karantina yang belum dialokasikan'; end if;
    insert into public.purchase_return_items(tenant_id,purchase_return_id,quarantine_id,lot_id,weight_kg)
      values(p_tenant_id,v_id,v_q.id,v_q.lot_id,v_item.weight_kg);
  end loop;
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,after_data,tenant_id)
    values(p_actor_user_id,'purchase_return.draft_created','purchase_return',v_id::text,
      jsonb_build_object('return_date',p_return_date,'reason',left(btrim(p_reason),1000),'items',p_items),p_tenant_id);
  return v_id;
end;
$$;

create or replace function public.cancel_purchase_return_draft_with_audit(p_return_id uuid,p_actor_user_id uuid,p_tenant_id uuid)
returns uuid language plpgsql set search_path=public,pg_temp as $$
declare v_return public.purchase_returns%rowtype;
begin
  select * into v_return from public.purchase_returns where id=p_return_id and tenant_id=p_tenant_id for update;
  if not found or v_return.status<>'Draft' then raise exception 'Hanya Draft Return yang dapat dibatalkan'; end if;
  update public.purchase_returns set status='Cancelled',cancelled_at=now(),cancelled_by=p_actor_user_id where id=p_return_id;
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,before_data,after_data,tenant_id)
    values(p_actor_user_id,'purchase_return.cancelled','purchase_return',p_return_id::text,
      jsonb_build_object('status','Draft'),jsonb_build_object('status','Cancelled'),p_tenant_id);
  return p_return_id;
end; $$;

create or replace function public.post_purchase_return_with_audit(p_return_id uuid,p_actor_user_id uuid,p_tenant_id uuid)
returns uuid language plpgsql set search_path=public,pg_temp as $$
declare
  v_return public.purchase_returns%rowtype;
  v_item record;
  v_q public.inventory_lot_quarantines%rowtype;
  v_reserved numeric;
  v_stock numeric;
begin
  select * into v_return from public.purchase_returns where id=p_return_id and tenant_id=p_tenant_id for update;
  if not found or v_return.status<>'Draft' then raise exception 'Hanya Draft Return yang dapat di-Posted'; end if;
  if not exists(select 1 from public.purchase_return_items where purchase_return_id=p_return_id and tenant_id=p_tenant_id) then raise exception 'Draft Return tidak memiliki item'; end if;
  for v_item in select * from public.purchase_return_items where purchase_return_id=p_return_id order by quarantine_id loop
    select * into v_q from public.inventory_lot_quarantines where id=v_item.quarantine_id and tenant_id=p_tenant_id for update;
    select coalesce(sum(i.weight_kg),0) into v_reserved
      from public.purchase_return_items i join public.purchase_returns r on r.id=i.purchase_return_id
      where i.quarantine_id=v_q.id and r.status='Draft' and r.id<>p_return_id;
    if v_item.weight_kg>v_q.quarantined_weight_kg-v_q.returned_weight_kg-v_q.released_weight_kg-v_reserved then
      raise exception 'Saldo Karantina berubah; Draft Return tidak dapat di-Posted';
    end if;
    select coalesce(sum(case when movement_type in ('sale_dispatch','purchase_return') then -weight_kg else weight_kg end),0)
      into v_stock from public.inventory_movements where lot_id=v_item.lot_id;
    if v_item.weight_kg>v_stock then raise exception 'Stok fisik Lot tidak mencukupi'; end if;
    update public.inventory_lot_quarantines set returned_weight_kg=returned_weight_kg+v_item.weight_kg,
      status=case when returned_weight_kg+v_item.weight_kg+released_weight_kg>=quarantined_weight_kg-0.0001 then 'Closed' else 'Active' end,
      closed_at=case when returned_weight_kg+v_item.weight_kg+released_weight_kg>=quarantined_weight_kg-0.0001 then now() else null end,
      closed_by=case when returned_weight_kg+v_item.weight_kg+released_weight_kg>=quarantined_weight_kg-0.0001 then p_actor_user_id else null end
      where id=v_q.id;
    insert into public.inventory_movements(movement_type,receipt_id,lot_id,project_id,warehouse_id,category_id,weight_kg,value,value_unit,created_by,reason,tenant_id)
      select 'purchase_return',l.source_receipt_id,l.id,l.project_id,l.warehouse_id,l.category_id,v_item.weight_kg,l.grade_value,l.grade_unit,p_actor_user_id,
        'Return '||v_return.id::text||': '||v_return.reason,l.tenant_id from public.inventory_lots l where l.id=v_item.lot_id;
    update public.inventory_lots l set is_returned=true,returned_at=now(),returned_by=p_actor_user_id
      where l.id=v_item.lot_id and not exists(
        select 1 from public.inventory_movements m where m.lot_id=l.id
        group by m.lot_id having sum(case when movement_type in ('sale_dispatch','purchase_return') then -weight_kg else weight_kg end)>0.0001
      );
  end loop;
  update public.purchase_returns set status='Posted',posted_at=now(),posted_by=p_actor_user_id where id=p_return_id;
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,before_data,after_data,tenant_id)
    values(p_actor_user_id,'purchase_return.posted','purchase_return',p_return_id::text,
      jsonb_build_object('status','Draft'),
      jsonb_build_object('status','Posted','items',(select jsonb_agg(jsonb_build_object('lot_id',lot_id,'quarantine_id',quarantine_id,'weight_kg',weight_kg)) from public.purchase_return_items where purchase_return_id=p_return_id)),p_tenant_id);
  return p_return_id;
end; $$;

revoke all on function public.quarantine_inventory_lot_with_audit(uuid,uuid,numeric,text) from public, anon, authenticated;
revoke all on function public.create_purchase_return_draft_with_audit(uuid,uuid,date,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.cancel_purchase_return_draft_with_audit(uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public.post_purchase_return_with_audit(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.quarantine_inventory_lot_with_audit(uuid,uuid,numeric,text) to service_role;
grant execute on function public.create_purchase_return_draft_with_audit(uuid,uuid,date,text,text,jsonb) to service_role;
grant execute on function public.cancel_purchase_return_draft_with_audit(uuid,uuid,uuid) to service_role;
grant execute on function public.post_purchase_return_with_audit(uuid,uuid,uuid) to service_role;
