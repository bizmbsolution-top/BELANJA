create sequence if not exists public.inventory_lot_code_seq;

create table if not exists public.inventory_lots (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('LOT-' || lpad(nextval('public.inventory_lot_code_seq')::text, 6, '0')),
  source_type text not null default 'purchase_receipt' check (source_type in ('purchase_receipt')),
  source_receipt_id uuid not null unique references public.purchase_receipts(id) on delete restrict,
  purchase_request_id uuid not null references public.purchase_requests(id) on delete restrict,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  inbound_date date not null,
  project_id uuid not null references public.projects(id) on delete restrict,
  warehouse_id uuid not null references public.warehouses(id) on delete restrict,
  category_id uuid not null references public.purchase_categories(id) on delete restrict,
  initial_weight_kg numeric(14,3) not null check (initial_weight_kg > 0),
  grade_value numeric(14,4) not null check (grade_value >= 0),
  grade_unit text not null check (length(btrim(grade_unit)) between 1 and 20),
  purchase_price_per_kg numeric(18,2) not null check (purchase_price_per_kg > 0),
  total_purchase_cost numeric(18,2) not null check (total_purchase_cost > 0),
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete restrict
);

create index if not exists inventory_lots_warehouse_idx
  on public.inventory_lots(warehouse_id, project_id, category_id, inbound_date desc);
create index if not exists inventory_lots_source_request_idx
  on public.inventory_lots(purchase_request_id);
create index if not exists inventory_lots_supplier_idx
  on public.inventory_lots(supplier_id, inbound_date desc);
create index if not exists inventory_lots_project_idx on public.inventory_lots(project_id);
create index if not exists inventory_lots_category_idx on public.inventory_lots(category_id);
create index if not exists inventory_lots_created_by_idx on public.inventory_lots(created_by);

alter table public.inventory_movements alter column receipt_id drop not null;
alter table public.inventory_movements drop constraint if exists inventory_movements_receipt_id_key;
create unique index if not exists inventory_movements_receipt_unique
  on public.inventory_movements(receipt_id) where receipt_id is not null;
alter table public.inventory_movements
  add column if not exists lot_id uuid references public.inventory_lots(id) on delete restrict;
create index if not exists inventory_movements_lot_created_idx
  on public.inventory_movements(lot_id, created_at desc);

alter table public.inventory_lots enable row level security;
revoke all on public.inventory_lots from anon, authenticated;
grant all on public.inventory_lots to service_role;
grant usage, select on sequence public.inventory_lot_code_seq to service_role;

-- Backfill accepted purchase receipts as Lots without adding a second stock movement.
insert into public.inventory_lots (
  source_receipt_id, purchase_request_id, supplier_id, inbound_date,
  project_id, warehouse_id, category_id, initial_weight_kg, grade_value,
  grade_unit, purchase_price_per_kg, total_purchase_cost, created_at, created_by
)
select
  im.receipt_id, pr.id, pr.supplier_id, r.receipt_date,
  im.project_id, im.warehouse_id, im.category_id, im.weight_kg, im.value,
  im.value_unit, pr.price_per_kg, round(im.weight_kg * pr.price_per_kg, 2),
  im.created_at, im.created_by
from public.inventory_movements im
join public.purchase_receipts r on r.id = im.receipt_id
join public.purchase_requests pr on pr.id = r.purchase_request_id
where im.movement_type = 'receipt'
  and not exists (select 1 from public.inventory_lots l where l.source_receipt_id = im.receipt_id);

update public.inventory_movements im
set lot_id = l.id
from public.inventory_lots l
where l.source_receipt_id = im.receipt_id and im.lot_id is null;

alter table public.audit_logs drop constraint if exists audit_logs_action_check;
alter table public.audit_logs add constraint audit_logs_action_check check (action = any (array[
'user.created','user.access_updated','user.email_update_requested','user.email_updated','user.email_update_failed','user.password_reset_requested','user.password_reset','user.password_reset_failed',
'supplier.created','supplier.updated','purchase_category.created','purchase_category.updated','warehouse.created','warehouse.updated','warehouse.projects_updated',
'expense_category.created','expense_category.updated','uom.created','uom.updated','expense.created','expense.updated','expense.submitted','expense.paid','expense.cancelled',
'expense_document.uploaded','expense_document.deleted','expense.payment_evidence_uploaded','project.created','project.updated','fund_request.created','fund_request.executed','fund_request.corrected','fund_request_document.uploaded',
'purchase_request.created','purchase_receipt.created','purchase_receipt.updated','purchase_receipt.accepted','purchase_receipt.rejected','purchase_payment.requested','purchase_payment.paid','purchase_receipt_document.uploaded','purchase_payment_document.uploaded',
'lot.created'
]));
alter table public.audit_logs drop constraint if exists audit_logs_entity_type_check;
alter table public.audit_logs add constraint audit_logs_entity_type_check check (entity_type = any (array[
'user_access','auth_user','supplier','purchase_category','warehouse','expense_category','uom','expense','expense_document','expense_payment_document','project','fund_request','fund_request_document',
'purchase_request','purchase_receipt','purchase_payment_request','purchase_receipt_document','purchase_payment_document','inventory_lot'
]));

insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,after_data)
select l.created_by,'lot.created','inventory_lot',l.id::text,
  jsonb_build_object('code',l.code,'source_receipt_id',l.source_receipt_id,
    'initial_weight_kg',l.initial_weight_kg,'grade_value',l.grade_value,
    'grade_unit',l.grade_unit,'purchase_price_per_kg',l.purchase_price_per_kg,
    'total_purchase_cost',l.total_purchase_cost,'backfilled',true)
from public.inventory_lots l
where not exists (
  select 1 from public.audit_logs a
  where a.action='lot.created' and a.entity_type='inventory_lot' and a.entity_id=l.id::text
);

create or replace function public.complete_purchase_receipt_with_audit(
  p_receipt_id uuid, p_actor_user_id uuid, p_decision text, p_reason text
) returns uuid
language plpgsql
set search_path = 'public', 'pg_temp'
as $function$
declare
  v_receipt public.purchase_receipts%rowtype;
  v_request public.purchase_requests%rowtype;
  v_payment_id uuid;
  v_lot_id uuid;
  v_lot_code text;
  v_weight_kg numeric;
  v_total_cost numeric;
begin
  select * into v_receipt from public.purchase_receipts where id=p_receipt_id for update;
  if not found or v_receipt.status <> 'Draft' then raise exception 'Receipt is not editable'; end if;
  if p_decision not in ('Diterima','Ditolak') then raise exception 'Invalid decision'; end if;
  if p_decision='Ditolak' and length(btrim(coalesce(p_reason,'')))<3 then raise exception 'Rejection reason required'; end if;
  if not exists(select 1 from public.purchase_receipt_documents where receipt_id=p_receipt_id and evidence_type='weight') then raise exception 'Weight evidence required'; end if;
  if not exists(select 1 from public.purchase_receipt_documents where receipt_id=p_receipt_id and evidence_type='value') then raise exception 'Value evidence required'; end if;

  select * into v_request from public.purchase_requests where id=v_receipt.purchase_request_id for update;
  if not found or v_request.status <> 'Menunggu Barang' then raise exception 'Purchase request is not open'; end if;

  update public.purchase_receipts
  set status=p_decision,
      decision_reason=case when p_decision='Ditolak' then left(btrim(p_reason),1000) else null end,
      completed_at=now(), completed_by=p_actor_user_id, updated_at=now(), updated_by=p_actor_user_id
  where id=p_receipt_id;

  if p_decision='Diterima' then
    v_weight_kg := case when v_receipt.weight_unit='ton' then v_receipt.weight*1000 else v_receipt.weight end;
    v_total_cost := round(v_weight_kg*v_request.price_per_kg,2);

    update public.purchase_requests
    set status='Selesai', updated_at=now(), updated_by=p_actor_user_id
    where id=v_request.id;

    insert into public.inventory_lots (
      source_receipt_id,purchase_request_id,supplier_id,inbound_date,
      project_id,warehouse_id,category_id,initial_weight_kg,grade_value,
      grade_unit,purchase_price_per_kg,total_purchase_cost,created_by
    ) values (
      p_receipt_id,v_request.id,v_request.supplier_id,v_receipt.receipt_date,
      v_request.project_id,v_request.warehouse_id,v_request.category_id,
      v_weight_kg,v_receipt.value,v_receipt.value_unit,
      v_request.price_per_kg,v_total_cost,p_actor_user_id
    ) returning id,code into v_lot_id,v_lot_code;

    insert into public.inventory_movements(
      movement_type,receipt_id,lot_id,project_id,warehouse_id,
      category_id,weight_kg,value,value_unit,created_by
    ) values (
      'receipt',p_receipt_id,v_lot_id,v_request.project_id,v_request.warehouse_id,
      v_request.category_id,v_weight_kg,v_receipt.value,v_receipt.value_unit,p_actor_user_id
    );

    insert into public.purchase_payment_requests(receipt_id,amount,requested_by)
    values(p_receipt_id,v_total_cost,p_actor_user_id) returning id into v_payment_id;

    insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,after_data)
    values(p_actor_user_id,'lot.created','inventory_lot',v_lot_id::text,
      jsonb_build_object('code',v_lot_code,'source_receipt_id',p_receipt_id,
        'initial_weight_kg',v_weight_kg,'grade_value',v_receipt.value,'grade_unit',v_receipt.value_unit,
        'purchase_price_per_kg',v_request.price_per_kg,'total_purchase_cost',v_total_cost));
    insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,after_data)
    values(p_actor_user_id,'purchase_receipt.accepted','purchase_receipt',p_receipt_id::text,
      jsonb_build_object('weight_kg',v_weight_kg,'value',v_receipt.value,'lot_id',v_lot_id,
        'lot_code',v_lot_code,'payment_request_id',v_payment_id,'payment_amount',v_total_cost));
    insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,after_data)
    values(p_actor_user_id,'purchase_payment.requested','purchase_payment_request',v_payment_id::text,
      jsonb_build_object('receipt_id',p_receipt_id,'amount',v_total_cost));
  else
    insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,after_data)
    values(p_actor_user_id,'purchase_receipt.rejected','purchase_receipt',p_receipt_id::text,
      jsonb_build_object('reason',left(btrim(p_reason),1000)));
  end if;
  return v_payment_id;
end;
$function$;

revoke all on function public.complete_purchase_receipt_with_audit(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.complete_purchase_receipt_with_audit(uuid,uuid,text,text) to service_role;
