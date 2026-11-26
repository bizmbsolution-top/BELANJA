-- Keep supplier return credit operations server-side only.
revoke all on function public.set_purchase_return_supplier_credit_decision_with_audit(uuid,text,uuid,uuid) from public, anon, authenticated;
grant execute on function public.set_purchase_return_supplier_credit_decision_with_audit(uuid,text,uuid,uuid) to service_role;
revoke all on function public.complete_purchase_receipt_with_supplier_credit_and_split_with_audit(uuid,uuid,numeric,numeric,text,uuid) from public, anon, authenticated;
grant execute on function public.complete_purchase_receipt_with_supplier_credit_and_split_with_audit(uuid,uuid,numeric,numeric,text,uuid) to service_role;
revoke all on function public.create_purchase_return_supplier_credits_after_post() from public, anon, authenticated;