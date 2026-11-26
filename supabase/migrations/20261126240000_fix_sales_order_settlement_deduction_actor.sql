alter table public.sales_order_settlement_deductions
  add column if not exists created_by uuid references auth.users(id);

create or replace function public.record_sales_order_settlement(
  p_sales_order_id uuid,
  p_actor_user_id uuid,
  p_payment_method text,
  p_received_at timestamp with time zone,
  p_payment_reference text default null,
  p_notes text default null,
  p_deductions jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order public.sales_orders%rowtype;
  v_settlement_id uuid;
  v_deduction jsonb;
  v_component public.sales_invoice_deduction_components%rowtype;
  v_deduction_amount numeric(18,2);
  v_total_deductions numeric(18,2) := 0;
  v_gross numeric(18,2);
begin
  if p_sales_order_id is null or p_actor_user_id is null or p_received_at is null then
    raise exception 'Transaksi BA, Finance, dan tanggal penerimaan wajib diisi.';
  end if;
  if p_payment_method not in ('Transfer','Tunai') then
    raise exception 'Metode penerimaan tidak valid.';
  end if;
  if p_payment_reference is not null and length(p_payment_reference) > 120 then
    raise exception 'Referensi pembayaran maksimal 120 karakter.';
  end if;
  if p_notes is not null and length(p_notes) > 500 then
    raise exception 'Catatan maksimal 500 karakter.';
  end if;
  if p_deductions is null or jsonb_typeof(p_deductions) <> 'array' then
    raise exception 'Perincian potongan invoice tidak valid.';
  end if;

  select * into v_order
  from public.sales_orders
  where id = p_sales_order_id
  for update;

  if not found or v_order.status <> 'Selesai' or v_order.ba_number is null or v_order.ba_date is null or v_order.final_amount is null then
    raise exception 'Settlement hanya untuk penjualan selesai yang memiliki BA final.';
  end if;
  if exists (select 1 from public.sales_order_settlements where sales_order_id = p_sales_order_id) then
    raise exception 'BA ini sudah pernah dilunasi. Settlement kedua tidak diizinkan.';
  end if;

  v_gross := round(v_order.final_amount, 2);

  for v_deduction in select value from jsonb_array_elements(p_deductions)
  loop
    if nullif(v_deduction->>'component_id','') is null
       or nullif(v_deduction->>'amount','') is null then
      raise exception 'Komponen dan nominal setiap potongan wajib diisi.';
    end if;

    select * into v_component
    from public.sales_invoice_deduction_components
    where id = (v_deduction->>'component_id')::uuid
      and is_active = true
      and (customer_id is null or customer_id = v_order.customer_id);

    if not found then
      raise exception 'Komponen potongan tidak aktif atau tidak berlaku untuk pembeli ini.';
    end if;

    v_deduction_amount := round((v_deduction->>'amount')::numeric, 2);
    if v_deduction_amount < 0 then
      raise exception 'Nominal potongan tidak boleh negatif.';
    end if;

    v_total_deductions := v_total_deductions + v_deduction_amount;
  end loop;

  if v_total_deductions > v_gross then
    raise exception 'Total potongan tidak boleh melebihi nilai invoice.';
  end if;

  insert into public.sales_order_settlements
    (sales_order_id, amount, gross_amount, total_deductions, payment_method,
     payment_reference, notes, received_at, received_by)
  values
    (v_order.id, v_gross - v_total_deductions, v_gross, v_total_deductions, p_payment_method,
     nullif(trim(p_payment_reference), ''), nullif(trim(p_notes), ''), p_received_at, p_actor_user_id)
  returning id into v_settlement_id;

  for v_deduction in select value from jsonb_array_elements(p_deductions)
  loop
    select * into v_component
    from public.sales_invoice_deduction_components
    where id = (v_deduction->>'component_id')::uuid;

    v_deduction_amount := round((v_deduction->>'amount')::numeric, 2);
    insert into public.sales_order_settlement_deductions
      (settlement_id, component_id, component_code, component_name,
       calculation_method, rate_value, base_amount, deduction_amount, created_by)
    values
      (v_settlement_id, v_component.id, v_component.code, v_component.name,
       v_component.calculation_method, v_component.default_value, v_gross, v_deduction_amount, p_actor_user_id);
  end loop;

  insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, after_data)
  values (p_actor_user_id, 'sales.settlement_received', 'sales_order_settlement', v_settlement_id::text,
    jsonb_build_object('sales_order_id',v_order.id,'ba_number',v_order.ba_number,
      'gross_amount',v_gross,'total_deductions',v_total_deductions,
      'net_amount',v_gross-v_total_deductions,'payment_method',p_payment_method,
      'payment_reference',nullif(trim(p_payment_reference),''),'received_at',p_received_at,
      'deductions',p_deductions));

  return v_settlement_id;
end;
$function$;
