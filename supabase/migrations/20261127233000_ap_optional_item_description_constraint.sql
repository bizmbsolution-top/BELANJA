-- Allow blank free-text descriptions on AP expense lines only.
-- Preserve the legacy non-AP rule: descriptions must remain non-blank.
begin;

create or replace function public.enforce_expense_item_description_rule()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_ap_version integer;
begin
  select e.ap_version
    into v_ap_version
  from public.expenses e
  where e.id = new.expense_id
    and e.tenant_id = new.tenant_id;

  if not found then
    raise exception 'Expense header not found for expense item';
  end if;

  if v_ap_version = 2 then
    -- AP line descriptions are optional free text; normalize NULL/whitespace to empty.
    new.description := coalesce(btrim(new.description), '');
    if length(new.description) > 500 then
      raise exception 'AP line description is limited to 500 characters';
    end if;
  else
    -- Keep the original legacy requirement for non-AP expense items.
    if new.description is null or length(btrim(new.description)) = 0 then
      raise exception 'Expense item description is required for legacy expenses';
    end if;
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_enforce_expense_item_description_rule on public.expense_items;
create trigger trg_enforce_expense_item_description_rule
before insert or update of description, expense_id, tenant_id
on public.expense_items
for each row
execute function public.enforce_expense_item_description_rule();

alter table public.expense_items
  drop constraint if exists expense_items_description_check;

-- NOT NULL remains enforced by the column; blank text is normalized to '' for AP only.
alter table public.expense_items
  add constraint expense_items_description_check
  check (description is not null);

revoke all on function public.enforce_expense_item_description_rule() from public, anon, authenticated;

commit;
