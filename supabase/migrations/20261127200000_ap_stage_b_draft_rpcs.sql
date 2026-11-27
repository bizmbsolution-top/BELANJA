-- AP Stage B: atomic Draft create/edit/submit RPCs.
-- Preview branch only. Apply only after Stage A is independently reviewed and approved.
begin;

create table if not exists public.ap_schema_versions (
  version text primary key,
  installed_at timestamptz not null default now()
);
alter table public.ap_schema_versions enable row level security;
revoke all on public.ap_schema_versions from public, anon, authenticated;
grant select, insert on public.ap_schema_versions to service_role;
insert into public.ap_schema_versions(version) values ('stage_b_draft_v1')
on conflict (version) do nothing;

-- Shared authorization gate. The caller is service_role, so identity and tenant
-- are revalidated from the trusted actor ID supplied by the server action.
create or replace function public._assert_ap_actor(
  p_actor_user_id uuid,
  p_tenant_id uuid,
  p_project_id uuid,
  p_permission text
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_tenant_role text;
  v_roles text[];
  v_profile_active boolean;
  v_tenant_status text;
  v_scope_mode text;
  v_resource_ids text[];
begin
  if p_actor_user_id is null or p_tenant_id is null or p_project_id is null then
    raise exception 'AP access context is incomplete';
  end if;
  if p_permission not in ('ap.create_edit', 'ap.submit') then
    raise exception 'AP permission is invalid';
  end if;

  select m.tenant_role, p.roles, p.is_active, t.status
    into v_tenant_role, v_roles, v_profile_active, v_tenant_status
  from public.tenant_memberships m
  join public.tenants t on t.id = m.tenant_id
  join public.tenant_user_access_profiles p
    on p.tenant_id = m.tenant_id and p.user_id = m.user_id
  where m.user_id = p_actor_user_id
    and m.tenant_id = p_tenant_id
    and m.is_active = true
  for share of m, t, p;

  if not found or v_profile_active is distinct from true or v_tenant_status <> 'active' then
    raise exception 'AP actor or tenant is inactive';
  end if;

  if not exists (
    select 1 from public.projects
    where id = p_project_id and tenant_id = p_tenant_id and is_active = true
  ) then
    raise exception 'Project is unavailable in the active tenant';
  end if;

  if v_tenant_role = 'superadmin' then
    return;
  end if;

  if not ('Finance' = any(coalesce(v_roles, '{}'::text[]))) then
    raise exception 'Finance role is required for AP';
  end if;

  if not exists (
    select 1 from public.tenant_user_permission_overrides
    where tenant_id = p_tenant_id
      and user_id = p_actor_user_id
      and permission_key = p_permission
      and effect = 'allow'
  ) then
    raise exception 'Explicit AP permission is required';
  end if;

  select scope_mode, resource_ids
    into v_scope_mode, v_resource_ids
  from public.tenant_user_work_scopes
  where tenant_id = p_tenant_id
    and user_id = p_actor_user_id
    and dimension = 'project';

  if not found or v_scope_mode = 'none' then
    raise exception 'Project work scope does not permit AP access';
  end if;
  if v_scope_mode = 'selected'
     and not (p_project_id::text = any(coalesce(v_resource_ids, '{}'::text[]))) then
    raise exception 'Project is outside the actor work scope';
  end if;
  if v_scope_mode not in ('all', 'selected') then
    raise exception 'Project work scope is invalid';
  end if;
end;
$function$;

create or replace function public.ap_create_draft_with_audit(
  p_actor_user_id uuid,
  p_tenant_id uuid,
  p_expense_date date,
  p_recipient_supplier_id uuid,
  p_project_id uuid,
  p_sales_order_id uuid,
  p_summary text,
  p_lines jsonb
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_supplier_name text;
  v_total numeric(18,2) := 0;
  v_category_id uuid;
  v_first_description text;
  v_line jsonb;
  v_line_category uuid;
  v_line_description text;
  v_line_amount numeric(18,2);
  v_line_number integer := 0;
  v_expense public.expenses%rowtype;
  v_project_name text;
  v_ba_code text;
begin
  perform public._assert_ap_actor(p_actor_user_id, p_tenant_id, p_project_id, 'ap.create_edit');

  if p_expense_date is null then raise exception 'AP date is required'; end if;
  if p_summary is not null and length(btrim(p_summary)) > 1000 then
    raise exception 'AP summary is too long';
  end if;

  select name into v_supplier_name
  from public.suppliers
  where id = p_recipient_supplier_id
    and tenant_id = p_tenant_id
    and is_active = true;
  if not found then raise exception 'Supplier is unavailable in the active tenant'; end if;

  select name into v_project_name
  from public.projects
  where id = p_project_id and tenant_id = p_tenant_id and is_active = true;

  if p_sales_order_id is not null then
    select code into v_ba_code
    from public.sales_orders
    where id = p_sales_order_id
      and tenant_id = p_tenant_id
      and project_id = p_project_id;
    if not found then raise exception 'BA/Invoice is unavailable for the selected Project'; end if;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'line_number', line_number, 'expense_category_id', expense_category_id,
    'description', description, 'amount', amount
  ) order by line_number), '[]'::jsonb)
  into v_before_lines
  from public.expense_items
  where tenant_id = p_tenant_id and expense_id = p_expense_id;

  if p_lines is null or jsonb_typeof(p_lines) is distinct from 'array' then
    raise exception 'AP expense lines must be an array';
  end if;
  if jsonb_array_length(p_lines) < 1 or jsonb_array_length(p_lines) > 50 then
    raise exception 'AP must contain between 1 and 50 expense lines';
  end if;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_line_number := v_line_number + 1;
    begin
      v_line_category := (v_line->>'expense_category_id')::uuid;
      v_line_amount := (v_line->>'amount')::numeric;
    exception when others then
      raise exception 'AP line % has invalid category or amount', v_line_number;
    end;
    v_line_description := btrim(coalesce(v_line->>'description', ''));
    if length(v_line_description) = 0 or length(v_line_description) > 500 then
      raise exception 'AP line % description is required and limited to 500 characters', v_line_number;
    end if;
    if v_line_amount is null or v_line_amount <= 0
       or v_line_amount <> trunc(v_line_amount) then
      raise exception 'AP line % amount must be a positive whole Rupiah amount', v_line_number;
    end if;
    if not exists (
      select 1 from public.expense_categories
      where id = v_line_category and tenant_id = p_tenant_id and is_active = true
    ) then
      raise exception 'AP line % category is unavailable', v_line_number;
    end if;
    if v_line_number = 1 then
      v_category_id := v_line_category;
      v_first_description := v_line_description;
    end if;
    v_total := v_total + v_line_amount;
    if v_total > 9999999999999999.99 then raise exception 'AP total exceeds supported amount'; end if;
  end loop;

  insert into public.expenses(
    tenant_id, expense_date, project_id, expense_category_id, description,
    amount, payment_method, status, created_by, updated_by,
    recipient_name, recipient_supplier_id, ap_version, sales_order_id
  ) values (
    p_tenant_id, p_expense_date, p_project_id, v_category_id,
    coalesce(nullif(btrim(p_summary), ''), v_first_description),
    v_total, 'Transfer', 'Draft', p_actor_user_id, p_actor_user_id,
    v_supplier_name, p_recipient_supplier_id, 2, p_sales_order_id
  ) returning * into v_expense;

  v_line_number := 0;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_line_number := v_line_number + 1;
    insert into public.expense_items(
      tenant_id, expense_id, line_number, expense_category_id,
      description, amount, created_by, updated_by
    ) values (
      p_tenant_id, v_expense.id, v_line_number,
      (v_line->>'expense_category_id')::uuid,
      btrim(v_line->>'description'),
      (v_line->>'amount')::numeric,
      p_actor_user_id, p_actor_user_id
    );
  end loop;

  insert into public.audit_logs(
    tenant_id, actor_user_id, action, entity_type, entity_id, after_data
  ) values (
    p_tenant_id, p_actor_user_id, 'expense.created', 'expense', v_expense.id::text,
    jsonb_build_object(
      'ap_version', 2, 'code', v_expense.code, 'status', 'Draft',
      'expense_date', p_expense_date, 'recipient_supplier_id', p_recipient_supplier_id,
      'recipient_name', v_supplier_name, 'project_id', p_project_id,
      'project_name', v_project_name, 'sales_order_id', p_sales_order_id,
      'sales_order_code', v_ba_code, 'amount', v_total, 'lines', p_lines
    )
  );
  return v_expense.id;
end;
$function$;

create or replace function public.ap_update_draft_with_audit(
  p_expense_id uuid,
  p_actor_user_id uuid,
  p_tenant_id uuid,
  p_expense_date date,
  p_recipient_supplier_id uuid,
  p_project_id uuid,
  p_sales_order_id uuid,
  p_summary text,
  p_lines jsonb
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_before public.expenses%rowtype;
  v_before_lines jsonb;
  v_supplier_name text;
  v_total numeric(18,2) := 0;
  v_category_id uuid;
  v_first_description text;
  v_line jsonb;
  v_line_category uuid;
  v_line_description text;
  v_line_amount numeric(18,2);
  v_line_number integer := 0;
  v_project_name text;
  v_ba_code text;
begin
  select * into v_before
  from public.expenses
  where id = p_expense_id and tenant_id = p_tenant_id and ap_version = 2
  for update;
  if not found or v_before.status <> 'Draft' then
    raise exception 'Only an AP Draft in the active tenant can be edited';
  end if;

  perform public._assert_ap_actor(p_actor_user_id, p_tenant_id, p_project_id, 'ap.create_edit');

  if p_expense_date is null then raise exception 'AP date is required'; end if;
  if p_summary is not null and length(btrim(p_summary)) > 1000 then
    raise exception 'AP summary is too long';
  end if;

  select name into v_supplier_name
  from public.suppliers
  where id = p_recipient_supplier_id
    and tenant_id = p_tenant_id
    and is_active = true;
  if not found then raise exception 'Supplier is unavailable in the active tenant'; end if;

  select name into v_project_name
  from public.projects
  where id = p_project_id and tenant_id = p_tenant_id and is_active = true;

  if p_sales_order_id is not null then
    select code into v_ba_code
    from public.sales_orders
    where id = p_sales_order_id
      and tenant_id = p_tenant_id
      and project_id = p_project_id;
    if not found then raise exception 'BA/Invoice is unavailable for the selected Project'; end if;
  end if;

  if jsonb_typeof(p_lines) <> 'array'
     or jsonb_array_length(p_lines) < 1
     or jsonb_array_length(p_lines) > 50 then
    raise exception 'AP must contain between 1 and 50 expense lines';
  end if;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_line_number := v_line_number + 1;
    begin
      v_line_category := (v_line->>'expense_category_id')::uuid;
      v_line_amount := (v_line->>'amount')::numeric;
    exception when others then
      raise exception 'AP line % has invalid category or amount', v_line_number;
    end;
    v_line_description := btrim(coalesce(v_line->>'description', ''));
    if length(v_line_description) = 0 or length(v_line_description) > 500 then
      raise exception 'AP line % description is required and limited to 500 characters', v_line_number;
    end if;
    if v_line_amount is null or v_line_amount <= 0
       or v_line_amount <> trunc(v_line_amount) then
      raise exception 'AP line % amount must be a positive whole Rupiah amount', v_line_number;
    end if;
    if not exists (
      select 1 from public.expense_categories
      where id = v_line_category and tenant_id = p_tenant_id and is_active = true
    ) then
      raise exception 'AP line % category is unavailable', v_line_number;
    end if;
    if v_line_number = 1 then
      v_category_id := v_line_category;
      v_first_description := v_line_description;
    end if;
    v_total := v_total + v_line_amount;
    if v_total > 9999999999999999.99 then raise exception 'AP total exceeds supported amount'; end if;
  end loop;

  delete from public.expense_items
  where tenant_id = p_tenant_id and expense_id = p_expense_id;

  v_line_number := 0;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_line_number := v_line_number + 1;
    insert into public.expense_items(
      tenant_id, expense_id, line_number, expense_category_id,
      description, amount, created_by, updated_by
    ) values (
      p_tenant_id, p_expense_id, v_line_number,
      (v_line->>'expense_category_id')::uuid,
      btrim(v_line->>'description'),
      (v_line->>'amount')::numeric,
      p_actor_user_id, p_actor_user_id
    );
  end loop;

  update public.expenses
  set expense_date = p_expense_date,
      project_id = p_project_id,
      expense_category_id = v_category_id,
      description = coalesce(nullif(btrim(p_summary), ''), v_first_description),
      amount = v_total,
      recipient_supplier_id = p_recipient_supplier_id,
      recipient_name = v_supplier_name,
      sales_order_id = p_sales_order_id,
      updated_at = now(),
      updated_by = p_actor_user_id
  where id = p_expense_id and tenant_id = p_tenant_id and ap_version = 2;

  insert into public.audit_logs(
    tenant_id, actor_user_id, action, entity_type, entity_id, before_data, after_data
  ) values (
    p_tenant_id, p_actor_user_id, 'expense.updated', 'expense', p_expense_id::text,
    jsonb_build_object(
      'code', v_before.code, 'status', v_before.status, 'expense_date', v_before.expense_date,
      'recipient_supplier_id', v_before.recipient_supplier_id, 'recipient_name', v_before.recipient_name,
      'project_id', v_before.project_id, 'sales_order_id', v_before.sales_order_id,
      'amount', v_before.amount, 'lines', v_before_lines
    ),
    jsonb_build_object(
      'code', v_before.code, 'status', 'Draft', 'expense_date', p_expense_date,
      'recipient_supplier_id', p_recipient_supplier_id, 'recipient_name', v_supplier_name,
      'project_id', p_project_id, 'project_name', v_project_name,
      'sales_order_id', p_sales_order_id, 'sales_order_code', v_ba_code,
      'amount', v_total, 'lines', p_lines
    )
  );
end;
$function$;

create or replace function public.ap_submit_with_audit(
  p_expense_id uuid,
  p_actor_user_id uuid,
  p_tenant_id uuid
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_row public.expenses%rowtype;
  v_total numeric(18,2);
  v_line_count integer;
  v_first_category uuid;
begin
  select * into v_row
  from public.expenses
  where id = p_expense_id and tenant_id = p_tenant_id and ap_version = 2
  for update;
  if not found or v_row.status <> 'Draft' then
    raise exception 'Only an AP Draft in the active tenant can be submitted';
  end if;

  perform public._assert_ap_actor(p_actor_user_id, p_tenant_id, v_row.project_id, 'ap.submit');

  if not exists (
    select 1 from public.suppliers
    where id = v_row.recipient_supplier_id
      and tenant_id = p_tenant_id and is_active = true
  ) then
    raise exception 'Supplier is unavailable';
  end if;

  select count(*), coalesce(sum(amount), 0)
    into v_line_count, v_total
  from public.expense_items
  where tenant_id = p_tenant_id and expense_id = p_expense_id;

  if v_line_count < 1 or v_line_count > 50 or v_total <= 0 then
    raise exception 'AP must contain valid expense lines before submission';
  end if;

  select expense_category_id into v_first_category
  from public.expense_items
  where tenant_id = p_tenant_id and expense_id = p_expense_id
  order by line_number
  limit 1;

  if exists (
    select 1
    from public.expense_items i
    left join public.expense_categories c
      on c.id = i.expense_category_id and c.tenant_id = p_tenant_id
    where i.tenant_id = p_tenant_id and i.expense_id = p_expense_id
      and (c.id is null or c.is_active = false or i.amount <= 0
           or length(btrim(i.description)) = 0)
  ) then
    raise exception 'AP contains an invalid or inactive expense line';
  end if;

  update public.expenses
  set amount = v_total,
      expense_category_id = v_first_category,
      status = 'Menunggu Pembayaran',
      submitted_at = now(),
      submitted_by = p_actor_user_id,
      updated_at = now(),
      updated_by = p_actor_user_id
  where id = p_expense_id and tenant_id = p_tenant_id and ap_version = 2;

  insert into public.audit_logs(
    tenant_id, actor_user_id, action, entity_type, entity_id, before_data, after_data
  ) values (
    p_tenant_id, p_actor_user_id, 'expense.submitted', 'expense', p_expense_id::text,
    jsonb_build_object('code', v_row.code, 'status', 'Draft', 'amount', v_row.amount),
    jsonb_build_object('code', v_row.code, 'status', 'Menunggu Pembayaran',
      'amount', v_total, 'submitted_at', now(), 'submitted_by', p_actor_user_id)
  );
end;
$function$;

revoke all on function public._assert_ap_actor(uuid,uuid,uuid,text) from public, anon, authenticated, service_role;
revoke all on function public.ap_create_draft_with_audit(uuid,uuid,date,uuid,uuid,uuid,text,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.ap_update_draft_with_audit(uuid,uuid,uuid,date,uuid,uuid,uuid,text,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.ap_submit_with_audit(uuid,uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function public.ap_create_draft_with_audit(uuid,uuid,date,uuid,uuid,uuid,text,jsonb) to service_role;
grant execute on function public.ap_update_draft_with_audit(uuid,uuid,uuid,date,uuid,uuid,uuid,text,jsonb) to service_role;
grant execute on function public.ap_submit_with_audit(uuid,uuid,uuid) to service_role;

commit;
