drop index if exists public.units_of_measure_name_lower_uidx;
drop index if exists public.units_of_measure_symbol_lower_uidx;

create unique index units_of_measure_tenant_name_lower_uidx
  on public.units_of_measure (tenant_id, lower(name));

create unique index units_of_measure_tenant_symbol_lower_uidx
  on public.units_of_measure (tenant_id, lower(symbol));
