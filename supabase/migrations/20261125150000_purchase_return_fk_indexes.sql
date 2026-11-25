-- Index foreign-key columns used by quarantine and return records.
create index if not exists inventory_lot_quarantines_lot_fk_idx on public.inventory_lot_quarantines(lot_id);
create index if not exists inventory_lot_quarantines_created_by_fk_idx on public.inventory_lot_quarantines(created_by);
create index if not exists inventory_lot_quarantines_closed_by_fk_idx on public.inventory_lot_quarantines(closed_by);
create index if not exists purchase_returns_created_by_fk_idx on public.purchase_returns(created_by);
create index if not exists purchase_returns_posted_by_fk_idx on public.purchase_returns(posted_by);
create index if not exists purchase_returns_cancelled_by_fk_idx on public.purchase_returns(cancelled_by);
create index if not exists purchase_return_items_header_fk_idx on public.purchase_return_items(purchase_return_id);
create index if not exists purchase_return_items_quarantine_fk_idx on public.purchase_return_items(quarantine_id);
create index if not exists purchase_return_items_lot_fk_idx on public.purchase_return_items(lot_id);
