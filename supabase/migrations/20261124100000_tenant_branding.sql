-- Tenant branding: company logo is stored in Supabase Storage; URL is tenant-specific.
-- This additive change was applied directly to the connected project before being committed here.
alter table public.tenants add column if not exists logo_url text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tenant-branding', 'tenant-branding', true, 2097152, array['image/png','image/jpeg','image/webp'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
