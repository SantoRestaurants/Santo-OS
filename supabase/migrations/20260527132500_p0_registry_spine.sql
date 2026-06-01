-- SantoOS P0 registry spine.
--
-- Source of truth: Supabase/Postgres.
-- This migration intentionally uses placeholders marked [CONFIRM] for operational
-- inputs that Santo has not confirmed yet.

create extension if not exists pgcrypto;

create schema if not exists private;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
begin
  create type public.confirmation_status as enum ('confirmed', 'requires_review', 'deprecated');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.workflow_run_status as enum (
    'queued',
    'running',
    'waiting_for_input',
    'requires_review',
    'completed',
    'failed',
    'cancelled'
  );
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.task_status as enum (
    'pending',
    'in_progress',
    'requires_review',
    'completed',
    'failed',
    'cancelled'
  );
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.document_status as enum (
    'received',
    'registered',
    'requires_review',
    'validated',
    'rejected'
  );
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.exception_status as enum (
    'open',
    'requires_review',
    'acknowledged',
    'resolved',
    'dismissed'
  );
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.review_status as enum (
    'requested',
    'requires_review',
    'approved',
    'rejected',
    'changes_requested',
    'cancelled'
  );
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.approval_status as enum (
    'pending',
    'approved',
    'rejected',
    'revoked'
  );
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.email_processing_status as enum (
    'received',
    'classified',
    'linked',
    'requires_review',
    'ignored',
    'failed'
  );
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.event_severity as enum ('debug', 'info', 'warning', 'error', 'critical');
exception when duplicate_object then null;
end $$;

create table public.domains (
  id uuid primary key default gen_random_uuid(),
  domain_key text not null unique,
  display_name text not null,
  phase text not null default 'P0' check (phase in ('P0', 'P1', 'P2')),
  confirmation_status public.confirmation_status not null default 'requires_review',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.legal_entities (
  id uuid primary key default gen_random_uuid(),
  legal_entity_key text not null unique,
  display_name text not null,
  rfc text not null,
  confirmation_status public.confirmation_status not null default 'requires_review',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.restaurants (
  id uuid primary key default gen_random_uuid(),
  restaurant_key text not null unique,
  legal_entity_id uuid references public.legal_entities(id),
  short_code text not null unique,
  display_name text not null,
  confirmation_status public.confirmation_status not null default 'requires_review',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.people (
  id uuid primary key default gen_random_uuid(),
  person_key text not null unique,
  display_name text not null,
  email text not null unique,
  role_key text not null,
  confirmation_status public.confirmation_status not null default 'requires_review',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.vendors (
  id uuid primary key default gen_random_uuid(),
  vendor_key text not null unique,
  display_name text not null,
  rfc text,
  confirmation_status public.confirmation_status not null default 'requires_review',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workflows (
  id uuid primary key default gen_random_uuid(),
  domain_id uuid not null references public.domains(id),
  workflow_key text not null unique,
  display_name text not null,
  phase text not null default 'P0' check (phase in ('P0', 'P1', 'P2')),
  workflow_depth text not null default 'primary' check (workflow_depth in ('primary', 'secondary_thin', 'stub')),
  is_active boolean not null default true,
  default_config jsonb not null default '{}'::jsonb,
  confirmation_status public.confirmation_status not null default 'requires_review',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workflow_runs (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.workflows(id),
  restaurant_id uuid references public.restaurants(id),
  legal_entity_id uuid references public.legal_entities(id),
  business_date date,
  status public.workflow_run_status not null default 'queued',
  source_channel text not null check (source_channel in ('dashboard', 'agent_mail', 'scheduler', 'whatsapp_stub', 'system')),
  idempotency_key text not null,
  input_payload jsonb not null default '{}'::jsonb,
  config_snapshot jsonb not null default '{}'::jsonb,
  output_payload jsonb not null default '{}'::jsonb,
  requires_review_reason text,
  started_at timestamptz,
  finished_at timestamptz,
  created_by_person_id uuid references public.people(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workflow_id, idempotency_key)
);

create table public.email_messages (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'gmail',
  provider_message_id text not null,
  internet_message_id text,
  inbox_address text not null,
  from_address text not null,
  to_addresses text[] not null default array[]::text[],
  cc_addresses text[] not null default array[]::text[],
  subject text,
  received_at timestamptz not null,
  processing_status public.email_processing_status not null default 'received',
  classification_key text,
  workflow_id uuid references public.workflows(id),
  workflow_run_id uuid references public.workflow_runs(id),
  requires_review_reason text,
  raw_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_message_id)
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  workflow_run_id uuid references public.workflow_runs(id),
  email_message_id uuid references public.email_messages(id),
  document_key text,
  document_type text not null,
  source_system text not null check (source_system in ('agent_mail', 'drive', 'dashboard_upload', 'system')),
  source_uri text,
  drive_file_id text,
  source_hash text,
  status public.document_status not null default 'received',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index documents_run_source_hash_unique
on public.documents (workflow_run_id, source_hash)
where workflow_run_id is not null and source_hash is not null;

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  workflow_run_id uuid not null references public.workflow_runs(id),
  task_key text not null,
  title text not null,
  status public.task_status not null default 'pending',
  assigned_person_id uuid references public.people(id),
  due_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workflow_run_id, task_key)
);

create table public.exceptions (
  id uuid primary key default gen_random_uuid(),
  workflow_run_id uuid not null references public.workflow_runs(id),
  task_id uuid references public.tasks(id),
  document_id uuid references public.documents(id),
  exception_key text not null,
  exception_type text not null,
  severity text not null default 'medium' check (severity in ('low', 'medium', 'high', 'critical')),
  status public.exception_status not null default 'open',
  assigned_reviewer_person_id uuid references public.people(id),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workflow_run_id, exception_key)
);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  workflow_run_id uuid not null references public.workflow_runs(id),
  task_id uuid references public.tasks(id),
  exception_id uuid references public.exceptions(id),
  review_key text not null,
  status public.review_status not null default 'requested',
  reviewer_person_id uuid references public.people(id),
  requested_by_person_id uuid references public.people(id),
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  review_notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workflow_run_id, review_key)
);

create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.reviews(id),
  status public.approval_status not null default 'pending',
  approver_person_id uuid references public.people(id),
  decision_notes text,
  decided_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.watchdog_log (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid references public.workflows(id),
  workflow_run_id uuid references public.workflow_runs(id),
  check_key text not null,
  severity public.event_severity not null default 'info',
  status text not null check (status in ('ok', 'warning', 'requires_review', 'failed')),
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  checked_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  aggregate_type text not null,
  aggregate_id uuid,
  event_type text not null,
  severity public.event_severity not null default 'info',
  actor_person_id uuid references public.people(id),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.drive_folder_map (
  id uuid primary key default gen_random_uuid(),
  folder_key text not null unique,
  workflow_id uuid references public.workflows(id),
  restaurant_id uuid references public.restaurants(id),
  legal_entity_id uuid references public.legal_entities(id),
  drive_url text not null,
  confirmation_status public.confirmation_status not null default 'requires_review',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index workflow_runs_status_created_at_idx on public.workflow_runs (status, created_at desc);
create index workflow_runs_business_date_idx on public.workflow_runs (business_date);
create index email_messages_processing_status_idx on public.email_messages (processing_status, received_at desc);
create index documents_workflow_run_id_idx on public.documents (workflow_run_id);
create index tasks_workflow_run_id_status_idx on public.tasks (workflow_run_id, status);
create index exceptions_workflow_run_id_status_idx on public.exceptions (workflow_run_id, status);
create index reviews_status_requested_at_idx on public.reviews (status, requested_at desc);
create index watchdog_log_workflow_run_id_idx on public.watchdog_log (workflow_run_id);
create index events_aggregate_idx on public.events (aggregate_type, aggregate_id, created_at desc);

create trigger set_domains_updated_at
before update on public.domains
for each row execute function private.set_updated_at();

create trigger set_legal_entities_updated_at
before update on public.legal_entities
for each row execute function private.set_updated_at();

create trigger set_restaurants_updated_at
before update on public.restaurants
for each row execute function private.set_updated_at();

create trigger set_people_updated_at
before update on public.people
for each row execute function private.set_updated_at();

create trigger set_vendors_updated_at
before update on public.vendors
for each row execute function private.set_updated_at();

create trigger set_workflows_updated_at
before update on public.workflows
for each row execute function private.set_updated_at();

create trigger set_workflow_runs_updated_at
before update on public.workflow_runs
for each row execute function private.set_updated_at();

create trigger set_email_messages_updated_at
before update on public.email_messages
for each row execute function private.set_updated_at();

create trigger set_documents_updated_at
before update on public.documents
for each row execute function private.set_updated_at();

create trigger set_tasks_updated_at
before update on public.tasks
for each row execute function private.set_updated_at();

create trigger set_exceptions_updated_at
before update on public.exceptions
for each row execute function private.set_updated_at();

create trigger set_reviews_updated_at
before update on public.reviews
for each row execute function private.set_updated_at();

create trigger set_approvals_updated_at
before update on public.approvals
for each row execute function private.set_updated_at();

create trigger set_drive_folder_map_updated_at
before update on public.drive_folder_map
for each row execute function private.set_updated_at();

alter table public.domains enable row level security;
alter table public.legal_entities enable row level security;
alter table public.restaurants enable row level security;
alter table public.people enable row level security;
alter table public.vendors enable row level security;
alter table public.workflows enable row level security;
alter table public.workflow_runs enable row level security;
alter table public.email_messages enable row level security;
alter table public.documents enable row level security;
alter table public.tasks enable row level security;
alter table public.exceptions enable row level security;
alter table public.reviews enable row level security;
alter table public.approvals enable row level security;
alter table public.watchdog_log enable row level security;
alter table public.events enable row level security;
alter table public.drive_folder_map enable row level security;

revoke all on all tables in schema public from anon;
grant usage on schema public to authenticated, service_role;
grant select on all tables in schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to service_role;

create policy "authenticated_read_domains"
on public.domains for select to authenticated
using (auth.uid() is not null);

create policy "authenticated_read_legal_entities"
on public.legal_entities for select to authenticated
using (auth.uid() is not null);

create policy "authenticated_read_restaurants"
on public.restaurants for select to authenticated
using (auth.uid() is not null);

create policy "authenticated_read_people"
on public.people for select to authenticated
using (auth.uid() is not null);

create policy "authenticated_read_vendors"
on public.vendors for select to authenticated
using (auth.uid() is not null);

create policy "authenticated_read_workflows"
on public.workflows for select to authenticated
using (auth.uid() is not null);

create policy "authenticated_read_workflow_runs"
on public.workflow_runs for select to authenticated
using (auth.uid() is not null);

create policy "authenticated_read_email_messages"
on public.email_messages for select to authenticated
using (auth.uid() is not null);

create policy "authenticated_read_documents"
on public.documents for select to authenticated
using (auth.uid() is not null);

create policy "authenticated_read_tasks"
on public.tasks for select to authenticated
using (auth.uid() is not null);

create policy "authenticated_read_exceptions"
on public.exceptions for select to authenticated
using (auth.uid() is not null);

create policy "authenticated_read_reviews"
on public.reviews for select to authenticated
using (auth.uid() is not null);

create policy "authenticated_read_approvals"
on public.approvals for select to authenticated
using (auth.uid() is not null);

create policy "authenticated_read_watchdog_log"
on public.watchdog_log for select to authenticated
using (auth.uid() is not null);

create policy "authenticated_read_events"
on public.events for select to authenticated
using (auth.uid() is not null);

create policy "authenticated_read_drive_folder_map"
on public.drive_folder_map for select to authenticated
using (auth.uid() is not null);

insert into public.domains (
  domain_key,
  display_name,
  phase,
  confirmation_status,
  metadata
)
values (
  'admin_hr_payroll_accounting_fiscal',
  'Admin / HR / Payroll / Accounting / Fiscal',
  'P0',
  'confirmed',
  '{"source": "p0_prd"}'::jsonb
)
on conflict (domain_key) do update
set display_name = excluded.display_name,
    phase = excluded.phase,
    confirmation_status = excluded.confirmation_status,
    metadata = excluded.metadata;

insert into public.legal_entities (
  legal_entity_key,
  display_name,
  rfc,
  confirmation_status,
  metadata
)
values (
  'default_legal_entity_confirm',
  '[CONFIRM] Santo legal entity',
  '[CONFIRM]',
  'requires_review',
  '{"pending_input": "Restaurant/entity/RFC mappings and short codes"}'::jsonb
)
on conflict (legal_entity_key) do update
set display_name = excluded.display_name,
    rfc = excluded.rfc,
    confirmation_status = excluded.confirmation_status,
    metadata = excluded.metadata;

insert into public.restaurants (
  restaurant_key,
  legal_entity_id,
  short_code,
  display_name,
  confirmation_status,
  metadata
)
select
  'default_restaurant_confirm',
  legal_entities.id,
  '[CONFIRM]',
  '[CONFIRM] First P0 restaurant/unit',
  'requires_review',
  '{"pending_input": "One restaurant/unit first"}'::jsonb
from public.legal_entities
where legal_entity_key = 'default_legal_entity_confirm'
on conflict (restaurant_key) do update
set legal_entity_id = excluded.legal_entity_id,
    short_code = excluded.short_code,
    display_name = excluded.display_name,
    confirmation_status = excluded.confirmation_status,
    metadata = excluded.metadata;

insert into public.people (
  person_key,
  display_name,
  email,
  role_key,
  confirmation_status,
  metadata
)
values (
  'default_review_owner_confirm',
  '[CONFIRM] Default review owner',
  '[CONFIRM]',
  '[CONFIRM]',
  'requires_review',
  '{"pending_input": "Reviewer map by exception type"}'::jsonb
)
on conflict (person_key) do update
set display_name = excluded.display_name,
    email = excluded.email,
    role_key = excluded.role_key,
    confirmation_status = excluded.confirmation_status,
    metadata = excluded.metadata;

insert into public.workflows (
  domain_id,
  workflow_key,
  display_name,
  phase,
  workflow_depth,
  is_active,
  default_config,
  confirmation_status
)
select
  domains.id,
  workflow_seed.workflow_key,
  workflow_seed.display_name,
  'P0',
  workflow_seed.workflow_depth,
  true,
  workflow_seed.default_config,
  workflow_seed.confirmation_status::public.confirmation_status
from public.domains
cross join (
  values
    (
      'corte_santo_daily_sales_reconciliation',
      'Corte Santo - Daily Sales Reconciliation',
      'primary',
      '{
        "thresholds": "[CONFIRM]",
        "mandatory_attachments": "[CONFIRM]",
        "reviewer_map": "[CONFIRM]",
        "routing": "[CONFIRM]"
      }'::jsonb,
      'requires_review'
    ),
    (
      'xml_sat_validation',
      'XML SAT Validation',
      'secondary_thin',
      '{
        "rfc_map": "[CONFIRM]",
        "source_exports": "[CONFIRM]"
      }'::jsonb,
      'requires_review'
    ),
    (
      'utility_receipts_matching',
      'Utility Receipts Matching',
      'secondary_thin',
      '{
        "drive_folders": "[CONFIRM]",
        "template_columns": "[CONFIRM]",
        "sheets_writeback": "[CONFIRM]"
      }'::jsonb,
      'requires_review'
    )
) as workflow_seed(workflow_key, display_name, workflow_depth, default_config, confirmation_status)
where domains.domain_key = 'admin_hr_payroll_accounting_fiscal'
on conflict (workflow_key) do update
set domain_id = excluded.domain_id,
    display_name = excluded.display_name,
    phase = excluded.phase,
    workflow_depth = excluded.workflow_depth,
    is_active = excluded.is_active,
    default_config = excluded.default_config,
    confirmation_status = excluded.confirmation_status;

insert into public.drive_folder_map (
  folder_key,
  workflow_id,
  restaurant_id,
  legal_entity_id,
  drive_url,
  confirmation_status,
  metadata
)
select
  'corte_santo_root_confirm',
  workflows.id,
  restaurants.id,
  restaurants.legal_entity_id,
  '[CONFIRM]',
  'requires_review',
  '{"pending_input": "Drive URLs, hierarchy and naming"}'::jsonb
from public.workflows
cross join public.restaurants
where workflows.workflow_key = 'corte_santo_daily_sales_reconciliation'
  and restaurants.restaurant_key = 'default_restaurant_confirm'
on conflict (folder_key) do update
set workflow_id = excluded.workflow_id,
    restaurant_id = excluded.restaurant_id,
    legal_entity_id = excluded.legal_entity_id,
    drive_url = excluded.drive_url,
    confirmation_status = excluded.confirmation_status,
    metadata = excluded.metadata;
