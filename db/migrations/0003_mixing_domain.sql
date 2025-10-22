-- begin 0003_mixing_domain.sql

-- master table for batches (metadata only)
create table if not exists mix_batches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  code text not null,
  status text not null default 'planned',  -- planned | active | completed | cancelled
  target_output_tonnes numeric,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz default now(),
  unique (tenant_id, code)
);
alter table mix_batches enable row level security;

create policy "tenant_select_mix_batches"
  on mix_batches for select
  using (tenant_id = (select tenant_id from profiles where id = auth.uid()));

create policy "tenant_insert_mix_batches"
  on mix_batches for insert
  with check (tenant_id = (select tenant_id from profiles where id = auth.uid()));

create policy "tenant_update_mix_batches"
  on mix_batches for update
  using (tenant_id = (select tenant_id from profiles where id = auth.uid()))
  with check (tenant_id = (select tenant_id from profiles where id = auth.uid()));

-- convenience view over events for this aggregate
create or replace view mixing_events as
  select e.*
  from events e
  where e.aggregate_type = 'mix_batch';

-- component movements derived from events
create or replace view mix_components_v as
with base as (
  select
    e.tenant_id,
    (e.payload->>'batchId')::uuid       as batch_id,
    (e.payload->>'stockpileId')::uuid   as stockpile_id,
    e.event_type,
    (e.payload->>'quantityTonnes')::numeric as qty,
    (e.payload->>'materialType')::text  as material_type,
    (e.payload->>'stockpileCode')::text as stockpile_code,
    e.occurred_at,
    e.payload
  from events e
  where e.aggregate_type = 'mix_batch'
    and e.event_type in ('MIX_COMPONENT_ADDED','MIX_COMPONENT_REMOVED')
)
select
  tenant_id, batch_id, stockpile_id, material_type, stockpile_code, occurred_at,
  case when event_type = 'MIX_COMPONENT_ADDED' then coalesce(qty,0)
       when event_type = 'MIX_COMPONENT_REMOVED' then -coalesce(qty,0)
       else 0 end as signed_qty,
  qty as raw_qty,
  event_type
from base;

-- per-batch input totals
create or replace view mix_inputs_v as
select
  tenant_id,
  batch_id,
  sum(signed_qty) as total_input_tonnes,
  max(occurred_at) as last_input_at
from mix_components_v
group by tenant_id, batch_id;

-- latest batch status based on events
create or replace view mix_status_latest as
with states as (
  select
    e.tenant_id,
    (e.payload->>'batchId')::uuid as batch_id,
    e.event_type,
    e.occurred_at,
    row_number() over (partition by e.tenant_id, (e.payload->>'batchId')::uuid order by e.occurred_at desc) as rn
  from events e
  where e.aggregate_type='mix_batch'
    and e.event_type in ('MIX_BATCH_CREATED','MIX_BATCH_STARTED','MIX_BATCH_COMPLETED','MIX_BATCH_CANCELLED')
)
select tenant_id, batch_id,
  case event_type
    when 'MIX_BATCH_COMPLETED' then 'completed'
    when 'MIX_BATCH_CANCELLED' then 'cancelled'
    when 'MIX_BATCH_STARTED'   then 'active'
    else 'planned' end as status,
  occurred_at as status_changed_at
from states
where rn = 1;

-- simple KPI helpers
create or replace view mix_kpi_today as
with today_inputs as (
  select tenant_id, sum(signed_qty) as input_today
  from mix_components_v
  where occurred_at::date = now()::date
  group by tenant_id
),
active as (
  select s.tenant_id, count(*) as active_batches
  from mix_status_latest s
  join mix_batches b on b.id = s.batch_id and b.tenant_id = s.tenant_id
  where s.status = 'active'
  group by tenant_id
)
select
  coalesce(a.tenant_id, t.tenant_id) as tenant_id,
  coalesce(active_batches, 0) as active_batches,
  coalesce(input_today, 0)    as input_today
from active a
full outer join today_inputs t using (tenant_id);

-- end 0003_mixing_domain.sql
