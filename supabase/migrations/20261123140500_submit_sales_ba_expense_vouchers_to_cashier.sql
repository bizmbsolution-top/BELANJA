create or replace function public.create_sales_expense_vouchers_from_ba(p_sales_order_id uuid,p_actor_user_id uuid)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare v_order public.sales_orders%rowtype; v_master public.sales_expense_masters%rowtype; v_base numeric; v_amount numeric; v_item_id uuid; v_expense_id uuid; v_count integer:=0; v_voucher_count integer:=0;
begin
  select * into v_order from public.sales_orders where id=p_sales_order_id for update;
  if not found or v_order.status<>'Selesai' or v_order.final_amount is null or v_order.received_weight_kg is null then raise exception 'BA penjualan harus sudah difinalisasi'; end if;
  if exists(select 1 from public.sales_order_expense_items where sales_order_id=p_sales_order_id) then raise exception 'Biaya untuk BA ini sudah pernah dibuat. Tidak dapat membuat duplikat.'; end if;
  if not exists(select 1 from public.sales_expense_masters where is_active) then raise exception 'Belum ada Master Biaya Penjualan yang aktif'; end if;
  for v_master in select * from public.sales_expense_masters where is_active order by code loop
    if v_master.calculation_basis='final_amount' then v_base:=v_order.final_amount;
    elsif v_master.calculation_basis='purchase_cost' then select coalesce(sum(allocated_purchase_cost),0) into v_base from public.sales_order_lot_allocations where sales_order_id=p_sales_order_id;
    elsif v_master.calculation_basis='received_weight_kg' then v_base:=v_order.received_weight_kg;
    else v_base:=1; end if;
    if v_master.calculation_method='percentage' then v_amount:=round(v_base*v_master.rate/100,2);
    elsif v_master.calculation_method='per_kg' then v_amount:=round(v_master.rate*v_base,2);
    else v_amount:=round(v_master.rate,2); end if;
    insert into public.sales_order_expense_items(sales_order_id,sales_expense_master_id,master_code_snapshot,master_name_snapshot,expense_type,calculation_method,calculation_basis,rate_snapshot,base_value,calculated_amount,final_amount,recipient_name_snapshot,expense_category_id,created_by,updated_by)
    values(p_sales_order_id,v_master.id,v_master.code,v_master.name,v_master.expense_type,v_master.calculation_method,v_master.calculation_basis,v_master.rate,v_base,v_amount,v_amount,v_master.recipient_name,v_master.expense_category_id,p_actor_user_id,p_actor_user_id) returning id into v_item_id;
    v_count:=v_count+1;
    if v_master.expense_type='company_payable' then
      insert into public.expenses(expense_date,project_id,expense_category_id,description,amount,payment_method,status,created_by,updated_by,submitted_at,submitted_by,sales_order_id,sales_order_expense_item_id)
      values(coalesce(v_order.ba_date,current_date),v_order.project_id,v_master.expense_category_id,'Biaya Penjualan '||v_master.name||' · '||v_order.code||' · BA '||v_order.ba_number,v_amount,'Transfer','Menunggu Pembayaran',p_actor_user_id,p_actor_user_id,now(),p_actor_user_id,p_sales_order_id,v_item_id)
      returning id into v_expense_id;
      v_voucher_count:=v_voucher_count+1;
      insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,after_data)
      values(p_actor_user_id,'expense.sales_ba_submitted','expense',v_expense_id::text,jsonb_build_object('sales_order_id',p_sales_order_id,'sales_order_code',v_order.code,'ba_number',v_order.ba_number,'sales_expense_item_id',v_item_id,'amount',v_amount,'source','sales_ba','status','Menunggu Pembayaran'));
    end if;
  end loop;
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,after_data)
  values(p_actor_user_id,'sales.expenses_generated','sales_order',p_sales_order_id::text,jsonb_build_object('sales_order_code',v_order.code,'ba_number',v_order.ba_number,'items',v_count,'expense_vouchers',v_voucher_count));
  return jsonb_build_object('items_created',v_count,'vouchers_created',v_voucher_count);
end; $$;