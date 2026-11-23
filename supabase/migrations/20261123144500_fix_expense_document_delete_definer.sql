create or replace function public.delete_expense_document_with_audit(
  p_document_id uuid,
  p_actor_user_id uuid
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_doc public.expense_documents%rowtype;
  v_code text;
begin
  select * into v_doc
  from public.expense_documents
  where id = p_document_id
  for update;

  if not found then
    raise exception 'Expense document not found';
  end if;

  select code into v_code
  from public.expenses
  where id = v_doc.expense_id;

  insert into public.audit_logs(
    actor_user_id, action, entity_type, entity_id, before_data
  )
  values(
    p_actor_user_id,
    'expense_document.deleted',
    'expense_document',
    v_doc.id::text,
    jsonb_build_object(
      'expense_code', v_code,
      'file_name', v_doc.file_name,
      'mime_type', v_doc.mime_type,
      'file_size', v_doc.file_size
    )
  );

  delete from public.expense_documents
  where id = p_document_id;
end;
$function$;

revoke all on function public.delete_expense_document_with_audit(uuid, uuid)
from public, anon, authenticated, service_role;

grant execute on function public.delete_expense_document_with_audit(uuid, uuid)
to service_role;
