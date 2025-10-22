-- Enable cryptographic functions required for UUID generation
create extension if not exists "pgcrypto";

create table if not exists profiles (
  id uuid primary key references auth.users on delete cascade,
  role text not null,
  tenant_id uuid not null,
  full_name text,
  created_at timestamptz default now()
);

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz default now(),
  tenant_id uuid not null,
  actor_id uuid not null,
  actor_role text not null,
  aggregate_type text not null,
  aggregate_id text not null,
  event_type text not null,
  payload jsonb not null,
  source text default 'web',
  correlation_id uuid,
  causation_id uuid
);

alter table profiles enable row level security;
alter table events enable row level security;

create policy "Users can view own profile" on profiles
  for select
  using (id = auth.uid());

create policy "Users can insert own profile" on profiles
  for insert
  with check (id = auth.uid());

create policy "Users can update own profile" on profiles
  for update
  using (id = auth.uid());

create policy "Users can select tenant events" on events
  for select
  using (
    tenant_id = (
      select tenant_id from profiles where id = auth.uid()
    )
  );

create policy "Users can insert tenant events" on events
  for insert
  with check (
    tenant_id = (
      select tenant_id from profiles where id = auth.uid()
    )
    and actor_id = auth.uid()
  );
