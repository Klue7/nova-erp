-- begin 0012_admin_domain.sql

-- ============ Tenants ============
create table if not exists tenants (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  status text not null default 'active',
  created_at timestamptz default now()
);
alter table tenants enable row level security;

-- Profiles: add platform admin flag if missing
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name='profiles' and column_name='is_platform_admin'
  ) then
    alter table profiles add column is_platform_admin boolean not null default false;
  end if;
end$$;

-- ============ Memberships ============
-- Allow multiple roles per user per tenant (composite PK includes role)
create table if not exists memberships (
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null,
  created_at timestamptz default now(),
  primary key (tenant_id, user_id, role)
);
alter table memberships enable row level security;

-- ============ Invites ============
create table if not exists invites (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  email text not null,
  role text not null,
  token text not null,
  status text not null default 'pending', -- pending | accepted | cancelled | expired
  expires_at timestamptz default (now() + interval '7 days'),
  created_at timestamptz default now()
);
alter table invites enable row level security;

-- Optional tenant settings store for metadata/preferences
create table if not exists tenant_settings (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);
alter table tenant_settings enable row level security;

-- ============ RLS Helpers ============
create or replace view current_user_v as
select p.id as user_id, p.tenant_id, p.is_platform_admin
from profiles p
where p.id = auth.uid();

-- Common predicates
create or replace function is_member_of(tenant uuid)
returns boolean language sql stable as $$
  select exists(
    select 1 from memberships m
    where m.tenant_id = tenant and m.user_id = auth.uid()
  ) or coalesce((select is_platform_admin from current_user_v), false)
$$;

create or replace function is_admin_of(tenant uuid)
returns boolean language sql stable as $$
  select exists(
    select 1 from memberships m
    where m.tenant_id = tenant and m.user_id = auth.uid()
      and m.role in ('admin')
  ) or coalesce((select is_platform_admin from current_user_v), false)
$$;

-- ============ Policies ============
-- Tenants
create policy "tenant_select_tenants"
  on tenants for select using ( is_member_of(id) );

create policy "tenant_insert_tenants"
  on tenants for insert with check ( (select coalesce(is_platform_admin, false) from current_user_v) );

create policy "tenant_update_tenants"
  on tenants for update using ( is_admin_of(id) ) with check ( is_admin_of(id) );

-- Memberships
create policy "tenant_select_memberships"
  on memberships for select using ( is_member_of(tenant_id) );

create policy "tenant_insert_memberships"
  on memberships for insert with check ( is_admin_of(tenant_id) );

create policy "tenant_delete_memberships"
  on memberships for delete using ( is_admin_of(tenant_id) );

-- Tenant settings
create policy "tenant_select_settings"
  on tenant_settings for select using ( is_member_of(tenant_id) );

create policy "tenant_upsert_settings"
  on tenant_settings for insert with check ( is_admin_of(tenant_id) );

create policy "tenant_update_settings"
  on tenant_settings for update using ( is_admin_of(tenant_id) ) with check ( is_admin_of(tenant_id) );

-- Invites
create policy "tenant_select_invites"
  on invites for select using ( is_admin_of(tenant_id) or (email = (select email from auth.users where id=auth.uid())) );

create policy "tenant_insert_invites"
  on invites for insert with check ( is_admin_of(tenant_id) );

create policy "tenant_update_invites"
  on invites for update using ( is_admin_of(tenant_id) );

-- ============ Audit & Views ============
create or replace view user_memberships_v as
select m.tenant_id, t.code as tenant_code, t.name as tenant_name,
       m.user_id, m.role, m.created_at
from memberships m
join tenants t on t.id = m.tenant_id
where is_member_of(m.tenant_id);

-- lightweight audit pulled from events
create or replace view admin_audit_v as
select e.tenant_id, e.actor_id, e.actor_role, e.aggregate_type, e.event_type, e.payload, e.occurred_at
from events e
where is_member_of(e.tenant_id);

-- Optional: roles catalog (for UI validation)
create table if not exists roles_catalog (
  role text primary key
);
insert into roles_catalog(role)
values
  ('admin'),('viewer'),
  ('mining_operator'),('stockpile_operator'),('mixing_operator'),('crushing_operator'),
  ('extrusion_operator'),('dryyard_operator'),('kiln_operator'),
  ('packing_operator'),('dispatch_clerk'),('sales_rep'),('finance')
on conflict do nothing;

-- end 0012_admin_domain.sql
