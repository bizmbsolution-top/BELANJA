create index if not exists inventory_lots_project_idx on public.inventory_lots(project_id);
create index if not exists inventory_lots_category_idx on public.inventory_lots(category_id);
create index if not exists inventory_lots_created_by_idx on public.inventory_lots(created_by);
