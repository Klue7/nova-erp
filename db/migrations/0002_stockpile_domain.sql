-- begin 0002_stockpile_domain.sql
create table if not exists stockpiles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  code text not null,
  name text,
  location text,
  material_type text,
  status text not null default 'active',
  created_at timestamptz default now(),
  unique (tenant_id, code)
);
alter table stockpiles enable row level security;

create policy "tenant_select_stockpiles"
  on stockpiles for select
  using (tenant_id = (select tenant_id from profiles where id = auth.uid()));

create policy "tenant_manage_stockpiles"
  on stockpiles for insert
  with check (tenant_id = (select tenant_id from profiles where id = auth.uid()));

create policy "tenant_update_stockpiles"
  on stockpiles for update
  using (tenant_id = (select tenant_id from profiles where id = auth.uid()))
  with check (tenant_id = (select tenant_id from profiles where id = auth.uid()));

-- views over events (events table exists from phase 2)
create or replace view stockpile_events as
  select e.*
  from events e
  where e.aggregate_type = 'stockpile';

create or replace view stockpile_movements as
with base as (
  select
    (e.payload->>'stockpileId')::uuid as stockpile_id,
    e.tenant_id,
    e.event_type,
    (e.payload->>'quantityTonnes')::numeric as qty,
    e.occurred_at,
    e.payload
  from events e
  where e.aggregate_type = 'stockpile'
    and (e.payload ? 'stockpileId')
)
select
  stockpile_id,
  tenant_id,
  occurred_at,
  event_type,
  case
    when event_type in ('STOCKPILE_RECEIPT_RECORDED','STOCKPILE_TRANSFERRED_IN','STOCKPILE_ADJUSTED_IN','STOCKPILE_RESERVATION_RELEASED') then coalesce(qty,0)
    when event_type in ('STOCKPILE_TRANSFERRED_OUT','STOCKPILE_ADJUSTED_OUT','STOCKPILE_RESERVED') then -coalesce(qty,0)
    else 0
  end as signed_qty,
  qty as raw_qty
from base;

create or replace view stockpile_balances_v as
select
  m.tenant_id,
  m.stockpile_id,
  sum(m.signed_qty) as available_tonnes,
  max(m.occurred_at) as last_movement_at
from stockpile_movements m
group by m.tenant_id, m.stockpile_id;

create or replace view stockpile_quality_v as
select
  (e.payload->>'stockpileId')::uuid as stockpile_id,
  e.tenant_id,
  (e.payload->>'moisturePct')::numeric as moisture_pct,
  e.occurred_at,
  row_number() over (partition by e.tenant_id, (e.payload->>'stockpileId')::uuid order by e.occurred_at desc) as rn
from events e
where e.aggregate_type='stockpile'
  and e.event_type in ('STOCKPILE_SAMPLE_TAKEN','STOCKPILE_QUALITY_RECORDED');

create or replace view stockpile_quality_latest as
select tenant_id, stockpile_id, moisture_pct, occurred_at
from stockpile_quality_v
where rn = 1;
-- end 0002_stockpile_domain.sql
