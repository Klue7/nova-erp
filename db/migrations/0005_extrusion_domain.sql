-- begin 0005_extrusion_domain.sql

-- Master table for extrusion runs (metadata)
create table if not exists extrusion_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  code text not null,
  status text not null default 'planned',  -- planned | active | paused | completed | cancelled
  press_line text,
  die_code text,
  product_sku text,
  target_units numeric,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz default now(),
  unique (tenant_id, code)
);
alter table extrusion_runs enable row level security;

create policy "tenant_select_extrusion_runs"
  on extrusion_runs for select
  using (tenant_id = (select tenant_id from profiles where id = auth.uid()));

create policy "tenant_insert_extrusion_runs"
  on extrusion_runs for insert
  with check (tenant_id = (select tenant_id from profiles where id = auth.uid()));

create policy "tenant_update_extrusion_runs"
  on extrusion_runs for update
  using (tenant_id = (select tenant_id from profiles where id = auth.uid()))
  with check (tenant_id = (select tenant_id from profiles where id = auth.uid()));

-- Event subset for convenience
create or replace view extrusion_events as
  select e.*
  from events e
  where e.aggregate_type = 'extrusion_run';

-- Inputs consumption (tonnes) from Crushing
create or replace view extrusion_inputs_v as
select
  e.tenant_id,
  (e.payload->>'runId')::uuid as run_id,
  sum(coalesce((e.payload->>'quantityTonnes')::numeric,0)) as input_tonnes,
  max(e.occurred_at) as last_input_at
from events e
where e.aggregate_type='extrusion_run'
  and e.event_type='EXTRUSION_INPUT_ADDED'
group by e.tenant_id, (e.payload->>'runId')::uuid;

-- Outputs (units) & scrap
create or replace view extrusion_outputs_v as
select
  e.tenant_id,
  (e.payload->>'runId')::uuid as run_id,
  sum(coalesce((e.payload->>'outputUnits')::numeric,0)) as output_units,
  max(e.occurred_at) as last_output_at
from events e
where e.aggregate_type='extrusion_run'
  and e.event_type in ('EXTRUSION_OUTPUT_RECORDED','EXTRUSION_RUN_COMPLETED')
group by e.tenant_id, (e.payload->>'runId')::uuid;

create or replace view extrusion_scrap_v as
select
  e.tenant_id,
  (e.payload->>'runId')::uuid as run_id,
  sum(coalesce((e.payload->>'scrapUnits')::numeric,0)) as scrap_units
from events e
where e.aggregate_type='extrusion_run'
  and e.event_type='EXTRUSION_SCRAP_RECORDED'
group by e.tenant_id, (e.payload->>'runId')::uuid;

-- Downtime minutes
create or replace view extrusion_downtime_v as
select
  e.tenant_id,
  (e.payload->>'runId')::uuid as run_id,
  sum(coalesce((e.payload->>'minutes')::numeric,0)) as downtime_minutes
from events e
where e.aggregate_type='extrusion_run'
  and e.event_type='EXTRUSION_RUN_PAUSED' and (e.payload ? 'minutes')
group by e.tenant_id, (e.payload->>'runId')::uuid;

-- Latest run status
create or replace view extrusion_status_latest as
with states as (
  select
    e.tenant_id,
    (e.payload->>'runId')::uuid as run_id,
    e.event_type,
    e.occurred_at,
    row_number() over (partition by e.tenant_id, (e.payload->>'runId')::uuid order by e.occurred_at desc) rn
  from events e
  where e.aggregate_type='extrusion_run'
    and e.event_type in ('EXTRUSION_RUN_CREATED','EXTRUSION_RUN_STARTED','EXTRUSION_RUN_PAUSED','EXTRUSION_RUN_RESUMED','EXTRUSION_RUN_COMPLETED','EXTRUSION_RUN_CANCELLED')
)
select tenant_id, run_id,
  case event_type
    when 'EXTRUSION_RUN_COMPLETED' then 'completed'
    when 'EXTRUSION_RUN_CANCELLED' then 'cancelled'
    when 'EXTRUSION_RUN_PAUSED'    then 'paused'
    when 'EXTRUSION_RUN_STARTED'   then 'active'
    else 'planned' end as status,
  occurred_at as status_changed_at
from states
where rn = 1;

-- Link Crushing → Extrusion: available crushed tonnage per crush run
-- (crush_outputs_v was created in the Crushing migration)
create or replace view crush_consumption_for_extrusion_v as
select
  e.tenant_id,
  (e.payload->>'crushRunId')::uuid as crush_run_id,
  sum(coalesce((e.payload->>'quantityTonnes')::numeric,0)) as consumed_tonnes
from events e
where e.aggregate_type='extrusion_run'
  and e.event_type='EXTRUSION_INPUT_ADDED'
  and (e.payload ? 'crushRunId')
group by e.tenant_id, (e.payload->>'crushRunId')::uuid;

create or replace view crush_available_for_extrusion_v as
select
  o.tenant_id,
  o.run_id as crush_run_id,
  (o.output_tonnes - coalesce(c.consumed_tonnes,0)) as available_tonnes
from crush_outputs_v o
left join crush_consumption_for_extrusion_v c
  on c.tenant_id=o.tenant_id and c.crush_run_id=o.run_id;

-- Per-run metrics & KPIs
create or replace view extrusion_run_metrics_v as
select
  r.tenant_id,
  r.id as run_id,
  r.code,
  r.press_line,
  r.die_code,
  r.product_sku,
  coalesce(o.output_units,0) as output_units,
  coalesce(s.scrap_units,0)  as scrap_units,
  coalesce(i.input_tonnes,0) as input_tonnes,
  coalesce(d.downtime_minutes,0) as downtime_minutes,
  r.started_at,
  r.completed_at,
  greatest(extract(epoch from (coalesce(r.completed_at, now()) - r.started_at))/3600.0, 0.01) as run_time_hours_gross,
  greatest(extract(epoch from (coalesce(r.completed_at, now()) - r.started_at))/3600.0 - (coalesce(d.downtime_minutes,0)/60.0), 0.01) as run_time_hours_net,
  (coalesce(o.output_units,0) / greatest(extract(epoch from (coalesce(r.completed_at, now()) - r.started_at))/3600.0 - (coalesce(d.downtime_minutes,0)/60.0), 0.01)) as uph_net
from extrusion_runs r
left join extrusion_outputs_v o on o.tenant_id=r.tenant_id and o.run_id=r.id
left join extrusion_scrap_v   s on s.tenant_id=r.tenant_id and s.run_id=r.id
left join extrusion_inputs_v  i on i.tenant_id=r.tenant_id and i.run_id=r.id
left join extrusion_downtime_v d on d.tenant_id=r.tenant_id and d.run_id=r.id;

create or replace view extrusion_kpi_today as
with out_today as (
  select tenant_id, sum(coalesce((payload->>'outputUnits')::numeric,0)) as units_today
  from events
  where aggregate_type='extrusion_run'
    and event_type in ('EXTRUSION_OUTPUT_RECORDED','EXTRUSION_RUN_COMPLETED')
    and occurred_at::date = now()::date
  group by tenant_id
),
scrap_today as (
  select tenant_id, sum(coalesce((payload->>'scrapUnits')::numeric,0)) as scrap_today
  from events
  where aggregate_type='extrusion_run'
    and event_type='EXTRUSION_SCRAP_RECORDED'
    and occurred_at::date = now()::date
  group by tenant_id
),
active as (
  select tenant_id, count(*) as active_runs
  from extrusion_status_latest
  where status in ('active','paused')
  group by tenant_id
)
select coalesce(a.tenant_id, o.tenant_id, s.tenant_id) as tenant_id,
       coalesce(active_runs,0) as active_runs,
       coalesce(units_today,0) as units_today,
       coalesce(scrap_today,0) as scrap_today
from active a
full outer join out_today o using (tenant_id)
full outer join scrap_today s using (tenant_id);

-- end 0005_extrusion_domain.sql
