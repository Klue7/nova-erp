-- begin 0007_kiln_domain.sql

-- Master table for kiln batches (metadata)
create table if not exists kiln_batches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  code text not null,
  status text not null default 'planned',  -- planned | active | paused | completed | cancelled
  kiln_code text,
  firing_curve_code text,
  target_units numeric,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz default now(),
  unique (tenant_id, code)
);
alter table kiln_batches enable row level security;

create policy "tenant_select_kiln_batches"
  on kiln_batches for select
  using (tenant_id = (select tenant_id from profiles where id = auth.uid()));

create policy "tenant_insert_kiln_batches"
  on kiln_batches for insert
  with check (tenant_id = (select tenant_id from profiles where id = auth.uid()));

create policy "tenant_update_kiln_batches"
  on kiln_batches for update
  using (tenant_id = (select tenant_id from profiles where id = auth.uid()))
  with check (tenant_id = (select tenant_id from profiles where id = auth.uid()));

-- Convenience subset of events for kiln
create or replace view kiln_events as
  select e.*
  from events e
  where e.aggregate_type = 'kiln_batch';

-- Inputs (from KILN_INPUT_ADDED)
create or replace view kiln_inputs_v as
select
  e.tenant_id,
  (e.payload->>'batchId')::uuid as batch_id,
  sum(coalesce((e.payload->>'quantityUnits')::numeric,0)) as input_units,
  max(e.occurred_at) as last_input_at
from events e
where e.aggregate_type='kiln_batch'
  and e.event_type='KILN_INPUT_ADDED'
group by e.tenant_id, (e.payload->>'batchId')::uuid;

-- Outputs (units) from OUTPUT_RECORDED or COMPLETED
create or replace view kiln_outputs_v as
select
  e.tenant_id,
  (e.payload->>'batchId')::uuid as batch_id,
  sum(coalesce((e.payload->>'firedUnits')::numeric,0)) as fired_units,
  avg((e.payload->>'shrinkagePct')::numeric) as avg_shrinkage_pct,
  max(e.occurred_at) as last_output_at
from events e
where e.aggregate_type='kiln_batch'
  and e.event_type in ('KILN_OUTPUT_RECORDED','KILN_BATCH_COMPLETED')
group by e.tenant_id, (e.payload->>'batchId')::uuid;

-- Downtime minutes (log entries)
create or replace view kiln_downtime_v as
select
  e.tenant_id,
  (e.payload->>'batchId')::uuid as batch_id,
  sum(coalesce((e.payload->>'minutes')::numeric,0)) as downtime_minutes
from events e
where e.aggregate_type='kiln_batch'
  and e.event_type='KILN_BATCH_PAUSED'
group by e.tenant_id, (e.payload->>'batchId')::uuid;

-- Fuel usage
create or replace view kiln_fuel_v as
select
  e.tenant_id,
  (e.payload->>'batchId')::uuid as batch_id,
  (e.payload->>'fuelType')::text as fuel_type,
  sum(coalesce((e.payload->>'amount')::numeric,0)) as amount,
  coalesce((e.payload->>'unit')::text,'') as unit
from events e
where e.aggregate_type='kiln_batch'
  and e.event_type='KILN_FUEL_USAGE_RECORDED'
group by e.tenant_id, (e.payload->>'batchId')::uuid, (e.payload->>'fuelType')::text, coalesce((e.payload->>'unit')::text,'');

-- Latest per-zone temperature
create or replace view kiln_zone_temps_latest as
with z as (
  select
    e.tenant_id,
    (e.payload->>'batchId')::uuid as batch_id,
    (e.payload->>'zone')::text as zone,
    (e.payload->>'temperatureC')::numeric as temperature_c,
    e.occurred_at,
    row_number() over (partition by e.tenant_id, (e.payload->>'batchId')::uuid, (e.payload->>'zone')::text order by e.occurred_at desc) rn
  from events e
  where e.aggregate_type='kiln_batch'
    and e.event_type='KILN_ZONE_TEMP_RECORDED'
)
select tenant_id, batch_id, zone, temperature_c, occurred_at
from z where rn = 1;

-- Latest batch status from events
create or replace view kiln_status_latest as
with states as (
  select
    e.tenant_id,
    (e.payload->>'batchId')::uuid as batch_id,
    e.event_type,
    e.occurred_at,
    row_number() over (partition by e.tenant_id, (e.payload->>'batchId')::uuid order by e.occurred_at desc) rn
  from events e
  where e.aggregate_type='kiln_batch'
    and e.event_type in ('KILN_BATCH_CREATED','KILN_BATCH_STARTED','KILN_BATCH_PAUSED','KILN_BATCH_RESUMED','KILN_BATCH_COMPLETED','KILN_BATCH_CANCELLED')
)
select tenant_id, batch_id,
  case event_type
    when 'KILN_BATCH_COMPLETED' then 'completed'
    when 'KILN_BATCH_CANCELLED' then 'cancelled'
    when 'KILN_BATCH_PAUSED'    then 'paused'
    when 'KILN_BATCH_STARTED'   then 'active'
    else 'planned' end as status,
  occurred_at as status_changed_at
from states
where rn = 1;

-- Link Dry Yard → Kiln: available dried units per completed Dry load
-- (dry_inputs_v, dry_scrap_v, dry_loads from 0006; reuse them)
create or replace view dry_completed_output_v as
select
  l.tenant_id,
  l.id as load_id,
  coalesce(i.input_units,0) - coalesce(s.scrap_units,0) as output_units
from dry_loads l
left join dry_inputs_v i on i.tenant_id=l.tenant_id and i.load_id=l.id
left join dry_scrap_v  s on s.tenant_id=l.tenant_id and s.load_id=l.id
where l.completed_at is not null;

create or replace view kiln_consumption_from_dry_v as
select
  e.tenant_id,
  (e.payload->>'dryLoadId')::uuid as load_id,
  sum(coalesce((e.payload->>'quantityUnits')::numeric,0)) as consumed_units
from events e
where e.aggregate_type='kiln_batch'
  and e.event_type='KILN_INPUT_ADDED'
  and (e.payload ? 'dryLoadId')
group by e.tenant_id, (e.payload->>'dryLoadId')::uuid;

create or replace view dry_available_for_kiln_v as
select
  d.tenant_id,
  d.load_id,
  (d.output_units - coalesce(k.consumed_units,0)) as available_units
from dry_completed_output_v d
left join kiln_consumption_from_dry_v k
  on k.tenant_id=d.tenant_id and k.load_id=d.load_id;

-- Batch metrics & KPIs
create or replace view kiln_batch_metrics_v as
select
  b.tenant_id,
  b.id as batch_id,
  b.code,
  b.kiln_code,
  b.firing_curve_code,
  b.started_at,
  b.completed_at,
  coalesce(i.input_units,0) as input_units,
  coalesce(o.fired_units,0) as fired_units,
  coalesce(d.downtime_minutes,0) as downtime_minutes,
  greatest(extract(epoch from (coalesce(b.completed_at, now()) - b.started_at))/3600.0, 0.01) as run_time_hours_gross,
  greatest(extract(epoch from (coalesce(b.completed_at, now()) - b.started_at))/3600.0 - (coalesce(d.downtime_minutes,0)/60.0), 0.01) as run_time_hours_net,
  case when coalesce(i.input_units,0) > 0 then (coalesce(o.fired_units,0) / i.input_units) * 100 else null end as yield_pct
from kiln_batches b
left join kiln_inputs_v  i on i.tenant_id=b.tenant_id and i.batch_id=b.id
left join kiln_outputs_v o on o.tenant_id=b.tenant_id and o.batch_id=b.id
left join kiln_downtime_v d on d.tenant_id=b.tenant_id and d.batch_id=b.id;

create or replace view kiln_kpi_today as
with fired_today as (
  select tenant_id, sum(coalesce((payload->>'firedUnits')::numeric,0)) as units_fired_today
  from events
  where aggregate_type='kiln_batch'
    and event_type in ('KILN_OUTPUT_RECORDED','KILN_BATCH_COMPLETED')
    and occurred_at::date = now()::date
  group by tenant_id
),
fuel_today as (
  select tenant_id, sum(coalesce((payload->>'amount')::numeric,0)) as fuel_amount_today
  from events
  where aggregate_type='kiln_batch'
    and event_type='KILN_FUEL_USAGE_RECORDED'
    and occurred_at::date = now()::date
  group by tenant_id
),
active as (
  select tenant_id, count(*) as active_batches
  from kiln_status_latest
  where status in ('active','paused')
  group by tenant_id
)
select coalesce(a.tenant_id, f.tenant_id, fu.tenant_id) as tenant_id,
       coalesce(active_batches,0) as active_batches,
       coalesce(units_fired_today,0) as units_fired_today,
       coalesce(fuel_amount_today,0) as fuel_amount_today
from active a
full outer join fired_today f using (tenant_id)
full outer join fuel_today fu using (tenant_id);

-- end 0007_kiln_domain.sql
