-- AP line descriptions are optional free text.
-- Keep the column NOT NULL and enforce the UI/RPC maximum of 500 characters,
-- but allow an empty string for AP expense items.
begin;

alter table public.expense_items
  drop constraint if exists expense_items_description_check;

alter table public.expense_items
  add constraint expense_items_description_check
  check (length(btrim(description)) <= 500);

commit;
