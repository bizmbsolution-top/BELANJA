-- Expense category formula configuration and immutable AP calculation snapshots.
-- Approved formula configuration migration for the active BELANJA database.

alter table public.expense_categories
  add column if not exists expense_type text not null default 'company_payable',
  add column if not exists calculation_method text not null default 'manual',
  add column if not exists calculation_basis text not null default 'manual',
  add column if not exists calculation_rate numeric(18,6);

alter table public.expense_categories
  drop constraint if exists expense_categories_expense_type_check,
  add constraint expense_categories_expense_type_check
    check (expense_type in ('company_payable','transaction_deduction')),
  drop constraint if exists expense_categories_calculation_method_check,
  add constraint expense_categories_calculation_method_check
    check (calculation_method in ('manual','percentage','per_kg','per_grade_point','per_kg_grade','per_transaction','fixed')),
  drop constraint if exists expense_categories_calculation_basis_check,
  add constraint expense_categories_calculation_basis_check
    check (calculation_basis in ('manual','final_amount','purchase_cost','received_weight_kg','final_grade_value','received_weight_x_grade','per_transaction','fixed')),
  drop constraint if exists expense_categories_formula_consistency_check,
  add constraint expense_categories_formula_consistency_check check (
    (calculation_method='manual' and calculation_basis='manual' and calculation_rate is null)
    or (calculation_method='percentage' and calculation_basis in ('final_amount','purchase_cost') and calculation_rate > 0)
    or (calculation_method='per_kg' and calculation_basis='received_weight_kg' and calculation_rate > 0)
    or (calculation_method='per_grade_point' and calculation_basis='final_grade_value' and calculation_rate > 0)
    or (calculation_method='per_kg_grade' and calculation_basis='received_weight_x_grade' and calculation_rate > 0)
    or (calculation_method='per_transaction' and calculation_basis='per_transaction' and calculation_rate > 0)
    or (calculation_method='fixed' and calculation_basis='fixed' and calculation_rate > 0)
  );

alter table public.expense_items
  add column if not exists formula_method text,
  add column if not exists formula_basis text,
  add column if not exists formula_rate numeric(18,6),
  add column if not exists formula_base_value numeric(18,6),
  add column if not exists formula_result numeric(18,2),
  add column if not exists formula_snapshot jsonb;

alter table public.expense_items
  drop constraint if exists expense_items_formula_method_check,
  add constraint expense_items_formula_method_check
    check (formula_method is null or formula_method in ('manual','percentage','per_kg','per_grade_point','per_kg_grade','per_transaction','fixed'));

create or replace function public.ap_capture_expense_item_formula()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_category public.expense_categories%rowtype;
  v_header public.expenses%rowtype;
  v_ba public.sales_orders%rowtype;
  v_base numeric(18,6);
  v_result numeric(18,2);
  v_missing text;
begin
  select * into v_category
  from public.expense_categories
  where id = new.expense_category_id and tenant_id = new.tenant_id and is_active = true;
  if not found then raise exception 'Expense category is unavailable in the active tenant'; end if;
  if v_category.expense_type = 'transaction_deduction' then
    raise exception 'Transaction deduction categories cannot be recorded as company AP'; 
  end if;

  select * into v_header
  from public.expenses
  where id = new.expense_id and tenant_id = new.tenant_id and ap_version = 2;
  if not found then raise exception 'AP document not found'; end if;

  if v_category.calculation_method = 'manual' then
    new.formula_method := 'manual';
    new.formula_basis := 'manual';
    new.formula_rate := null;
    new.formula_base_value := null;
    new.formula_result := null;
    new.formula_snapshot := jsonb_build_object('method','manual','amount_entered',new.amount);
    return new;
  end if;

  if v_header.sales_order_id is null then
    raise exception 'Kategori ini memerlukan referensi BA untuk menghitung formula';
  end if;
  select * into v_ba from public.sales_orders
  where id = v_header.sales_order_id and tenant_id = new.tenant_id
    and project_id = v_header.project_id;
  if not found then raise exception 'Referensi BA tidak tersedia untuk formula'; end if;

  case v_category.calculation_method
    when 'percentage' then
      if v_category.calculation_basis = 'final_amount' then v_base := v_ba.final_amount;
      elsif v_category.calculation_basis = 'purchase_cost' then v_base := v_ba.dispatched_purchase_cost;
      end if;
      if v_base is null then v_missing := 'Nilai dasar persentase belum tersedia pada BA'; end if;
      v_result := round(v_base * v_category.calculation_rate / 100, 0);
    when 'per_kg' then
      v_base := v_ba.received_weight_kg;
      if v_base is null then v_missing := 'Berat diterima belum tersedia pada BA'; end if;
      v_result := round(v_base * v_category.calculation_rate, 0);
    when 'per_grade_point' then
      v_base := v_ba.final_grade_value;
      if v_base is null then v_missing := 'Nilai grade final belum tersedia pada BA'; end if;
      v_result := round(v_base * v_category.calculation_rate, 0);
    when 'per_kg_grade' then
      if v_ba.received_weight_kg is null or v_ba.final_grade_value is null then
        v_missing := 'Berat diterima atau grade final belum tersedia pada BA';
      else
        v_base := v_ba.received_weight_kg * v_ba.final_grade_value / 100;
      end if;
      v_result := round(v_base * v_category.calculation_rate, 0);
    when 'per_transaction' then
      v_base := 1;
      v_result := round(v_category.calculation_rate, 0);
    when 'fixed' then
      v_base := 1;
      v_result := round(v_category.calculation_rate, 2);
    else
      raise exception 'Unsupported expense calculation method';
  end case;
  if v_missing is not null or v_result is null or v_result <= 0 then
    raise exception '%', coalesce(v_missing,'Formula menghasilkan nominal nol atau tidak valid');
  end if;

  new.formula_method := v_category.calculation_method;
  new.formula_basis := v_category.calculation_basis;
  new.formula_rate := v_category.calculation_rate;
  new.formula_base_value := v_base;
  new.formula_result := v_result;
  new.formula_snapshot := jsonb_build_object(
    'method',v_category.calculation_method,'basis',v_category.calculation_basis,
    'rate',v_category.calculation_rate,'base_value',v_base,'calculated_result',v_result,
    'ba_id',v_ba.id,'ba_code',v_ba.code,'ba_final_amount',v_ba.final_amount,
    'ba_purchase_cost',v_ba.dispatched_purchase_cost,'received_weight_kg',v_ba.received_weight_kg,
    'final_grade_value',v_ba.final_grade_value,'amount_entered',new.amount,
    'amount_overridden',(new.amount <> v_result)
  );
  return new;
end;
$$;

-- Trigger function is not a public API. SECURITY INVOKER keeps caller privileges.
revoke all on function public.ap_capture_expense_item_formula() from public;
revoke all on function public.ap_capture_expense_item_formula() from anon;
revoke all on function public.ap_capture_expense_item_formula() from authenticated;
grant execute on function public.ap_capture_expense_item_formula() to service_role;

drop trigger if exists trg_ap_capture_expense_item_formula on public.expense_items;
create trigger trg_ap_capture_expense_item_formula
before insert or update of expense_category_id, amount, expense_id, tenant_id
on public.expense_items
for each row execute function public.ap_capture_expense_item_formula();

comment on column public.expense_categories.expense_type is 'company_payable is eligible for AP; transaction_deduction is deducted from a transaction and is not an AP payable.';
comment on column public.expense_categories.calculation_method is 'Default formula method used for new AP lines.';
comment on column public.expense_items.formula_snapshot is 'Immutable-at-save calculation inputs, BA source values, result and any Finance amount override.';
