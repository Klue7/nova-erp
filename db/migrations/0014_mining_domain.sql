-- begin 0014_mining_domain.sql

-- Catalog of haulage equipment available to mining operators.
create table if not exists mining_vehicles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  code text not null,
  description text,
  capacity_tonnes numeric,
  status text not null default 'active', -- active | maintenance | retired
  created_at timestamptz not null default now(),
  unique (tenant_id, code)
);

alter table mining_vehicles enable row level security;

create policy "tenant_select_mining_vehicles"
  on mining_vehicles for select
  using (
    tenant_id = (
      select tenant_id from profiles where id = auth.uid()
    )
  );

create policy "tenant_manage_mining_vehicles"
  on mining_vehicles for all
  using (
    tenant_id = (
      select tenant_id from profiles where id = auth.uid()
    )
  )
  with check (
    tenant_id = (
      select tenant_id from profiles where id = auth.uid()
    )
  );

-- Shift assignments (operator + vehicle) to enable load capture.
create table if not exists mining_shifts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  vehicle_id uuid not null references mining_vehicles(id),
  operator_id uuid not null references profiles(id),
  operator_name text,
  operator_role text,
  status text not null default 'active', -- active | completed | cancelled
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);

alter table mining_shifts enable row level security;

create policy "tenant_select_mining_shifts"
  on mining_shifts for select
  using (
    tenant_id = (
      select tenant_id from profiles where id = auth.uid()
    )
  );

create policy "tenant_manage_own_mining_shifts"
  on mining_shifts for all
  using (
    tenant_id = (
      select tenant_id from profiles where id = auth.uid()
    )
    and operator_id = auth.uid()
  )
  with check (
    tenant_id = (
      select tenant_id from profiles where id = auth.uid()
    )
    and operator_id = auth.uid()
  );

-- Ensure a vehicle can have at most one active shift per tenant.
create unique index if not exists idx_mining_shifts_active_vehicle
  on mining_shifts (tenant_id, vehicle_id)
  where status = 'active';

-- Convenience view over mining-related events.
create or replace view mining_events as
  select *
  from events
  where aggregate_type in ('mining.shift', 'mining.load');

-- Loads captured by mining operators (derived from events).
create or replace view mining_loads_v as
  select
    e.tenant_id,
    (e.payload->>'loadId')::uuid         as load_id,
    (e.payload->>'shiftId')::uuid        as shift_id,
    (e.payload->>'vehicleId')::uuid      as vehicle_id,
    e.payload->>'vehicleCode'            as vehicle_code,
    (e.payload->>'stockpileId')::uuid    as stockpile_id,
    e.payload->>'stockpileCode'          as stockpile_code,
    (e.payload->>'operatorId')::uuid     as operator_id,
    e.payload->>'operatorName'           as operator_name,
    (e.payload->>'tonnage')::numeric     as tonnage,
    (e.payload->>'moisturePct')::numeric as moisture_pct,
    e.payload->>'notes'                  as notes,
    e.occurred_at
  from events e
  where e.aggregate_type = 'mining.load'
    and e.event_type = 'MINING_LOAD_RECORDED';

-- Shift summary with aggregated load information.
create or replace view mining_shift_summary_v as
  select
    s.tenant_id,
    s.id as shift_id,
    s.vehicle_id,
    v.code as vehicle_code,
    s.operator_id,
    s.operator_name,
    s.operator_role,
    s.status,
    s.started_at,
    s.ended_at,
    s.notes,
    coalesce(sum(l.tonnage), 0) as total_tonnage,
    count(l.load_id) as load_count,
    avg(l.moisture_pct) as avg_moisture_pct,
    max(l.occurred_at) as last_load_at
  from mining_shifts s
  join mining_vehicles v
    on v.id = s.vehicle_id
   and v.tenant_id = s.tenant_id
  left join mining_loads_v l
    on l.shift_id = s.id
   and l.tenant_id = s.tenant_id
  group by
    s.tenant_id,
    s.id,
    v.code,
    s.vehicle_id,
    s.operator_id,
    s.operator_name,
    s.operator_role,
    s.status,
    s.started_at,
    s.ended_at,
    s.notes;

-- end 0014_mining_domain.sql
