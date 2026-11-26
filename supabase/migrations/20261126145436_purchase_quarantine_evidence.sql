create table if not exists public.inventory_lot_quarantine_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  quarantine_id uuid not null references public.inventory_lot_quarantines(id) on delete restrict,
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp')),
  file_size bigint not null check (file_size > 0 and file_size <= 10485760),
  created_by uuid not null,
  created_at timestamptz not null default now()
);
create index if not exists inventory_lot_quarantine_documents_tenant_case_idx
  on public.inventory_lot_quarantine_documents(tenant_id, quarantine_id, created_at desc);
alter table public.inventory_lot_quarantine_documents enable row level security;
revoke all on public.inventory_lot_quarantine_documents from anon, authenticated;
grant all on public.inventory_lot_quarantine_documents to service_role;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('inventory-lot-quarantine-evidence','inventory-lot-quarantine-evidence',false,10485760,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=false,file_size_limit=10485760,allowed_mime_types=excluded.allowed_mime_types;
