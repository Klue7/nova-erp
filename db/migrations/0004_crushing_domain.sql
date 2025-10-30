-- begin 0004_crushing_domain.sql

-- Master table for crushing runs (metadata)
create table if not exists crush_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  code text not null,
  status text not null default 'planned',   -- planned | active | completed | cancelled
  target_tph numeric,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz default now(),
  unique (tenant_id, code)
);
alter table crush_runs enable row level security;

create policy "tenant_select_crush_runs"
  on crush_runs for select
  using (tenant_id = (select tenant_id from profiles where id = auth.uid()));

create policy "tenant_insert_crush_runs"
  on crush_runs for insert
  with check (tenant_id = (select tenant_id from profiles where id = auth.uid()));

create policy "tenant_update_crush_runs"
  on crush_runs for update
  using (tenant_id = (select tenant_id from profiles where id = auth.uid()))
  with check (tenant_id = (select tenant_id from profiles where id = auth.uid()));

-- Convenience subset of events
create or replace view crushing_events as
  select e.*
  from events e
  where e.aggregate_type = 'crush_run';

-- Inputs (from CRUSH_COMPONENT_ADDED)
create or replace view crush_inputs_v as
select
  e.tenant_id,
  (e.payload->>'runId')::uuid as run_id,
  sum(coalesce((e.payload->>'quantityTonnes')::numeric,0)) as input_tonnes,
  max(e.occurred_at) as last_input_at
from events e
where e.aggregate_type='crush_run'
  and e.event_type='CRUSH_COMPONENT_ADDED'
group by e.tenant_id, (e.payload->>'runId')::uuid;

-- Outputs (from OUTPUT_RECORDED or COMPLETED)
create or replace view crush_outputs_v as
select
  e.tenant_id,
  (e.payload->>'runId')::uuid as run_id,
  sum(coalesce((e.payload->>'outputTonnes')::numeric,0)) as output_tonnes,
  avg((e.payload->>'finesPct')::numeric) as avg_fines_pct,
  max(e.occurred_at) as last_output_at
from events e
where e.aggregate_type='crush_run'
  and e.event_type in ('CRUSH_RUN_OUTPUT_RECORDED','CRUSH_RUN_COMPLETED')
group by e.tenant_id, (e.payload->>'runId')::uuid;

-- Downtime (minutes)
create or replace view crush_downtime_v as
select
  e.tenant_id,
  (e.payload->>'runId')::uuid as run_id,
  sum(coalesce((e.payload->>'minutes')::numeric,0)) as downtime_minutes
from events e
where e.aggregate_type='crush_run'
  and e.event_type='CRUSH_RUN_DOWNTIME_LOGGED'
group by e.tenant_id, (e.payload->>'runId')::uuid;

-- Latest run status
create or replace view crush_status_latest as
with states as (
  select
    e.tenant_id,
    (e.payload->>'runId')::uuid as run_id,
    e.event_type,
    e.occurred_at,
    row_number() over (partition by e.tenant_id, (e.payload->>'runId')::uuid order by e.occurred_at desc) rn
  from events e
  where e.aggregate_type='crush_run'
    and e.event_type in ('CRUSH_RUN_CREATED','CRUSH_RUN_STARTED','CRUSH_RUN_COMPLETED','CRUSH_RUN_CANCELLED')
)
select tenant_id, run_id,
  case event_type
    when 'CRUSH_RUN_COMPLETED' then 'completed'
    when 'CRUSH_RUN_CANCELLED' then 'cancelled'
    when 'CRUSH_RUN_STARTED'   then 'active'
    else 'planned' end as status,
  occurred_at as status_changed_at
from states
where rn = 1;

-- Link Mixing → Crushing: available completed mix tonnage
create or replace view mix_completed_output_v as
select
  e.tenant_id,
  (e.payload->>'batchId')::uuid as batch_id,
  coalesce((e.payload->>'outputTonnes')::numeric,0) as output_tonnes,
  e.occurred_at
from events e
where e.aggregate_type='mix_batch'
  and e.event_type='MIX_BATCH_COMPLETED';

create or replace view crush_consumption_from_mix_v as
select
  e.tenant_id,
  (e.payload->>'mixBatchId')::uuid as batch_id,
  sum(coalesce((e.payload->>'quantityTonnes')::numeric,0)) as consumed_tonnes
from events e
where e.aggregate_type='crush_run'
  and e.event_type='CRUSH_COMPONENT_ADDED'
  and (e.payload ? 'mixBatchId')
group by e.tenant_id, (e.payload->>'mixBatchId')::uuid;

create or replace view mix_available_for_crushing_v as
select
  m.tenant_id,
  m.batch_id,
  (m.output_tonnes - coalesce(c.consumed_tonnes,0)) as available_tonnes
from mix_completed_output_v m
left join crush_consumption_from_mix_v c
  on c.tenant_id = m.tenant_id and c.batch_id = m.batch_id;

-- Run metrics and KPIs
create or replace view crush_run_metrics_v as
select
  r.tenant_id,
  r.id as run_id,
  r.code,
  r.started_at,
  r.completed_at,
  coalesce(i.input_tonnes,0) as input_tonnes,
  coalesce(o.output_tonnes,0) as output_tonnes,
  coalesce(d.downtime_minutes,0) as downtime_minutes,
  greatest(extract(epoch from (coalesce(r.completed_at, now()) - r.started_at))/3600.0, 0.01) as run_time_hours_gross,
  greatest(extract(epoch from (coalesce(r.completed_at, now()) - r.started_at))/3600.0 - (coalesce(d.downtime_minutes,0)/60.0), 0.01) as run_time_hours_net,
  (coalesce(o.output_tonnes,0) / greatest(extract(epoch from (coalesce(r.completed_at, now()) - r.started_at))/3600.0, 0.01)) as tph_raw,
  (coalesce(o.output_tonnes,0) / greatest(extract(epoch from (coalesce(r.completed_at, now()) - r.started_at))/3600.0 - (coalesce(d.downtime_minutes,0)/60.0), 0.01)) as tph_net
from crush_runs r
left join crush_inputs_v   i on i.tenant_id=r.tenant_id and i.run_id=r.id
left join crush_outputs_v  o on o.tenant_id=r.tenant_id and o.run_id=r.id
left join crush_downtime_v d on d.tenant_id=r.tenant_id and d.run_id=r.id;

create or replace view crush_kpi_today as
with outputs_today as (
  select tenant_id, sum(coalesce((payload->>'outputTonnes')::numeric,0)) as output_today
  from events
  where aggregate_type='crush_run'
    and event_type in ('CRUSH_RUN_OUTPUT_RECORDED','CRUSH_RUN_COMPLETED')
    and occurred_at::date = now()::date
  group by tenant_id
),
downtime_today as (
  select tenant_id, sum(coalesce((payload->>'minutes')::numeric,0)) as downtime_today_minutes
  from events
  where aggregate_type='crush_run'
    and event_type='CRUSH_RUN_DOWNTIME_LOGGED'
    and occurred_at::date = now()::date
  group by tenant_id
),
active as (
  select tenant_id, count(*) as active_runs
  from crush_status_latest
  where status='active'
  group by tenant_id
)
select coalesce(a.tenant_id, o.tenant_id, d.tenant_id) as tenant_id,
       coalesce(active_runs,0) as active_runs,
       coalesce(output_today,0) as output_today,
       coalesce(downtime_today_minutes,0) as downtime_today_minutes
from active a
full outer join outputs_today o using (tenant_id)
full outer join downtime_today d using (tenant_id);

-- end 0004_crushing_domain.sql
