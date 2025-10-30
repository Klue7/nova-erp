-- begin 0008_packing_domain.sql

-- Locations (warehouse/staging)
create table if not exists pack_locations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  code text not null,
  type text,                                -- e.g., 'staging' | 'warehouse'
  capacity_pallets numeric,
  status text not null default 'active',
  created_at timestamptz default now(),
  unique (tenant_id, code)
);
alter table pack_locations enable row level security;

create policy "tenant_select_pack_locations"
  on pack_locations for select
  using (tenant_id = (select tenant_id from profiles where id = auth.uid()));

create policy "tenant_insert_pack_locations"
  on pack_locations for insert
  with check (tenant_id = (select tenant_id from profiles where id = auth.uid()));

create policy "tenant_update_pack_locations"
  on pack_locations for update
  using (tenant_id = (select tenant_id from profiles where id = auth.uid()))
  with check (tenant_id = (select tenant_id from profiles where id = auth.uid()));

-- Pallets master
create table if not exists pallets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  code text not null,
  product_sku text,
  grade text,                               -- A | B | C | SCRAP | etc.
  status text not null default 'open',      -- open | closed | scrapped | hold | cancelled
  capacity_units numeric,
  location_id uuid references pack_locations(id) on delete set null,
  created_at timestamptz default now(),
  closed_at timestamptz,
  unique (tenant_id, code)
);
alter table pallets enable row level security;

create policy "tenant_select_pallets"
  on pallets for select
  using (tenant_id = (select tenant_id from profiles where id = auth.uid()));

create policy "tenant_insert_pallets"
  on pallets for insert
  with check (tenant_id = (select tenant_id from profiles where id = auth.uid()));

create policy "tenant_update_pallets"
  on pallets for update
  using (tenant_id = (select tenant_id from profiles where id = auth.uid()))
  with check (tenant_id = (select tenant_id from profiles where id = auth.uid()));

-- Convenience subset of events for packing
create or replace view packing_events as
  select e.*
  from events e
  where e.aggregate_type = 'pallet';

-- Inputs assigned to pallets (from kiln)
create or replace view pallet_inputs_v as
select
  e.tenant_id,
  (e.payload->>'palletId')::uuid as pallet_id,
  sum(coalesce((e.payload->>'quantityUnits')::numeric,0)) as input_units,
  max(e.occurred_at) as last_input_at
from events e
where e.aggregate_type='pallet'
  and e.event_type='PACK_INPUT_ADDED'
group by e.tenant_id, (e.payload->>'palletId')::uuid;

-- Scrap recorded on pallets
create or replace view pallet_scrap_v as
select
  e.tenant_id,
  (e.payload->>'palletId')::uuid as pallet_id,
  sum(coalesce((e.payload->>'scrapUnits')::numeric,0)) as scrap_units
from events e
where e.aggregate_type='pallet'
  and e.event_type='PACK_SCRAP_RECORDED'
group by e.tenant_id, (e.payload->>'palletId')::uuid;

-- Reservations (quantity-based)
create or replace view pallet_reservations_v as
with res as (
  select
    e.tenant_id,
    (e.payload->>'palletId')::uuid as pallet_id,
    case when e.event_type='PACK_PALLET_RESERVED' then coalesce((e.payload->>'quantityUnits')::numeric,0)
         when e.event_type='PACK_PALLET_RESERVATION_RELEASED' then -coalesce((e.payload->>'quantityUnits')::numeric,0)
         else 0 end as signed_qty
  from events e
  where e.aggregate_type='pallet'
    and e.event_type in ('PACK_PALLET_RESERVED','PACK_PALLET_RESERVATION_RELEASED')
)
select tenant_id, pallet_id, sum(signed_qty) as reserved_units
from res
group by tenant_id, pallet_id;

-- Latest pallet status from events (optional overlay)
create or replace view pallet_status_latest as
with states as (
  select
    e.tenant_id,
    (e.payload->>'palletId')::uuid as pallet_id,
    e.event_type,
    e.occurred_at,
    row_number() over (partition by e.tenant_id, (e.payload->>'palletId')::uuid order by e.occurred_at desc) rn
  from events e
  where e.aggregate_type='pallet'
    and e.event_type in ('PACK_PALLET_CREATED','PACK_PALLET_CLOSED','PACK_PALLET_CANCELLED','PACK_SCRAP_RECORDED')
)
select tenant_id, pallet_id,
  case event_type
    when 'PACK_PALLET_CLOSED' then 'closed'
    when 'PACK_PALLET_CANCELLED' then 'cancelled'
    else 'open' end as status,
  occurred_at as status_changed_at
from states
where rn = 1;

-- Link Kiln → Packing: available fired units per kiln batch
-- (kiln_outputs_v exists from 0007)
create or replace view packing_consumption_from_kiln_v as
select
  e.tenant_id,
  (e.payload->>'kilnBatchId')::uuid as kiln_batch_id,
  sum(coalesce((e.payload->>'quantityUnits')::numeric,0)) as consumed_units
from events e
where e.aggregate_type='pallet'
  and e.event_type='PACK_INPUT_ADDED'
  and (e.payload ? 'kilnBatchId')
group by e.tenant_id, (e.payload->>'kilnBatchId')::uuid;

create or replace view kiln_available_for_packing_v as
select
  k.tenant_id,
  k.batch_id as kiln_batch_id,
  (k.fired_units - coalesce(p.consumed_units,0)) as available_units
from kiln_outputs_v k
left join packing_consumption_from_kiln_v p
  on p.tenant_id=k.tenant_id and p.kiln_batch_id=k.batch_id;

-- Pallet inventory summary
create or replace view pallet_inventory_v as
select
  p.tenant_id,
  p.id as pallet_id,
  p.code,
  p.product_sku,
  p.grade,
  p.status,
  p.location_id,
  coalesce(i.input_units,0) as input_units,
  coalesce(s.scrap_units,0) as scrap_units,
  coalesce(r.reserved_units,0) as reserved_units,
  (coalesce(i.input_units,0) - coalesce(s.scrap_units,0)) as units_on_pallet,
  (coalesce(i.input_units,0) - coalesce(s.scrap_units,0) - coalesce(r.reserved_units,0)) as units_available
from pallets p
left join pallet_inputs_v i on i.tenant_id=p.tenant_id and i.pallet_id=p.id
left join pallet_scrap_v  s on s.tenant_id=p.tenant_id and s.pallet_id=p.id
left join pallet_reservations_v r on r.tenant_id=p.tenant_id and r.pallet_id=p.id;

-- KPIs
create or replace view packing_kpi_today as
with pallets_built as (
  select tenant_id, count(*) as pallets_built_today
  from pallets
  where created_at::date = now()::date
  group by tenant_id
),
units_packed as (
  select tenant_id, sum(coalesce((payload->>'quantityUnits')::numeric,0)) as units_packed_today
  from events
  where aggregate_type='pallet'
    and event_type='PACK_INPUT_ADDED'
    and occurred_at::date = now()::date
  group by tenant_id
),
scrap_today as (
  select tenant_id, sum(coalesce((payload->>'scrapUnits')::numeric,0)) as scrap_units_today
  from events
  where aggregate_type='pallet'
    and event_type='PACK_SCRAP_RECORDED'
    and occurred_at::date = now()::date
  group by tenant_id
),
open_inventory as (
  select tenant_id, sum(units_available) as open_units_available
  from pallet_inventory_v
  where status = 'open'
  group by tenant_id
)
select coalesce(pb.tenant_id, up.tenant_id, st.tenant_id, oi.tenant_id) as tenant_id,
       coalesce(pallets_built_today,0)  as pallets_built_today,
       coalesce(units_packed_today,0)   as units_packed_today,
       coalesce(scrap_units_today,0)    as scrap_units_today,
       coalesce(open_units_available,0) as open_units_available
from pallets_built pb
full outer join units_packed up using (tenant_id)
full outer join scrap_today st using (tenant_id)
full outer join open_inventory oi using (tenant_id);

-- end 0008_packing_domain.sql
