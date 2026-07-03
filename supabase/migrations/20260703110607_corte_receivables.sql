-- Item-level CxC ledger. Daily Corte rows keep accounting totals; this table
-- preserves the receivable lifecycle and prevents principal duplication.

create table public.corte_receivables (
  id uuid primary key default gen_random_uuid(),
  receivable_key text not null unique,
  restaurant_id uuid not null references public.restaurants(id),
  movement_id text,
  opened_on date not null,
  principal numeric(14,2) not null check (principal > 0),
  settled_on date,
  settled_principal numeric(14,2) not null default 0 check (settled_principal >= 0),
  settlement_tip numeric(14,2) not null default 0 check (settlement_tip >= 0),
  status text not null default 'open'
    check (status in ('open', 'settled', 'cancelled', 'requires_review')),
  source_provider_message_id text not null,
  source_workflow_run_id uuid references public.workflow_runs(id),
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'settled') = (settled_on is not null))
);

create unique index corte_receivables_movement_uidx
on public.corte_receivables (restaurant_id, movement_id)
where movement_id is not null;

create index corte_receivables_open_idx
on public.corte_receivables (restaurant_id, opened_on, status);

create index corte_receivables_source_workflow_run_id_idx
on public.corte_receivables (source_workflow_run_id)
where source_workflow_run_id is not null;

create trigger set_corte_receivables_updated_at
before update on public.corte_receivables
for each row execute function private.set_updated_at();

alter table public.corte_receivables enable row level security;
revoke all on public.corte_receivables from anon;
grant select on public.corte_receivables to authenticated;
grant select, insert, update, delete on public.corte_receivables to service_role;

create policy "authenticated_read_corte_receivables"
on public.corte_receivables for select to authenticated
using ((select auth.uid()) is not null);

comment on table public.corte_receivables is
  'One stable lifecycle row per Corte account receivable; principal is recognized only on opening.';
