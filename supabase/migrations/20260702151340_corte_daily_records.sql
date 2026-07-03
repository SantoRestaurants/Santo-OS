-- Canonical daily financial record for Corte Santo.
-- Workflow runs remain the audit trail; this table is the stable read model.

create table public.corte_daily_records (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id),
  business_date date not null,
  weekday smallint generated always as (extract(isodow from business_date)::smallint) stored,
  amex numeric(14,2) not null default 0,
  debito numeric(14,2) not null default 0,
  credito numeric(14,2) not null default 0,
  efectivo numeric(14,2) not null default 0,
  transferencia numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  paypal numeric(14,2) not null default 0,
  uber_eats numeric(14,2) not null default 0,
  rappi numeric(14,2) not null default 0,
  propinas numeric(14,2) not null default 0,
  venta_bruta numeric(14,2),
  total_bruto numeric(14,2),
  forecast_target numeric(14,2),
  extra_values jsonb not null default '{}'::jsonb,
  source_kind text not null check (source_kind in ('historical_import', 'automatic_corte', 'manual_correction', 'batch_reprocess')),
  source_document_id uuid references public.documents(id),
  source_workflow_run_id uuid references public.workflow_runs(id),
  source_filename text,
  source_sheet text,
  source_row integer,
  source_hash text,
  parser_version text not null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (restaurant_id, business_date),
  check (source_row is null or source_row > 0)
);

create index corte_daily_records_business_date_idx
on public.corte_daily_records (business_date desc);

create index corte_daily_records_source_workflow_run_id_idx
on public.corte_daily_records (source_workflow_run_id)
where source_workflow_run_id is not null;

create index corte_daily_records_source_document_id_idx
on public.corte_daily_records (source_document_id)
where source_document_id is not null;

create trigger set_corte_daily_records_updated_at
before update on public.corte_daily_records
for each row execute function private.set_updated_at();

alter table public.corte_daily_records enable row level security;

revoke all on public.corte_daily_records from anon;
grant select on public.corte_daily_records to authenticated;
grant select, insert, update, delete on public.corte_daily_records to service_role;

create policy "authenticated_read_corte_daily_records"
on public.corte_daily_records for select to authenticated
using ((select auth.uid()) is not null);

comment on table public.corte_daily_records is
  'One canonical Corte financial record per restaurant and business date.';
comment on column public.corte_daily_records.venta_bruta is
  'Venta Real source of truth, extracted from the Venta Bruta spreadsheet field.';
comment on column public.corte_daily_records.total_bruto is
  'Spreadsheet Total Bruto retained separately; never used as Venta Real.';
