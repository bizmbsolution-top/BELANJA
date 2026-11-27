-- Add formula configuration to the existing tenant-scoped expense category master.
-- This migration is branch-only and must be reviewed before production application.

alter table public.expense_categories
  add column if not exists expense_type text not null default 'company_payable',
  add column if not exists calculation_method text not null default 'manual',
  add column if not exists calculation_basis text not null default 'manual',
  add column if not exists calculation_rate numeric(18,6) null;

alter table public.expense_categories
  drop constraint if exists expense_categories_expense_type_check,
  add constraint expense_categories_expense_type_check
    check (expense_type in ('company_payable','transaction_deduction')),
  drop constraint if exists expense_categories_calculation_method_check,
  add constraint expense_categories_calculation_method_check
    check (calculation_method in ('manual','percentage','per_kg','per_grade_point','per_kg_grade','per_transaction','fixed')),
  drop constraint if exists expense_categories_calculation_basis_check,
  add constraint expense_categories_calculation_basis_check
    check (calculation_basis in ('manual','final_amount','purchase_cost','received_weight_kg','final_grade_value','received_weight_x_grade','per_transaction','fixed')),
  drop constraint if exists expense_categories_formula_consistency_check,
  add constraint expense_categories_formula_consistency_check check (
    (calculation_method='manual' and calculation_basis='manual' and calculation_rate is null)
    or (calculation_method='percentage' and calculation_basis in ('final_amount','purchase_cost') and calculation_rate > 0)
    or (calculation_method='per_kg' and calculation_basis='received_weight_kg' and calculation_rate > 0)
    or (calculation_method='per_grade_point' and calculation_basis='final_grade_value' and calculation_rate > 0)
    or (calculation_method='per_kg_grade' and calculation_basis='received_weight_x_grade' and calculation_rate > 0)
    or (calculation_method='per_transaction' and calculation_basis='per_transaction' and calculation_rate > 0)
    or (calculation_method='fixed' and calculation_basis='fixed' and calculation_rate > 0)
  );

-- Immutable-at-transaction-time formula snapshot fields for AP lines.
alter table public.expense_items
  add column if not exists formula_method text null,
  add column if not exists formula_basis text null,
  add column if not exists formula_rate numeric(18,6) null,
  add column if not exists formula_base_value numeric(18,6) null,
  add column if not exists formula_result numeric(18,2) null,
  add column if not exists formula_snapshot jsonb null;

alter table public.expense_items
  drop constraint if exists expense_items_formula_method_check,
  add constraint expense_items_formula_method_check
    check (formula_method is null or formula_method in ('manual','percentage','per_kg','per_grade_point','per_kg_grade','per_transaction','fixed'));

comment on column public.expense_categories.expense_type is 'company_payable creates a company payable; transaction_deduction is a transaction deduction and is not an AP payable.';
comment on column public.expense_categories.calculation_method is 'Default formula method used when this category is selected in a new AP line.';
comment on column public.expense_items.formula_snapshot is 'Frozen calculation inputs and output captured when the AP draft line is saved.';
