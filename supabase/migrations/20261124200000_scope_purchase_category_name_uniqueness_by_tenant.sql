-- Purchase category names are unique within a tenant, not across the platform.
-- Existing category rows remain untouched.
drop index if exists public.purchase_categories_name_lower_uidx;

create unique index purchase_categories_tenant_name_lower_uidx
  on public.purchase_categories (tenant_id, lower(name));
