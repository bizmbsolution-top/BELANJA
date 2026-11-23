create sequence if not exists public.customer_code_seq;
create sequence if not exists public.sales_order_code_seq;

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('CUS-' || lpad(nextval('public.customer_code_seq')::text, 6, '0')),
  name text not null check (length(btrim(name)) between 2 and 160),
  phone text, email text, address text, notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id) on delete restrict
);
create index if not exists customers_active_name_idx on public.customers(is_active,name);

create table if not exists public.sales_orders (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('JUAL-' || lpad(nextval('public.sales_order_code_seq')::text, 6, '0')),
  customer_id uuid not null references public.customers(id) on delete restrict,
  project_id uuid not null references public.projects(id) on delete restrict,
  destination text not null check (length(btrim(destination)) between 2 and 500),
  sale_price_per_kg numeric(18,2) not null check (sale_price_per_kg > 0),
  notes text,
  status text not null default 'Draft' check (status in ('Draft','Dikirim','Selesai')),
  dispatched_weight_kg numeric(14,3), dispatched_purchase_cost numeric(18,2),
  dispatched_at timestamptz, dispatched_by uuid references auth.users(id) on delete restrict,
  received_weight_kg numeric(14,3), final_grade_value numeric(14,4), final_grade_unit text,
  final_price_per_kg numeric(18,2), final_amount numeric(18,2), ba_number text, ba_date date,
  discrepancy_notes text, finalized_at timestamptz, finalized_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id) on delete restrict
);
create index if not exists sales_orders_project_status_idx on public.sales_orders(project_id,status,created_at desc);
create index if not exists sales_orders_customer_idx on public.sales_orders(customer_id,created_at desc);

create table if not exists public.sales_order_lot_allocations (
  id uuid primary key default gen_random_uuid(),
  sales_order_id uuid not null references public.sales_orders(id) on delete restrict,
  lot_id uuid not null references public.inventory_lots(id) on delete restrict,
  source_warehouse_id uuid not null references public.warehouses(id) on delete restrict,
  category_id uuid not null references public.purchase_categories(id) on delete restrict,
  allocated_weight_kg numeric(14,3) not null check (allocated_weight_kg > 0),
  grade_value numeric(14,4) not null check (grade_value >= 0),
  grade_unit text not null,
  purchase_cost_per_kg numeric(18,4) not null check (purchase_cost_per_kg > 0),
  allocated_purchase_cost numeric(18,2) not null check (allocated_purchase_cost > 0),
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete restrict,
  unique(sales_order_id,lot_id)
);
create index if not exists sales_order_lot_allocations_order_idx on public.sales_order_lot_allocations(sales_order_id);
create index if not exists sales_order_lot_allocations_lot_idx on public.sales_order_lot_allocations(lot_id,created_at desc);
create index if not exists sales_order_lot_allocations_warehouse_idx on public.sales_order_lot_allocations(source_warehouse_id);

alter table public.audit_logs drop constraint if exists audit_logs_action_check;
alter table public.audit_logs add constraint audit_logs_action_check check (action = any (array[
'user.created','user.access_updated','user.email_update_requested','user.email_updated','user.email_update_failed','user.password_reset_requested','user.password_reset','user.password_reset_failed',
'supplier.created','supplier.updated','purchase_category.created','purchase_category.updated','warehouse.created','warehouse.updated','warehouse.projects_updated',
'expense_category.created','expense_category.updated','uom.created','uom.updated','expense.created','expense.updated','expense.submitted','expense.paid','expense.cancelled',
'expense_document.uploaded','expense_document.deleted','expense.payment_evidence_uploaded','project.created','project.updated','fund_request.created','fund_request.executed','fund_request.corrected','fund_request_document.uploaded',
'purchase_request.created','purchase_receipt.created','purchase_receipt.updated','purchase_receipt.accepted','purchase_receipt.rejected','purchase_payment.requested','purchase_payment.paid','purchase_receipt_document.uploaded','purchase_payment_document.uploaded',
'lot.created','customer.created','customer.updated','sales_draft.created'
]));
alter table public.audit_logs drop constraint if exists audit_logs_entity_type_check;
alter table public.audit_logs add constraint audit_logs_entity_type_check check (entity_type = any (array[
'user_access','auth_user','supplier','purchase_category','warehouse','expense_category','uom','expense','expense_document','expense_payment_document','project','fund_request','fund_request_document',
'purchase_request','purchase_receipt','purchase_payment_request','purchase_receipt_document','purchase_payment_document','inventory_lot','customer','sales_order'
]));

alter table public.customers enable row level security;
alter table public.sales_orders enable row level security;
alter table public.sales_order_lot_allocations enable row level security;
revoke all on public.customers,public.sales_orders,public.sales_order_lot_allocations from anon,authenticated;
grant all on public.customers,public.sales_orders,public.sales_order_lot_allocations to service_role;
grant usage,select on sequence public.customer_code_seq,public.sales_order_code_seq to service_role;

create or replace function public.save_customer_with_audit(
  p_customer_id uuid,p_actor_user_id uuid,p_name text,p_phone text,p_email text,p_address text,p_notes text,p_is_active boolean
) returns uuid language plpgsql set search_path='public','pg_temp' as $function$
declare v_id uuid; v_before jsonb;
begin
  if length(btrim(coalesce(p_name,''))) not between 2 and 160 then raise exception 'Invalid customer name'; end if;
  if length(coalesce(p_phone,''))>40 or length(coalesce(p_email,''))>160 or length(coalesce(p_address,''))>500 or length(coalesce(p_notes,''))>1000 then raise exception 'Customer field is too long'; end if;
  if p_customer_id is null then
    insert into public.customers(name,phone,email,address,notes,is_active,created_by,updated_by)
    values(btrim(p_name),nullif(btrim(coalesce(p_phone,'')),''),nullif(btrim(coalesce(p_email,'')),''),nullif(btrim(coalesce(p_address,'')),''),nullif(btrim(coalesce(p_notes,'')),''),coalesce(p_is_active,true),p_actor_user_id,p_actor_user_id)
    returning id into v_id;
    insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,after_data)
    values(p_actor_user_id,'customer.created','customer',v_id::text,jsonb_build_object('name',btrim(p_name),'phone',nullif(btrim(coalesce(p_phone,'')),''),'email',nullif(btrim(coalesce(p_email,'')),''),'is_active',coalesce(p_is_active,true)));
  else
    select to_jsonb(c) into v_before from public.customers c where id=p_customer_id for update;
    if v_before is null then raise exception 'Customer not found'; end if;
    update public.customers set name=btrim(p_name),phone=nullif(btrim(coalesce(p_phone,'')),''),email=nullif(btrim(coalesce(p_email,'')),''),address=nullif(btrim(coalesce(p_address,'')),''),notes=nullif(btrim(coalesce(p_notes,'')),''),is_active=coalesce(p_is_active,true),updated_at=now(),updated_by=p_actor_user_id where id=p_customer_id returning id into v_id;
    insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,before_data,after_data)
    values(p_actor_user_id,'customer.updated','customer',v_id::text,v_before,jsonb_build_object('name',btrim(p_name),'phone',nullif(btrim(coalesce(p_phone,'')),''),'email',nullif(btrim(coalesce(p_email,'')),''),'is_active',coalesce(p_is_active,true)));
  end if;
  return v_id;
end;
$function$;

create or replace function public.create_sales_draft_with_audit(
  p_actor_user_id uuid,p_customer_id uuid,p_project_id uuid,p_destination text,p_sale_price_per_kg numeric,p_notes text,p_allocations jsonb
) returns uuid language plpgsql set search_path='public','pg_temp' as $function$
declare v_id uuid; v_alloc record; v_lot public.inventory_lots%rowtype; v_available numeric; v_unit_cost numeric; v_count integer;
begin
  if not exists(select 1 from public.customers where id=p_customer_id and is_active) then raise exception 'Customer unavailable'; end if;
  if not exists(select 1 from public.projects where id=p_project_id and is_active) then raise exception 'Project unavailable'; end if;
  if length(btrim(coalesce(p_destination,''))) not between 2 and 500 then raise exception 'Invalid destination'; end if;
  if p_sale_price_per_kg is null or p_sale_price_per_kg<=0 then raise exception 'Invalid sale price'; end if;
  if p_allocations is null or jsonb_typeof(p_allocations)<>'array' or jsonb_array_length(p_allocations)<1 or jsonb_array_length(p_allocations)>100 then raise exception 'Select at least one Lot'; end if;
  select count(*) into v_count from jsonb_to_recordset(p_allocations) as x(lot_id uuid,weight_kg numeric);
  if v_count<>(select count(distinct x.lot_id) from jsonb_to_recordset(p_allocations) as x(lot_id uuid,weight_kg numeric)) then raise exception 'Duplicate Lot selection'; end if;
  perform l.id from public.inventory_lots l join (select distinct x.lot_id from jsonb_to_recordset(p_allocations) as x(lot_id uuid,weight_kg numeric)) s on s.lot_id=l.id order by l.id for update of l;
  for v_alloc in select x.lot_id,x.weight_kg from jsonb_to_recordset(p_allocations) as x(lot_id uuid,weight_kg numeric) order by x.lot_id loop
    if v_alloc.weight_kg is null or v_alloc.weight_kg<=0 then raise exception 'Invalid allocated weight'; end if;
    select * into v_lot from public.inventory_lots where id=v_alloc.lot_id;
    if not found or v_lot.project_id<>p_project_id then raise exception 'Lot does not belong to selected Project'; end if;
    if not exists(select 1 from public.warehouse_projects where project_id=p_project_id and warehouse_id=v_lot.warehouse_id) then raise exception 'Lot Warehouse is not assigned to Project'; end if;
    select coalesce(sum(case when movement_type in ('issue','transfer_out') then -weight_kg else weight_kg end),0) into v_available from public.inventory_movements where lot_id=v_lot.id;
    if v_alloc.weight_kg>v_available then raise exception 'Allocated weight exceeds available Lot stock'; end if;
  end loop;
  insert into public.sales_orders(customer_id,project_id,destination,sale_price_per_kg,notes,created_by,updated_by)
  values(p_customer_id,p_project_id,btrim(p_destination),p_sale_price_per_kg,nullif(left(btrim(coalesce(p_notes,'')),1000),''),p_actor_user_id,p_actor_user_id) returning id into v_id;
  for v_alloc in select x.lot_id,x.weight_kg from jsonb_to_recordset(p_allocations) as x(lot_id uuid,weight_kg numeric) order by x.lot_id loop
    select * into v_lot from public.inventory_lots where id=v_alloc.lot_id;
    v_unit_cost:=v_lot.total_purchase_cost/v_lot.initial_weight_kg;
    insert into public.sales_order_lot_allocations(sales_order_id,lot_id,source_warehouse_id,category_id,allocated_weight_kg,grade_value,grade_unit,purchase_cost_per_kg,allocated_purchase_cost,created_by)
    values(v_id,v_lot.id,v_lot.warehouse_id,v_lot.category_id,v_alloc.weight_kg,v_lot.grade_value,v_lot.grade_unit,v_unit_cost,round(v_unit_cost*v_alloc.weight_kg,2),p_actor_user_id);
  end loop;
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,after_data)
  values(p_actor_user_id,'sales_draft.created','sales_order',v_id::text,jsonb_build_object('customer_id',p_customer_id,'project_id',p_project_id,'destination',btrim(p_destination),'sale_price_per_kg',p_sale_price_per_kg,'allocations',p_allocations));
  return v_id;
end;
$function$;

revoke all on function public.save_customer_with_audit(uuid,uuid,text,text,text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.save_customer_with_audit(uuid,uuid,text,text,text,text,text,boolean) to service_role;
revoke all on function public.create_sales_draft_with_audit(uuid,uuid,uuid,text,numeric,text,jsonb) from public,anon,authenticated;
grant execute on function public.create_sales_draft_with_audit(uuid,uuid,uuid,text,numeric,text,jsonb) to service_role;
