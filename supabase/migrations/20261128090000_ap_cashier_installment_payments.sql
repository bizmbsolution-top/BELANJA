-- AP Stage C1: audited Cashier cash installments for AP v2.
-- Additive only. Legacy ap_version=1 voucher payment remains unchanged.
begin;

alter table public.audit_logs
  drop constraint if exists audit_logs_action_check,
  add constraint audit_logs_action_check check (
    action = any (array[
      'user.created','user.access_updated','user.email_update_requested','user.email_updated',
      'user.email_update_failed','user.password_reset_requested','user.password_reset',
      'user.password_reset_failed','supplier.created','supplier.updated','purchase_category.created',
      'purchase_category.updated','warehouse.created','warehouse.updated','warehouse.projects_updated',
      'expense_category.created','expense_category.updated','uom.created','uom.updated',
      'expense.created','expense.updated','expense.submitted','expense.paid','expense.cancelled',
      'expense_document.uploaded','expense_document.deleted','expense.payment_evidence_uploaded',
      'project.created','project.updated','fund_request.created','fund_request.executed',
      'fund_request.corrected','fund_request_document.uploaded','purchase_request.created',
      'purchase_receipt.created','purchase_receipt.updated','purchase_receipt.accepted',
      'purchase_receipt.rejected','purchase_receipt.cancelled','purchase_receipt.inspected',
      'purchase_payment.requested','purchase_payment.paid','purchase_payment.cancelled',
      'purchase_receipt_document.uploaded','purchase_payment_document.uploaded','lot.created',
      'lot.marked_problematic','lot.restored_normal','lot.cancelled','lot.returned','lot.quarantined',
      'customer.created','customer.updated','sales_draft.created','sales.dispatched','sales.finalized',
      'sales.ba_document_uploaded','sales_expense_master.created','sales_expense_master.updated',
      'sales.expenses_generated','expense.sales_ba_draft_created','expense.sales_ba_submitted',
      'sales_expense_period.closed','sales.settlement_received','sales.invoice_deduction_created',
      'sales.invoice_deduction_updated','purchase_return.draft_created','purchase_return.posted',
      'purchase_return.cancelled','purchase_return.credit_decision_set','purchase_receipt.credit_applied',
      'purchase_receipt.credit_reversed','expense.ap_payment_posted'
    ])
  );

alter table public.audit_logs
  drop constraint if exists audit_logs_entity_type_check,
  add constraint audit_logs_entity_type_check check (
    entity_type = any (array[
      'user_access','auth_user','supplier','purchase_category','warehouse','expense_category','uom',
      'expense','expense_document','expense_payment_document','project','fund_request',
      'fund_request_document','purchase_request','purchase_receipt','purchase_payment_request',
      'purchase_receipt_document','purchase_payment_document','inventory_lot','customer','sales_order',
      'sales_expense_master','sales_expense_closing','sales_order_settlement',
      'sales_invoice_deduction_component','purchase_return','expense_payment'
    ])
  );

create or replace function public.ap_post_cashier_payment_with_audit(
  p_expense_id uuid,
  p_actor_user_id uuid,
  p_tenant_id uuid,
  p_payment_date date,
  p_amount numeric,
  p_payment_reference text default null,
  p_notes text default null
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_expense public.expenses%rowtype;
  v_roles text[];
  v_tenant_role text;
  v_profile_active boolean;
  v_tenant_status text;
  v_scope_mode text;
  v_resource_ids text[];
  v_balance numeric;
  v_paid numeric;
  v_outstanding numeric;
  v_new_paid numeric;
  v_payment_id uuid;
  v_new_status text;
begin
  if p_expense_id is null or p_actor_user_id is null or p_tenant_id is null then
    raise exception 'Payment context is incomplete';
  end if;
  if p_payment_date is null or p_payment_date > current_date then
    raise exception 'Payment date is invalid';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount <> trunc(p_amount) then
    raise exception 'Payment amount must be a positive whole Rupiah amount';
  end if;
  if length(coalesce(p_payment_reference, '')) > 160
     or length(coalesce(p_notes, '')) > 500 then
    raise exception 'Payment reference or notes exceed the allowed length';
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
    raise exception 'Payment actor or tenant is inactive';
  end if;

  if v_tenant_role <> 'superadmin' then
    if not ('Cashier' = any(coalesce(v_roles, '{}'::text[]))) then
      raise exception 'Cashier role is required for cash AP payment';
    end if;
    if not exists (
      select 1 from public.tenant_user_permission_overrides
      where tenant_id = p_tenant_id and user_id = p_actor_user_id
        and permission_key = 'payment.post' and effect = 'allow'
    ) then
      raise exception 'Explicit payment.post permission is required';
    end if;
  end if;

  select * into v_expense
  from public.expenses
  where id = p_expense_id and tenant_id = p_tenant_id and ap_version = 2
  for update;

  if not found or v_expense.status not in ('Menunggu Pembayaran', 'Partial') then
    raise exception 'AP is not awaiting payment';
  end if;

  if not exists (
    select 1 from public.projects
    where id = v_expense.project_id and tenant_id = p_tenant_id and is_active = true
  ) then
    raise exception 'AP project is unavailable';
  end if;

  if v_tenant_role <> 'superadmin' then
    select scope_mode, resource_ids into v_scope_mode, v_resource_ids
    from public.tenant_user_work_scopes
    where tenant_id = p_tenant_id and user_id = p_actor_user_id and dimension = 'project';

    if not found or v_scope_mode not in ('all', 'selected') then
      raise exception 'Cashier project scope is not configured';
    end if;
    if v_scope_mode = 'selected'
       and not (v_expense.project_id::text = any(coalesce(v_resource_ids, '{}'::text[]))) then
      raise exception 'AP project is outside Cashier work scope';
    end if;
  end if;

  select coalesce(sum(amount), 0) into v_paid
  from public.expense_payments
  where tenant_id = p_tenant_id and expense_id = p_expense_id and status = 'Posted';

  v_outstanding := v_expense.amount - v_paid;
  if v_outstanding <= 0 then
    raise exception 'AP has no outstanding balance';
  end if;
  if p_amount > v_outstanding then
    raise exception 'Payment amount exceeds AP outstanding balance';
  end if;

  select coalesce(sum(amount), 0) into v_balance
  from public.project_cash_ledger
  where tenant_id = p_tenant_id and project_id = v_expense.project_id;

  if v_balance < p_amount then
    raise exception 'Insufficient project cashier cash balance';
  end if;

  insert into public.expense_payments(
    tenant_id, expense_id, payment_date, amount, payment_channel, payment_method,
    cashier_project_id, payment_reference, notes, status, created_by
  ) values (
    p_tenant_id, p_expense_id, p_payment_date, p_amount, 'Cashier', 'Tunai',
    v_expense.project_id, nullif(btrim(p_payment_reference), ''),
    nullif(btrim(p_notes), ''), 'Posted', p_actor_user_id
  ) returning id into v_payment_id;

  insert into public.project_cash_ledger(
    tenant_id, project_id, fund_request_id, expense_id, purchase_payment_request_id,
    expense_payment_id, entry_type, amount, description, created_by
  ) values (
    p_tenant_id, v_expense.project_id, null, null, null,
    v_payment_id, 'debit', -p_amount,
    'Pembayaran AP ' || v_expense.code, p_actor_user_id
  );

  v_new_paid := v_paid + p_amount;
  v_new_status := case when v_new_paid = v_expense.amount then 'Dibayar' else 'Partial' end;

  if v_new_status = 'Dibayar' then
    update public.expenses
    set status = 'Dibayar', paid_amount = amount, paid_at = now(),
        paid_by = p_actor_user_id, paid_method = 'Tunai',
        updated_at = now(), updated_by = p_actor_user_id
    where id = p_expense_id and tenant_id = p_tenant_id and ap_version = 2;
  else
    update public.expenses
    set status = 'Partial', paid_amount = null, paid_at = null,
        paid_by = null, paid_method = null,
        updated_at = now(), updated_by = p_actor_user_id
    where id = p_expense_id and tenant_id = p_tenant_id and ap_version = 2;
  end if;

  insert into public.audit_logs(
    tenant_id, actor_user_id, action, entity_type, entity_id, after_data
  ) values (
    p_tenant_id, p_actor_user_id, 'expense.ap_payment_posted', 'expense_payment',
    v_payment_id::text,
    jsonb_build_object(
      'expense_id', p_expense_id, 'expense_code', v_expense.code,
      'payment_channel', 'Cashier', 'payment_method', 'Tunai',
      'payment_date', p_payment_date, 'amount', p_amount,
      'total_paid', v_new_paid, 'outstanding', v_expense.amount - v_new_paid,
      'status', v_new_status, 'project_id', v_expense.project_id
    )
  );

  return v_payment_id;
end;
$function$;

revoke all on function public.ap_post_cashier_payment_with_audit(uuid,uuid,uuid,date,numeric,text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.ap_post_cashier_payment_with_audit(uuid,uuid,uuid,date,numeric,text,text)
  to service_role;

commit;
