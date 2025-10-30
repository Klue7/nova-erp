-- begin 0006_dry_yard_domain.sql

-- Racks master
create table if not exists dry_racks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  code text not null,
  bay text,
  capacity_units numeric not null,
  status text not null default 'active',
  created_at timestamptz default now(),
  unique (tenant_id, code)
);
alter table dry_racks enable row level security;

create policy "tenant_select_dry_racks"
  on dry_racks for select
  using (tenant_id = (select tenant_id from profiles where id = auth.uid()));

create policy "tenant_insert_dry_racks"
  on dry_racks for insert
  with check (tenant_id = (select tenant_id from profiles where id = auth.uid()));

create policy "tenant_update_dry_racks"
  on dry_racks for update
  using (tenant_id = (select tenant_id from profiles where id = auth.uid()))
  with check (tenant_id = (select tenant_id from profiles where id = auth.uid()));

-- Loads master (metadata only)
create table if not exists dry_loads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  code text not null,
  rack_id uuid references dry_racks(id) on delete set null,
  status text not null default 'planned', -- planned | active | completed | cancelled
  target_moisture_pct numeric,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz default now(),
  unique (tenant_id, code)
);
alter table dry_loads enable row level security;

create policy "tenant_select_dry_loads"
  on dry_loads for select
  using (tenant_id = (select tenant_id from profiles where id = auth.uid()));

create policy "tenant_insert_dry_loads"
  on dry_loads for insert
  with check (tenant_id = (select tenant_id from profiles where id = auth.uid()));

create policy "tenant_update_dry_loads"
  on dry_loads for update
  using (tenant_id = (select tenant_id from profiles where id = auth.uid()))
  with check (tenant_id = (select tenant_id from profiles where id = auth.uid()));

-- Convenience event subset
create or replace view dry_events as
  select e.*
  from events e
  where e.aggregate_type = 'dry_load';

-- Units assigned to loads (from DRY_INPUT_ADDED)
create or replace view dry_inputs_v as
select
  e.tenant_id,
  (e.payload->>'runId')::uuid   as extrusion_run_id,
  (e.payload->>'loadId')::uuid  as load_id,
  sum(coalesce((e.payload->>'quantityUnits')::numeric,0)) as input_units,
  max(e.occurred_at) as last_input_at
from events e
where e.aggregate_type='dry_load'
  and e.event_type='DRY_INPUT_ADDED'
group by e.tenant_id, (e.payload->>'runId')::uuid, (e.payload->>'loadId')::uuid;

-- Moisture readings
create or replace view dry_moisture_v as
select
  e.tenant_id,
  (e.payload->>'loadId')::uuid as load_id,
  (e.payload->>'moisturePct')::numeric as moisture_pct,
  e.occurred_at,
  row_number() over (partition by e.tenant_id, (e.payload->>'loadId')::uuid order by e.occurred_at desc) as rn
from events e
where e.aggregate_type='dry_load'
  and e.event_type='DRY_MOISTURE_RECORDED';

create or replace view dry_moisture_latest as
select tenant_id, load_id, moisture_pct, occurred_at
from dry_moisture_v
where rn = 1;

-- Scrap (optional)
create or replace view dry_scrap_v as
select
  e.tenant_id,
  (e.payload->>'loadId')::uuid as load_id,
  sum(coalesce((e.payload->>'scrapUnits')::numeric,0)) as scrap_units
from events e
where e.aggregate_type='dry_load'
  and e.event_type='DRY_SCRAP_RECORDED'
group by e.tenant_id, (e.payload->>'loadId')::uuid;

-- Latest load status from events
create or replace view dry_status_latest as
with states as (
  select
    e.tenant_id,
    (e.payload->>'loadId')::uuid as load_id,
    e.event_type,
    e.occurred_at,
    row_number() over (partition by e.tenant_id, (e.payload->>'loadId')::uuid order by e.occurred_at desc) rn
  from events e
  where e.aggregate_type='dry_load'
    and e.event_type in ('DRY_LOAD_CREATED','DRY_LOAD_STARTED','DRY_LOAD_COMPLETED','DRY_LOAD_CANCELLED')
)
select tenant_id, load_id,
  case event_type
    when 'DRY_LOAD_COMPLETED' then 'completed'
    when 'DRY_LOAD_CANCELLED' then 'cancelled'
    when 'DRY_LOAD_STARTED'   then 'active'
    else 'planned' end as status,
  occurred_at as status_changed_at
from states
where rn = 1;

-- Rack occupancy across planned/active loads
create or replace view dry_rack_occupancy_v as
select
  l.tenant_id,
  l.rack_id,
  sum(coalesce(i.input_units,0)) as occupied_units
from dry_loads l
left join dry_inputs_v i
  on i.tenant_id=l.tenant_id and i.load_id=l.id
join dry_racks r
  on r.id = l.rack_id
where l.status in ('planned','active')
group by l.tenant_id, l.rack_id;

-- Link Extrusion → Dry Yard: available green units by extrusion run
-- (extrusion_outputs_v exists from the Extrusion migration)
create or replace view extrusion_consumption_for_drying_v as
select
  e.tenant_id,
  (e.payload->>'runId')::uuid as extrusion_run_id,
  sum(coalesce((e.payload->>'quantityUnits')::numeric,0)) as consumed_units
from events e
where e.aggregate_type='dry_load'
  and e.event_type='DRY_INPUT_ADDED'
group by e.tenant_id, (e.payload->>'runId')::uuid;

create or replace view extrusion_available_for_drying_v as
select
  o.tenant_id,
  o.run_id as extrusion_run_id,
  (o.output_units - coalesce(c.consumed_units,0)) as available_units
from extrusion_outputs_v o
left join extrusion_consumption_for_drying_v c
  on c.tenant_id=o.tenant_id and c.extrusion_run_id=o.run_id;

-- Metrics & KPIs for loads
create or replace view dry_load_metrics_v as
select
  dl.tenant_id,
  dl.id as load_id,
  dl.code,
  dl.rack_id,
  dl.status,
  dl.started_at,
  dl.completed_at,
  coalesce(di.input_units,0) as input_units,
  coalesce(ds.scrap_units,0) as scrap_units,
  coalesce(dm.moisture_pct, null) as latest_moisture_pct,
  greatest(extract(epoch from (coalesce(dl.completed_at, now()) - dl.started_at))/3600.0, 0) as dwell_hours
from dry_loads dl
left join dry_inputs_v        di on di.tenant_id=dl.tenant_id and di.load_id=dl.id
left join dry_scrap_v         ds on ds.tenant_id=dl.tenant_id and ds.load_id=dl.id
left join dry_moisture_latest dm on dm.tenant_id=dl.tenant_id and dm.load_id=dl.id;

create or replace view dry_kpi_today as
with loaded_today as (
  select tenant_id, sum(coalesce((payload->>'quantityUnits')::numeric,0)) as units_loaded_today
  from events
  where aggregate_type='dry_load'
    and event_type='DRY_INPUT_ADDED'
    and occurred_at::date = now()::date
  group by tenant_id
),
completed_today as (
  select dl.tenant_id, sum(coalesce(di.input_units,0)) as units_completed_today
  from dry_loads dl
  left join dry_inputs_v di on di.tenant_id=dl.tenant_id and di.load_id=dl.id
  where dl.completed_at::date = now()::date
  group by dl.tenant_id
),
active as (
  select tenant_id, count(*) as active_loads
  from dry_status_latest
  where status='active'
  group by tenant_id
),
moisture as (
  select ml.tenant_id, avg(moisture_pct) as avg_active_moisture
  from dry_moisture_latest ml
  join dry_status_latest sl on sl.tenant_id=ml.tenant_id and sl.load_id=ml.load_id
  where sl.status='active'
  group by ml.tenant_id
)
select coalesce(a.tenant_id, l.tenant_id, c.tenant_id, m.tenant_id) as tenant_id,
       coalesce(active_loads,0) as active_loads,
       coalesce(units_loaded_today,0) as units_loaded_today,
       coalesce(units_completed_today,0) as units_completed_today,
       m.avg_active_moisture
from active a
full outer join loaded_today l using (tenant_id)
full outer join completed_today c using (tenant_id)
full outer join moisture m using (tenant_id);

-- end 0006_dry_yard_domain.sql
