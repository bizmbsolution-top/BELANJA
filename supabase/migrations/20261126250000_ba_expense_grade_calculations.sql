-- Extend BA expense rules with grade-based calculation and snapshot the formula inputs.
alter table public.sales_expense_masters drop constraint if exists sales_expense_master_basis_check;
alter table public.sales_expense_masters drop constraint if exists sales_expense_masters_calculation_basis_check;
alter table public.sales_expense_masters drop constraint if exists sales_expense_masters_calculation_method_check;

alter table public.sales_expense_masters
  add constraint sales_expense_masters_calculation_method_check
  check (calculation_method in ('percentage','per_kg','per_grade_point','per_kg_grade','per_transaction','fixed')),
  add constraint sales_expense_masters_calculation_basis_check
  check (calculation_basis in ('final_amount','purchase_cost','received_weight_kg','final_grade_value','received_weight_x_grade','per_transaction','fixed')),
  add constraint sales_expense_master_basis_check check (
    (calculation_method = 'percentage' and calculation_basis in ('final_amount','purchase_cost'))
    or (calculation_method = 'per_kg' and calculation_basis = 'received_weight_kg')
    or (calculation_method = 'per_grade_point' and calculation_basis = 'final_grade_value')
    or (calculation_method = 'per_kg_grade' and calculation_basis = 'received_weight_x_grade')
    or (calculation_method = 'per_transaction' and calculation_basis = 'per_transaction')
    or (calculation_method = 'fixed' and calculation_basis = 'fixed')
  );

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
  p_is_active boolean,
  p_tenant_id uuid
) returns uuid
language plpgsql
set search_path = public, pg_temp
as $function$
declare
  v_row public.sales_expense_masters%rowtype;
begin
  if p_tenant_id is null or p_actor_user_id is null then raise exception 'Tenant dan pengguna wajib tersedia'; end if;
  if length(btrim(coalesce(p_name,''))) not between 2 and 120 then raise exception 'Nama biaya wajib 2-120 karakter'; end if;
  if p_expense_type not in ('company_payable','transaction_deduction') then raise exception 'Jenis biaya tidak valid'; end if;
  if p_calculation_method not in ('percentage','per_kg','per_grade_point','per_kg_grade','per_transaction','fixed') or p_rate is null or p_rate <= 0 then raise exception 'Metode atau tarif tidak valid'; end if;
  if (p_calculation_method='percentage' and p_calculation_basis not in ('final_amount','purchase_cost'))
    or (p_calculation_method='per_kg' and p_calculation_basis <> 'received_weight_kg')
    or (p_calculation_method='per_grade_point' and p_calculation_basis <> 'final_grade_value')
    or (p_calculation_method='per_kg_grade' and p_calculation_basis <> 'received_weight_x_grade')
    or (p_calculation_method='per_transaction' and p_calculation_basis <> 'per_transaction')
    or (p_calculation_method='fixed' and p_calculation_basis <> 'fixed') then raise exception 'Dasar perhitungan tidak sesuai metode'; end if;
  if not exists(select 1 from public.tenant_memberships m join public.tenants t on t.id=m.tenant_id where m.user_id=p_actor_user_id and m.tenant_id=p_tenant_id and m.is_active=true and t.status='active') then raise exception 'Actor bukan anggota tenant aktif'; end if;
  if p_expense_type='company_payable' and not exists(select 1 from public.expense_categories where id=p_expense_category_id and tenant_id=p_tenant_id and is_active) then raise exception 'Kategori Expenses wajib aktif'; end if;

  if p_master_id is null then
    insert into public.sales_expense_masters(name,expense_category_id,expense_type,calculation_method,calculation_basis,rate,recipient_name,description,is_active,tenant_id,created_by,updated_by)
    values(btrim(p_name),case when p_expense_type='company_payable' then p_expense_category_id else null end,p_expense_type,p_calculation_method,p_calculation_basis,p_rate,nullif(btrim(coalesce(p_recipient_name,'')),''),nullif(btrim(coalesce(p_description,'')),''),coalesce(p_is_active,true),p_tenant_id,p_actor_user_id,p_actor_user_id)
    returning * into v_row;
    insert into public.audit_logs(tenant_id,actor_user_id,action,entity_type,entity_id,after_data)
    values(p_tenant_id,p_actor_user_id,'sales_expense_master.created','sales_expense_master',v_row.id::text,jsonb_build_object('code',v_row.code,'name',v_row.name,'expense_type',v_row.expense_type,'calculation_method',v_row.calculation_method,'calculation_basis',v_row.calculation_basis,'rate',v_row.rate,'is_active',v_row.is_active));
  else
    select * into v_row from public.sales_expense_masters where id=p_master_id and tenant_id=p_tenant_id for update;
    if not found then raise exception 'Master biaya tidak ditemukan'; end if;
    if exists(select 1 from public.sales_order_expense_items where sales_expense_master_id=p_master_id and tenant_id=p_tenant_id)
      and (v_row.expense_type<>p_expense_type or v_row.calculation_method<>p_calculation_method or v_row.calculation_basis<>p_calculation_basis) then
      raise exception 'Jenis dan metode tidak dapat diubah karena master sudah digunakan. Nonaktifkan dan buat master baru.';
    end if;
    update public.sales_expense_masters set name=btrim(p_name),expense_category_id=case when p_expense_type='company_payable' then p_expense_category_id else null end,expense_type=p_expense_type,calculation_method=p_calculation_method,calculation_basis=p_calculation_basis,rate=p_rate,recipient_name=nullif(btrim(coalesce(p_recipient_name,'')),''),description=nullif(btrim(coalesce(p_description,'')),''),is_active=p_is_active,updated_at=now(),updated_by=p_actor_user_id where id=p_master_id and tenant_id=p_tenant_id returning * into v_row;
    insert into public.audit_logs(tenant_id,actor_user_id,action,entity_type,entity_id,before_data,after_data)
    values(p_tenant_id,p_actor_user_id,'sales_expense_master.updated','sales_expense_master',v_row.id::text,jsonb_build_object('name',v_row.name,'rate',v_row.rate),jsonb_build_object('code',v_row.code,'name',v_row.name,'expense_type',v_row.expense_type,'calculation_method',v_row.calculation_method,'calculation_basis',v_row.calculation_basis,'rate',v_row.rate,'is_active',v_row.is_active));
  end if;
  return v_row.id;
end;
$function$;

create or replace function public.create_sales_expense_vouchers_from_ba(
  p_sales_order_id uuid,
  p_actor_user_id uuid
) returns jsonb
language plpgsql
set search_path = pg_catalog, public
as $function$
declare
  v_order public.sales_orders%rowtype;
  v_master public.sales_expense_masters%rowtype;
  v_base numeric;
  v_grade numeric;
  v_amount numeric;
  v_item_id uuid;
  v_expense_id uuid;
  v_count integer := 0;
  v_voucher_count integer := 0;
begin
  if p_sales_order_id is null or p_actor_user_id is null then raise exception 'Required values are missing.'; end if;
  select * into v_order from public.sales_orders where id=p_sales_order_id for update;
  if not found then raise exception 'BA penjualan tidak ditemukan.'; end if;
  if not exists(select 1 from public.tenant_memberships m join public.tenants t on t.id=m.tenant_id where m.user_id=p_actor_user_id and m.tenant_id=v_order.tenant_id and m.is_active=true and t.status='active') then
    raise exception 'Actor is not an active member of the BA tenant.';
  end if;
  if v_order.status <> 'Selesai' or v_order.final_amount is null or v_order.received_weight_kg is null or v_order.final_grade_value is null then
    raise exception 'BA penjualan harus sudah difinalisasi lengkap dengan berat dan kadar.';
  end if;
  if exists(select 1 from public.sales_order_expense_items where tenant_id=v_order.tenant_id and sales_order_id=p_sales_order_id) then
    raise exception 'Biaya untuk BA ini sudah pernah dibuat. Tidak dapat membuat duplikat.';
  end if;
  if not exists(select 1 from public.sales_expense_masters where tenant_id=v_order.tenant_id and is_active=true) then
    raise exception 'Belum ada Master Biaya Penjualan yang aktif';
  end if;

  v_grade := v_order.final_grade_value;
  if lower(coalesce(v_order.final_grade_unit,'')) in ('fraction','ratio') and v_grade between 0 and 1 then v_grade := v_grade * 100; end if;

  for v_master in select * from public.sales_expense_masters where tenant_id=v_order.tenant_id and is_active=true order by code
  loop
    if v_master.calculation_basis='final_amount' then v_base:=v_order.final_amount;
    elsif v_master.calculation_basis='purchase_cost' then
      select coalesce(sum(allocated_purchase_cost),0) into v_base from public.sales_order_lot_allocations where tenant_id=v_order.tenant_id and sales_order_id=p_sales_order_id;
    elsif v_master.calculation_basis='received_weight_kg' then v_base:=v_order.received_weight_kg;
    elsif v_master.calculation_basis='final_grade_value' then v_base:=v_grade;
    elsif v_master.calculation_basis='received_weight_x_grade' then v_base:=v_order.received_weight_kg*v_grade/100;
    else v_base:=1;
    end if;

    if v_master.calculation_method='percentage' then v_amount:=round(v_base*v_master.rate/100,2);
    elsif v_master.calculation_method='per_kg' then v_amount:=round(v_master.rate*v_base,2);
    elsif v_master.calculation_method='per_grade_point' then v_amount:=round(v_master.rate*v_base,2);
    elsif v_master.calculation_method='per_kg_grade' then v_amount:=round(v_master.rate*v_base,2);
    else v_amount:=round(v_master.rate,2);
    end if;

    insert into public.sales_order_expense_items(tenant_id,sales_order_id,sales_expense_master_id,master_code_snapshot,master_name_snapshot,expense_type,calculation_method,calculation_basis,rate_snapshot,base_value,calculated_amount,final_amount,recipient_name_snapshot,expense_category_id,created_by,updated_by)
    values(v_order.tenant_id,p_sales_order_id,v_master.id,v_master.code,v_master.name,v_master.expense_type,v_master.calculation_method,v_master.calculation_basis,v_master.rate,v_base,v_amount,v_amount,v_master.recipient_name,v_master.expense_category_id,p_actor_user_id,p_actor_user_id)
    returning id into v_item_id;
    v_count:=v_count+1;

    if v_master.expense_type='company_payable' then
      insert into public.expenses(tenant_id,expense_date,project_id,expense_category_id,description,amount,payment_method,status,created_by,updated_by,submitted_at,submitted_by,sales_order_id,sales_order_expense_item_id)
      values(v_order.tenant_id,coalesce(v_order.ba_date,current_date),v_order.project_id,v_master.expense_category_id,
        'Biaya Penjualan '||v_master.name||' · '||v_order.code||' · BA '||v_order.ba_number,
        v_amount,'Transfer','Menunggu Pembayaran',p_actor_user_id,p_actor_user_id,now(),p_actor_user_id,p_sales_order_id,v_item_id)
      returning id into v_expense_id;
      v_voucher_count:=v_voucher_count+1;
      insert into public.audit_logs(tenant_id,actor_user_id,action,entity_type,entity_id,after_data)
      values(v_order.tenant_id,p_actor_user_id,'expense.sales_ba_submitted','expense',v_expense_id::text,
        jsonb_build_object('sales_order_id',p_sales_order_id,'sales_order_code',v_order.code,'ba_number',v_order.ba_number,'sales_order_expense_item_id',v_item_id,'amount',v_amount,'source','sales_ba','status','Menunggu Pembayaran'));
    end if;
  end loop;

  insert into public.audit_logs(tenant_id,actor_user_id,action,entity_type,entity_id,after_data)
  values(v_order.tenant_id,p_actor_user_id,'sales.expenses_generated','sales_order',p_sales_order_id::text,
    jsonb_build_object('sales_order_code',v_order.code,'ba_number',v_order.ba_number,'items',v_count,'expense_vouchers',v_voucher_count));
  return jsonb_build_object('items_created',v_count,'vouchers_created',v_voucher_count);
end;
$function$;

revoke execute on function public.save_sales_expense_master_with_audit(uuid,uuid,text,uuid,text,text,text,numeric,text,text,boolean,uuid) from public, anon, authenticated;
grant execute on function public.save_sales_expense_master_with_audit(uuid,uuid,text,uuid,text,text,text,numeric,text,text,boolean,uuid) to service_role;
revoke execute on function public.create_sales_expense_vouchers_from_ba(uuid,uuid) from public, anon, authenticated;
grant execute on function public.create_sales_expense_vouchers_from_ba(uuid,uuid) to service_role;
