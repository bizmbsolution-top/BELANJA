alter table public.customers add column if not exists billing_address text;
update public.customers set billing_address = address where billing_address is null and address is not null;
create table if not exists public.customer_warehouse_addresses (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  label text not null,
  address text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id) on delete restrict,
  constraint customer_warehouse_addresses_label_check check (length(btrim(label)) between 2 and 100),
  constraint customer_warehouse_addresses_address_check check (length(btrim(address)) between 5 and 1000)
);
create index if not exists customer_warehouse_addresses_customer_idx on public.customer_warehouse_addresses(customer_id, is_active);
alter table public.customer_warehouse_addresses enable row level security;
revoke all on public.customer_warehouse_addresses from anon, authenticated;
grant all on public.customer_warehouse_addresses to service_role;
revoke all on public.customers from anon, authenticated;
grant all on public.customers to service_role;
create or replace function public.save_customer_with_addresses_with_audit(
  p_customer_id uuid, p_actor_user_id uuid, p_name text, p_phone text, p_email text,
  p_billing_address text, p_notes text, p_is_active boolean, p_warehouse_addresses jsonb
) returns uuid language plpgsql set search_path to 'public','pg_temp' as $function$
declare v_id uuid; v_before jsonb; v_item record; v_seen uuid[] := array[]::uuid[];
begin
  if length(btrim(coalesce(p_name,''))) not between 2 and 160 then raise exception 'Invalid customer name'; end if;
  if length(coalesce(p_phone,'')) > 40 or length(coalesce(p_email,'')) > 160 or length(coalesce(p_billing_address,'')) > 1000 or length(coalesce(p_notes,'')) > 1000 then raise exception 'Customer field is too long'; end if;
  if p_warehouse_addresses is null or jsonb_typeof(p_warehouse_addresses) <> 'array' or jsonb_array_length(p_warehouse_addresses)>30 then raise exception 'Invalid warehouse address list'; end if;
  if p_customer_id is null then
    insert into public.customers(name,phone,email,address,billing_address,notes,is_active,created_by,updated_by)
    values(btrim(p_name),nullif(btrim(coalesce(p_phone,'')),''),nullif(btrim(coalesce(p_email,'')),''),nullif(btrim(coalesce(p_billing_address,'')),''),nullif(btrim(coalesce(p_billing_address,'')),''),nullif(btrim(coalesce(p_notes,'')),''),coalesce(p_is_active,true),p_actor_user_id,p_actor_user_id)
    returning id into v_id;
  else
    select to_jsonb(c) into v_before from public.customers c where id=p_customer_id for update;
    if v_before is null then raise exception 'Customer not found'; end if;
    update public.customers set name=btrim(p_name),phone=nullif(btrim(coalesce(p_phone,'')),''),email=nullif(btrim(coalesce(p_email,'')),''),address=nullif(btrim(coalesce(p_billing_address,'')),''),billing_address=nullif(btrim(coalesce(p_billing_address,'')),''),notes=nullif(btrim(coalesce(p_notes,'')),''),is_active=coalesce(p_is_active,true),updated_at=now(),updated_by=p_actor_user_id where id=p_customer_id returning id into v_id;
  end if;
  for v_item in select x.id,x.label,x.address from jsonb_to_recordset(p_warehouse_addresses) as x(id uuid,label text,address text) loop
    if length(btrim(coalesce(v_item.label,''))) not between 2 and 100 or length(btrim(coalesce(v_item.address,''))) not between 5 and 1000 then raise exception 'Invalid warehouse address'; end if;
    if v_item.id is not null then
      if v_item.id=any(v_seen) then raise exception 'Duplicate warehouse address'; end if;
      update public.customer_warehouse_addresses set label=btrim(v_item.label),address=btrim(v_item.address),is_active=true,updated_at=now(),updated_by=p_actor_user_id where id=v_item.id and customer_id=v_id;
      if not found then raise exception 'Warehouse address does not belong to customer'; end if;
      v_seen:=array_append(v_seen,v_item.id);
    else
      insert into public.customer_warehouse_addresses(customer_id,label,address,created_by,updated_by) values(v_id,btrim(v_item.label),btrim(v_item.address),p_actor_user_id,p_actor_user_id) returning id into v_item.id;
      v_seen:=array_append(v_seen,v_item.id);
    end if;
  end loop;
  update public.customer_warehouse_addresses set is_active=false,updated_at=now(),updated_by=p_actor_user_id where customer_id=v_id and is_active and not (id=any(v_seen));
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,before_data,after_data)
  values(p_actor_user_id,case when p_customer_id is null then 'customer.created' else 'customer.updated' end,'customer',v_id::text,v_before,jsonb_build_object('name',btrim(p_name),'phone',nullif(btrim(coalesce(p_phone,'')),''),'email',nullif(btrim(coalesce(p_email,'')),''),'billing_address',nullif(btrim(coalesce(p_billing_address,'')),''),'warehouse_addresses',p_warehouse_addresses,'is_active',coalesce(p_is_active,true)));
  return v_id;
end; $function$;
revoke all on function public.save_customer_with_addresses_with_audit(uuid,uuid,text,text,text,text,text,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.save_customer_with_addresses_with_audit(uuid,uuid,text,text,text,text,text,boolean,jsonb) to service_role;
