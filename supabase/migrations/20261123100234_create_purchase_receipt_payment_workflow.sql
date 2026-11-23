create sequence if not exists public.purchase_request_code_seq;
create sequence if not exists public.purchase_receipt_code_seq;
create sequence if not exists public.purchase_payment_code_seq;

create table if not exists public.purchase_requests (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('PBL-' || lpad(nextval('public.purchase_request_code_seq')::text, 6, '0')),
  request_date date not null default current_date,
  project_id uuid not null references public.projects(id),
  supplier_id uuid not null references public.suppliers(id),
  warehouse_id uuid not null references public.warehouses(id),
  category_id uuid not null references public.purchase_categories(id),
  estimated_weight_kg numeric(14,3) not null check (estimated_weight_kg > 0),
  price_per_kg numeric(18,2) not null check (price_per_kg > 0),
  notes text,
  status text not null default 'Menunggu Barang' check (status in ('Menunggu Barang','Selesai','Dibatalkan')),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
create index if not exists purchase_requests_project_status_idx on public.purchase_requests(project_id,status,created_at desc);
create index if not exists purchase_requests_warehouse_idx on public.purchase_requests(warehouse_id,created_at desc);

create table if not exists public.purchase_receipts (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('RCV-' || lpad(nextval('public.purchase_receipt_code_seq')::text, 6, '0')),
  purchase_request_id uuid not null references public.purchase_requests(id),
  receipt_date date not null default current_date,
  value numeric(14,4) not null check (value >= 0),
  value_unit text not null default '%',
  weight numeric(14,3) not null check (weight > 0),
  weight_unit text not null default 'kg' check (weight_unit in ('kg','ton')),
  notes text,
  status text not null default 'Draft' check (status in ('Draft','Diterima','Ditolak')),
  decision_reason text,
  completed_at timestamptz,
  completed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  check (length(btrim(value_unit)) between 1 and 20)
);
create index if not exists purchase_receipts_request_idx on public.purchase_receipts(purchase_request_id,created_at desc);
create index if not exists purchase_receipts_status_idx on public.purchase_receipts(status,created_at desc);

create table if not exists public.purchase_receipt_documents (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.purchase_receipts(id),
  evidence_type text not null check (evidence_type in ('weight','value')),
  bucket_id text not null default 'purchase-receipt-evidence' check (bucket_id = 'purchase-receipt-evidence'),
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp')),
  file_size bigint not null check (file_size > 0 and file_size <= 10485760),
  uploaded_at timestamptz not null default now(),
  uploaded_by uuid not null references auth.users(id) on delete restrict
);
create index if not exists purchase_receipt_documents_receipt_idx on public.purchase_receipt_documents(receipt_id,evidence_type);

create table if not exists public.purchase_payment_requests (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('PBY-' || lpad(nextval('public.purchase_payment_code_seq')::text, 6, '0')),
  receipt_id uuid not null unique references public.purchase_receipts(id),
  amount numeric(18,2) not null check (amount > 0),
  status text not null default 'Menunggu Pembayaran' check (status in ('Menunggu Pembayaran','Lunas')),
  requested_at timestamptz not null default now(),
  requested_by uuid not null references auth.users(id) on delete restrict,
  paid_amount numeric(18,2),
  paid_at timestamptz,
  paid_by uuid references auth.users(id) on delete set null,
  payment_method text check (payment_method is null or payment_method = 'Transfer'),
  payment_note text
);
create index if not exists purchase_payment_requests_status_idx on public.purchase_payment_requests(status,requested_at desc);

create table if not exists public.purchase_payment_documents (
  id uuid primary key default gen_random_uuid(),
  payment_request_id uuid not null references public.purchase_payment_requests(id),
  bucket_id text not null default 'purchase-payment-evidence' check (bucket_id = 'purchase-payment-evidence'),
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null check (mime_type in ('application/pdf','image/jpeg','image/png')),
  file_size bigint not null check (file_size > 0 and file_size <= 10485760),
  uploaded_at timestamptz not null default now(),
  uploaded_by uuid not null references auth.users(id) on delete restrict
);
create index if not exists purchase_payment_documents_request_idx on public.purchase_payment_documents(payment_request_id);

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  movement_type text not null check (movement_type = 'receipt'),
  receipt_id uuid not null unique references public.purchase_receipts(id),
  project_id uuid not null references public.projects(id),
  warehouse_id uuid not null references public.warehouses(id),
  category_id uuid not null references public.purchase_categories(id),
  weight_kg numeric(14,3) not null check (weight_kg > 0),
  value numeric(14,4) not null check (value >= 0),
  value_unit text not null,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete restrict
);
create index if not exists inventory_movements_stock_idx on public.inventory_movements(warehouse_id,category_id,created_at desc);

alter table public.project_cash_ledger add column if not exists purchase_payment_request_id uuid references public.purchase_payment_requests(id);
create unique index if not exists project_cash_ledger_purchase_payment_unique on public.project_cash_ledger(purchase_payment_request_id) where purchase_payment_request_id is not null;

alter table public.audit_logs drop constraint if exists audit_logs_action_check;
alter table public.audit_logs add constraint audit_logs_action_check check (action = any (array[
'user.created','user.access_updated','user.email_update_requested','user.email_updated','user.email_update_failed','user.password_reset_requested','user.password_reset','user.password_reset_failed',
'supplier.created','supplier.updated','purchase_category.created','purchase_category.updated','warehouse.created','warehouse.updated','warehouse.projects_updated',
'expense_category.created','expense_category.updated','uom.created','uom.updated','expense.created','expense.updated','expense.submitted','expense.paid','expense.cancelled',
'expense_document.uploaded','expense_document.deleted','expense.payment_evidence_uploaded','project.created','project.updated','fund_request.created','fund_request.executed','fund_request.corrected','fund_request_document.uploaded',
'purchase_request.created','purchase_receipt.created','purchase_receipt.updated','purchase_receipt.accepted','purchase_receipt.rejected','purchase_payment.requested','purchase_payment.paid','purchase_receipt_document.uploaded','purchase_payment_document.uploaded'
]));
alter table public.audit_logs drop constraint if exists audit_logs_entity_type_check;
alter table public.audit_logs add constraint audit_logs_entity_type_check check (entity_type = any (array[
'user_access','auth_user','supplier','purchase_category','warehouse','expense_category','uom','expense','expense_document','expense_payment_document','project','fund_request','fund_request_document',
'purchase_request','purchase_receipt','purchase_payment_request','purchase_receipt_document','purchase_payment_document'
]));

alter table public.purchase_requests enable row level security;
alter table public.purchase_receipts enable row level security;
alter table public.purchase_receipt_documents enable row level security;
alter table public.purchase_payment_requests enable row level security;
alter table public.purchase_payment_documents enable row level security;
alter table public.inventory_movements enable row level security;

revoke all on public.purchase_requests,public.purchase_receipts,public.purchase_receipt_documents,public.purchase_payment_requests,public.purchase_payment_documents,public.inventory_movements from anon,authenticated;
grant all on public.purchase_requests,public.purchase_receipts,public.purchase_receipt_documents,public.purchase_payment_requests,public.purchase_payment_documents,public.inventory_movements to service_role;
grant usage,select on sequence public.purchase_request_code_seq,public.purchase_receipt_code_seq,public.purchase_payment_code_seq to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('purchase-receipt-evidence','purchase-receipt-evidence',false,10485760,array['image/jpeg','image/png','image/webp']),
       ('purchase-payment-evidence','purchase-payment-evidence',false,10485760,array['application/pdf','image/jpeg','image/png'])
on conflict (id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create or replace function public.create_purchase_request_with_audit(
  p_actor_user_id uuid,p_request_date date,p_project_id uuid,p_supplier_id uuid,p_warehouse_id uuid,p_category_id uuid,
  p_estimated_weight_kg numeric,p_price_per_kg numeric,p_notes text
) returns uuid language plpgsql set search_path='public','pg_temp' as $$
declare v_id uuid;
begin
  if not exists(select 1 from public.projects where id=p_project_id and is_active) then raise exception 'Project unavailable'; end if;
  if not exists(select 1 from public.suppliers where id=p_supplier_id and is_active) then raise exception 'Supplier unavailable'; end if;
  if not exists(select 1 from public.purchase_categories where id=p_category_id and is_active) then raise exception 'Category unavailable'; end if;
  if not exists(select 1 from public.warehouses w join public.warehouse_projects wp on wp.warehouse_id=w.id where w.id=p_warehouse_id and w.is_active and wp.project_id=p_project_id) then raise exception 'Warehouse is not assigned to Project'; end if;
  if p_estimated_weight_kg<=0 or p_price_per_kg<=0 then raise exception 'Invalid purchase quantity or price'; end if;
  insert into public.purchase_requests(request_date,project_id,supplier_id,warehouse_id,category_id,estimated_weight_kg,price_per_kg,notes,created_by,updated_by)
  values(p_request_date,p_project_id,p_supplier_id,p_warehouse_id,p_category_id,p_estimated_weight_kg,p_price_per_kg,nullif(left(btrim(coalesce(p_notes,'')),1000),''),p_actor_user_id,p_actor_user_id)
  returning id into v_id;
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,after_data)
  values(p_actor_user_id,'purchase_request.created','purchase_request',v_id::text,jsonb_build_object('project_id',p_project_id,'supplier_id',p_supplier_id,'warehouse_id',p_warehouse_id,'category_id',p_category_id,'estimated_weight_kg',p_estimated_weight_kg,'price_per_kg',p_price_per_kg));
  return v_id;
end; $$;

create or replace function public.create_purchase_receipt_draft_with_audit(
  p_actor_user_id uuid,p_purchase_request_id uuid,p_receipt_date date,p_value numeric,p_value_unit text,p_weight numeric,p_weight_unit text,p_notes text
) returns uuid language plpgsql set search_path='public','pg_temp' as $$
declare v_id uuid;
begin
  if not exists(select 1 from public.purchase_requests where id=p_purchase_request_id and status='Menunggu Barang') then raise exception 'Purchase request is not open'; end if;
  if p_value<0 or p_weight<=0 or p_weight_unit not in ('kg','ton') or length(btrim(p_value_unit)) not between 1 and 20 then raise exception 'Invalid receipt values'; end if;
  insert into public.purchase_receipts(purchase_request_id,receipt_date,value,value_unit,weight,weight_unit,notes,created_by,updated_by)
  values(p_purchase_request_id,p_receipt_date,p_value,p_value_unit,p_weight,p_weight_unit,nullif(left(btrim(coalesce(p_notes,'')),1000),''),p_actor_user_id,p_actor_user_id)
  returning id into v_id;
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,after_data)
  values(p_actor_user_id,'purchase_receipt.created','purchase_receipt',v_id::text,jsonb_build_object('purchase_request_id',p_purchase_request_id,'value',p_value,'value_unit',p_value_unit,'weight',p_weight,'weight_unit',p_weight_unit));
  return v_id;
end; $$;

create or replace function public.register_purchase_receipt_document_with_audit(
  p_receipt_id uuid,p_actor_user_id uuid,p_evidence_type text,p_storage_path text,p_file_name text,p_mime_type text,p_file_size bigint
) returns uuid language plpgsql set search_path='public','pg_temp' as $$
declare v_id uuid;
begin
  if p_evidence_type not in ('weight','value') then raise exception 'Invalid evidence type'; end if;
  if not exists(select 1 from public.purchase_receipts where id=p_receipt_id and status='Draft') then raise exception 'Receipt is locked'; end if;
  if p_mime_type not in ('image/jpeg','image/png','image/webp') or p_file_size<=0 or p_file_size>10485760 then raise exception 'Invalid file'; end if;
  insert into public.purchase_receipt_documents(receipt_id,evidence_type,storage_path,file_name,mime_type,file_size,uploaded_by)
  values(p_receipt_id,p_evidence_type,p_storage_path,left(p_file_name,255),p_mime_type,p_file_size,p_actor_user_id) returning id into v_id;
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,after_data)
  values(p_actor_user_id,'purchase_receipt_document.uploaded','purchase_receipt_document',v_id::text,jsonb_build_object('receipt_id',p_receipt_id,'evidence_type',p_evidence_type,'file_name',left(p_file_name,255),'file_size',p_file_size));
  return v_id;
end; $$;

create or replace function public.complete_purchase_receipt_with_audit(p_receipt_id uuid,p_actor_user_id uuid,p_decision text,p_reason text)
returns uuid language plpgsql set search_path='public','pg_temp' as $$
declare v_receipt public.purchase_receipts%rowtype; v_request public.purchase_requests%rowtype; v_payment_id uuid; v_weight_kg numeric;
begin
  select * into v_receipt from public.purchase_receipts where id=p_receipt_id for update;
  if not found or v_receipt.status<>'Draft' then raise exception 'Receipt is not editable'; end if;
  if p_decision not in ('Diterima','Ditolak') then raise exception 'Invalid decision'; end if;
  if p_decision='Ditolak' and length(btrim(coalesce(p_reason,'')))<3 then raise exception 'Rejection reason required'; end if;
  if not exists(select 1 from public.purchase_receipt_documents where receipt_id=p_receipt_id and evidence_type='weight') then raise exception 'Weight evidence required'; end if;
  if not exists(select 1 from public.purchase_receipt_documents where receipt_id=p_receipt_id and evidence_type='value') then raise exception 'Value evidence required'; end if;
  select * into v_request from public.purchase_requests where id=v_receipt.purchase_request_id for update;
  if not found or v_request.status<>'Menunggu Barang' then raise exception 'Purchase request is not open'; end if;
  update public.purchase_receipts set status=p_decision,decision_reason=case when p_decision='Ditolak' then left(btrim(p_reason),1000) else null end,completed_at=now(),completed_by=p_actor_user_id,updated_at=now(),updated_by=p_actor_user_id where id=p_receipt_id;
  if p_decision='Diterima' then
    v_weight_kg:=case when v_receipt.weight_unit='ton' then v_receipt.weight*1000 else v_receipt.weight end;
    insert into public.inventory_movements(movement_type,receipt_id,project_id,warehouse_id,category_id,weight_kg,value,value_unit,created_by)
    values('receipt',p_receipt_id,v_request.project_id,v_request.warehouse_id,v_request.category_id,v_weight_kg,v_receipt.value,v_receipt.value_unit,p_actor_user_id);
    insert into public.purchase_payment_requests(receipt_id,amount,requested_by)
    values(p_receipt_id,round(v_weight_kg*v_request.price_per_kg,2),p_actor_user_id) returning id into v_payment_id;
    insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,after_data)
    values(p_actor_user_id,'purchase_receipt.accepted','purchase_receipt',p_receipt_id::text,jsonb_build_object('weight_kg',v_weight_kg,'value',v_receipt.value,'payment_request_id',v_payment_id,'payment_amount',round(v_weight_kg*v_request.price_per_kg,2)));
    insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,after_data)
    values(p_actor_user_id,'purchase_payment.requested','purchase_payment_request',v_payment_id::text,jsonb_build_object('receipt_id',p_receipt_id,'amount',round(v_weight_kg*v_request.price_per_kg,2)));
  else
    insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,after_data)
    values(p_actor_user_id,'purchase_receipt.rejected','purchase_receipt',p_receipt_id::text,jsonb_build_object('reason',left(btrim(p_reason),1000)));
  end if;
  return v_payment_id;
end; $$;

create or replace function public.register_purchase_payment_document_with_audit(
  p_payment_request_id uuid,p_actor_user_id uuid,p_storage_path text,p_file_name text,p_mime_type text,p_file_size bigint
) returns uuid language plpgsql set search_path='public','pg_temp' as $$
declare v_id uuid;
begin
  if not exists(select 1 from public.purchase_payment_requests where id=p_payment_request_id and status='Menunggu Pembayaran') then raise exception 'Payment request is not awaiting payment'; end if;
  if p_mime_type not in ('application/pdf','image/jpeg','image/png') or p_file_size<=0 or p_file_size>10485760 then raise exception 'Invalid file'; end if;
  insert into public.purchase_payment_documents(payment_request_id,storage_path,file_name,mime_type,file_size,uploaded_by)
  values(p_payment_request_id,p_storage_path,left(p_file_name,255),p_mime_type,p_file_size,p_actor_user_id) returning id into v_id;
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,after_data)
  values(p_actor_user_id,'purchase_payment_document.uploaded','purchase_payment_document',v_id::text,jsonb_build_object('payment_request_id',p_payment_request_id,'file_name',left(p_file_name,255),'file_size',p_file_size));
  return v_id;
end; $$;

create or replace function public.pay_purchase_payment_with_audit(p_payment_request_id uuid,p_actor_user_id uuid)
returns void language plpgsql set search_path='public','pg_temp' as $$
declare v_payment public.purchase_payment_requests%rowtype; v_receipt public.purchase_receipts%rowtype; v_request public.purchase_requests%rowtype; v_balance numeric;
begin
  select * into v_payment from public.purchase_payment_requests where id=p_payment_request_id for update;
  if not found or v_payment.status<>'Menunggu Pembayaran' then raise exception 'Payment request is not awaiting payment'; end if;
  if not exists(select 1 from public.purchase_payment_documents where payment_request_id=p_payment_request_id) then raise exception 'Transfer evidence required'; end if;
  select * into v_receipt from public.purchase_receipts where id=v_payment.receipt_id;
  select * into v_request from public.purchase_requests where id=v_receipt.purchase_request_id;
  perform 1 from public.projects where id=v_request.project_id and is_active for update;
  if not found then raise exception 'Project unavailable'; end if;
  select coalesce(sum(amount),0) into v_balance from public.project_cash_ledger where project_id=v_request.project_id;
  if v_balance<v_payment.amount then raise exception 'Insufficient project cash balance'; end if;
  update public.purchase_payment_requests set status='Lunas',paid_amount=amount,paid_at=now(),paid_by=p_actor_user_id,payment_method='Transfer' where id=p_payment_request_id;
  insert into public.project_cash_ledger(project_id,purchase_payment_request_id,entry_type,amount,description,created_by)
  values(v_request.project_id,p_payment_request_id,'debit',-v_payment.amount,'Pembayaran Pembelian '||v_request.code||' / '||v_receipt.code,p_actor_user_id);
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,after_data)
  values(p_actor_user_id,'purchase_payment.paid','purchase_payment_request',p_payment_request_id::text,jsonb_build_object('amount',v_payment.amount,'project_id',v_request.project_id,'purchase_request_id',v_request.id,'receipt_id',v_receipt.id,'paid_at',now(),'project_balance_before',v_balance,'project_balance_after',v_balance-v_payment.amount));
end; $$;

revoke all on function public.create_purchase_request_with_audit(uuid,date,uuid,uuid,uuid,uuid,numeric,numeric,text) from public,anon,authenticated;
revoke all on function public.create_purchase_receipt_draft_with_audit(uuid,uuid,date,numeric,text,numeric,text,text) from public,anon,authenticated;
revoke all on function public.register_purchase_receipt_document_with_audit(uuid,uuid,text,text,text,text,bigint) from public,anon,authenticated;
revoke all on function public.complete_purchase_receipt_with_audit(uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.register_purchase_payment_document_with_audit(uuid,uuid,text,text,text,bigint) from public,anon,authenticated;
revoke all on function public.pay_purchase_payment_with_audit(uuid,uuid) from public,anon,authenticated;
grant execute on function public.create_purchase_request_with_audit(uuid,date,uuid,uuid,uuid,uuid,numeric,numeric,text) to service_role;
grant execute on function public.create_purchase_receipt_draft_with_audit(uuid,uuid,date,numeric,text,numeric,text,text) to service_role;
grant execute on function public.register_purchase_receipt_document_with_audit(uuid,uuid,text,text,text,text,bigint) to service_role;
grant execute on function public.complete_purchase_receipt_with_audit(uuid,uuid,text,text) to service_role;
grant execute on function public.register_purchase_payment_document_with_audit(uuid,uuid,text,text,text,bigint) to service_role;
grant execute on function public.pay_purchase_payment_with_audit(uuid,uuid) to service_role;
