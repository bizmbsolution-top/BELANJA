-- Sales expense master, BA-based calculation snapshots, and XPN voucher linkage.
create sequence if not exists public.sales_expense_master_code_seq;

create table if not exists public.sales_expense_masters (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('SEM-' || lpad(nextval('public.sales_expense_master_code_seq')::text, 6, '0')),
  name text not null check (length(btrim(name)) between 2 and 120),
  expense_category_id uuid references public.expense_categories(id) on delete restrict,
  expense_type text not null check (expense_type in ('company_payable','transaction_deduction')),
  calculation_method text not null check (calculation_method in ('percentage','per_kg','per_transaction','fixed')),
  calculation_basis text not null check (calculation_basis in ('final_amount','purchase_cost','received_weight_kg','per_transaction','fixed')),
  rate numeric(18,4) not null check (rate > 0),
  recipient_name text,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint sales_expense_master_category_check check (
    (expense_type = 'company_payable' and expense_category_id is not null)
    or (expense_type = 'transaction_deduction')
  ),
  constraint sales_expense_master_basis_check check (
    (calculation_method = 'percentage' and calculation_basis in ('final_amount','purchase_cost'))
    or (calculation_method = 'per_kg' and calculation_basis = 'received_weight_kg')
    or (calculation_method = 'per_transaction' and calculation_basis = 'per_transaction')
    or (calculation_method = 'fixed' and calculation_basis = 'fixed')
  )
);

create table if not exists public.sales_order_expense_items (
  id uuid primary key default gen_random_uuid(),
  sales_order_id uuid not null references public.sales_orders(id) on delete restrict,
  sales_expense_master_id uuid not null references public.sales_expense_masters(id) on delete restrict,
  master_code_snapshot text not null,
  master_name_snapshot text not null,
  expense_type text not null check (expense_type in ('company_payable','transaction_deduction')),
  calculation_method text not null,
  calculation_basis text not null,
  rate_snapshot numeric(18,4) not null,
  base_value numeric(18,4) not null,
  calculated_amount numeric(18,2) not null check (calculated_amount >= 0),
  final_amount numeric(18,2) not null check (final_amount >= 0),
  recipient_name_snapshot text,
  expense_category_id uuid references public.expense_categories(id) on delete restrict,
  status text not null default 'Ditetapkan' check (status in ('Ditetapkan','Dibatalkan')),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  unique (sales_order_id, sales_expense_master_id)
);

alter table public.expenses
  add column if not exists sales_order_id uuid references public.sales_orders(id) on delete restrict,
  add column if not exists sales_order_expense_item_id uuid references public.sales_order_expense_items(id) on delete restrict;

create unique index if not exists expenses_sales_order_expense_item_uidx
  on public.expenses(sales_order_expense_item_id)
  where sales_order_expense_item_id is not null;
create index if not exists sales_order_expense_items_sales_order_idx
  on public.sales_order_expense_items(sales_order_id, created_at desc);
create index if not exists sales_expense_masters_active_idx
  on public.sales_expense_masters(is_active, name);

alter table public.sales_expense_masters enable row level security;
alter table public.sales_order_expense_items enable row level security;

revoke all on public.sales_expense_masters from anon, authenticated;
revoke all on public.sales_order_expense_items from anon, authenticated;
grant all on public.sales_expense_masters to service_role;
grant all on public.sales_order_expense_items to service_role;
grant usage, select on sequence public.sales_expense_master_code_seq to service_role;

create or replace function public.save_sales_expense_master_with_audit(
  p_master_id uuid,
  p_actor_user_id uuid,
  p_name text,
  p_expense_category_id uuid,
  p_expense_type text,
  p_calculation_method text,
  p_calculation_basis text,
  p_rate numeric,
  p_recipient_name text,
  p_description text,
  p_is_active boolean
) returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare v_row public.sales_expense_masters%rowtype;
begin
  if length(btrim(coalesce(p_name,''))) not between 2 and 120 then raise exception 'Nama biaya wajib 2-120 karakter'; end if;
  if p_expense_type not in ('company_payable','transaction_deduction') then raise exception 'Jenis biaya tidak valid'; end if;
  if p_calculation_method not in ('percentage','per_kg','per_transaction','fixed') or p_rate is null or p_rate <= 0 then raise exception 'Metode atau tarif tidak valid'; end if;
  if (p_calculation_method='percentage' and p_calculation_basis not in ('final_amount','purchase_cost'))
    or (p_calculation_method='per_kg' and p_calculation_basis <> 'received_weight_kg')
    or (p_calculation_method='per_transaction' and p_calculation_basis <> 'per_transaction')
    or (p_calculation_method='fixed' and p_calculation_basis <> 'fixed') then raise exception 'Dasar perhitungan tidak sesuai metode'; end if;
  if p_expense_type='company_payable' and not exists(select 1 from public.expense_categories where id=p_expense_category_id and is_active) then raise exception 'Kategori Expenses wajib aktif'; end if;
  if p_master_id is null then
    insert into public.sales_expense_masters(name,expense_category_id,expense_type,calculation_method,calculation_basis,rate,recipient_name,description,is_active,created_by,updated_by)
    values(btrim(p_name),case when p_expense_type='company_payable' then p_expense_category_id else null end,p_expense_type,p_calculation_method,p_calculation_basis,p_rate,nullif(btrim(coalesce(p_recipient_name,'')),''),nullif(btrim(coalesce(p_description,'')),''),coalesce(p_is_active,true),p_actor_user_id,p_actor_user_id)
    returning * into v_row;
    insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,after_data)
    values(p_actor_user_id,'sales_expense_master.created','sales_expense_master',v_row.id::text,jsonb_build_object('code',v_row.code,'name',v_row.name,'expense_type',v_row.expense_type,'calculation_method',v_row.calculation_method,'calculation_basis',v_row.calculation_basis,'rate',v_row.rate,'is_active',v_row.is_active));
  else
    select * into v_row from public.sales_expense_masters where id=p_master_id for update;
    if not found then raise exception 'Master biaya tidak ditemukan'; end if;
    if exists(select 1 from public.sales_order_expense_items where sales_expense_master_id=p_master_id) and
      (v_row.expense_type<>p_expense_type or v_row.calculation_method<>p_calculation_method or v_row.calculation_basis<>p_calculation_basis) then
      raise exception 'Jenis dan metode tidak dapat diubah karena master sudah digunakan. Nonaktifkan dan buat master baru.';
    end if;
    update public.sales_expense_masters set name=btrim(p_name),expense_category_id=case when p_expense_type='company_payable' then p_expense_category_id else null end,expense_type=p_expense_type,calculation_method=p_calculation_method,calculation_basis=p_calculation_basis,rate=p_rate,recipient_name=nullif(btrim(coalesce(p_recipient_name,'')),''),description=nullif(btrim(coalesce(p_description,'')),''),is_active=p_is_active,updated_at=now(),updated_by=p_actor_user_id where id=p_master_id returning * into v_row;
    insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,before_data,after_data)
    values(p_actor_user_id,'sales_expense_master.updated','sales_expense_master',v_row.id::text,jsonb_build_object('name',v_row.name,'rate',v_row.rate),jsonb_build_object('code',v_row.code,'name',v_row.name,'expense_type',v_row.expense_type,'calculation_method',v_row.calculation_method,'calculation_basis',v_row.calculation_basis,'rate',v_row.rate,'is_active',v_row.is_active));
  end if;
  return v_row.id;
end;
$$;

create or replace function public.create_sales_expense_vouchers_from_ba(
  p_sales_order_id uuid,
  p_actor_user_id uuid
) returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_order public.sales_orders%rowtype;
  v_master public.sales_expense_masters%rowtype;
  v_base numeric;
  v_amount numeric;
  v_item_id uuid;
  v_expense_id uuid;
  v_count integer := 0;
  v_voucher_count integer := 0;
begin
  select * into v_order from public.sales_orders where id=p_sales_order_id for update;
  if not found or v_order.status <> 'Selesai' or v_order.final_amount is null or v_order.received_weight_kg is null then
    raise exception 'BA penjualan harus sudah difinalisasi';
  end if;
  if exists(select 1 from public.sales_order_expense_items where sales_order_id=p_sales_order_id) then
    raise exception 'Biaya untuk BA ini sudah pernah dibuat. Tidak dapat membuat duplikat.';
  end if;
  for v_master in select * from public.sales_expense_masters where is_active order by code
  loop
    if v_master.calculation_basis='final_amount' then v_base:=v_order.final_amount;
    elsif v_master.calculation_basis='purchase_cost' then
      select coalesce(sum(allocated_purchase_cost),0) into v_base from public.sales_order_lot_allocations where sales_order_id=p_sales_order_id;
    elsif v_master.calculation_basis='received_weight_kg' then v_base:=v_order.received_weight_kg;
    else v_base:=1;
    end if;
    if v_master.calculation_method='percentage' then v_amount:=round(v_base*v_master.rate/100,2);
    elsif v_master.calculation_method='per_kg' then v_amount:=round(v_master.rate*v_base,2);
    else v_amount:=round(v_master.rate,2);
    end if;
    insert into public.sales_order_expense_items(sales_order_id,sales_expense_master_id,master_code_snapshot,master_name_snapshot,expense_type,calculation_method,calculation_basis,rate_snapshot,base_value,calculated_amount,final_amount,recipient_name_snapshot,expense_category_id,created_by,updated_by)
    values(p_sales_order_id,v_master.id,v_master.code,v_master.name,v_master.expense_type,v_master.calculation_method,v_master.calculation_basis,v_master.rate,v_base,v_amount,v_amount,v_master.recipient_name,v_master.expense_category_id,p_actor_user_id,p_actor_user_id)
    returning id into v_item_id;
    v_count:=v_count+1;
    if v_master.expense_type='company_payable' then
      insert into public.expenses(expense_date,project_id,expense_category_id,description,amount,payment_method,status,created_by,updated_by,sales_order_id,sales_order_expense_item_id)
      values(coalesce(v_order.ba_date,current_date),v_order.project_id,v_master.expense_category_id,
        'Biaya Penjualan '||v_master.name||' · '||v_order.code||' · BA '||v_order.ba_number,
        v_amount,'Transfer','Draft',p_actor_user_id,p_actor_user_id,p_sales_order_id,v_item_id)
      returning id into v_expense_id;
      v_voucher_count:=v_voucher_count+1;
      insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,after_data)
      values(p_actor_user_id,'expense.sales_ba_draft_created','expense',v_expense_id::text,
        jsonb_build_object('sales_order_id',p_sales_order_id,'sales_order_code',v_order.code,'ba_number',v_order.ba_number,'sales_expense_item_id',v_item_id,'amount',v_amount,'source','sales_ba'));
    end if;
  end loop;
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,after_data)
  values(p_actor_user_id,'sales.expenses_generated','sales_order',p_sales_order_id::text,
    jsonb_build_object('sales_order_code',v_order.code,'ba_number',v_order.ba_number,'items',v_count,'expense_vouchers',v_voucher_count));
  return jsonb_build_object('items_created',v_count,'vouchers_created',v_voucher_count);
end;
$$;

revoke execute on function public.save_sales_expense_master_with_audit(uuid,uuid,text,uuid,text,text,text,numeric,text,text,boolean) from public, anon, authenticated;
revoke execute on function public.create_sales_expense_vouchers_from_ba(uuid,uuid) from public, anon, authenticated;
grant execute on function public.save_sales_expense_master_with_audit(uuid,uuid,text,uuid,text,text,text,numeric,text,text,boolean) to service_role;
grant execute on function public.create_sales_expense_vouchers_from_ba(uuid,uuid) to service_role;
