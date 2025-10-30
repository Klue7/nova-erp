-- begin 0009_dispatch_domain.sql

-- Shipments master (metadata)
create table if not exists shipments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  code text not null,
  status text not null default 'planned',  -- planned, picking, weigh_in, weigh_out, dispatched, cancelled
  customer_code text,
  customer_name text,
  delivery_address jsonb,
  carrier text,
  vehicle_reg text,
  trailer_reg text,
  seal_no text,
  created_at timestamptz default now(),
  dispatched_at timestamptz,
  unique (tenant_id, code)
);
alter table shipments enable row level security;

create policy "tenant_select_shipments"
  on shipments for select
  using (tenant_id = (select tenant_id from profiles where id = auth.uid()));

create policy "tenant_insert_shipments"
  on shipments for insert
  with check (tenant_id = (select tenant_id from profiles where id = auth.uid()));

create policy "tenant_update_shipments"
  on shipments for update
  using (tenant_id = (select tenant_id from profiles where id = auth.uid()))
  with check (tenant_id = (select tenant_id from profiles where id = auth.uid()));

-- Convenience subset of events
create or replace view dispatch_events as
  select e.*
  from events e
  where e.aggregate_type = 'shipment';

-- Picklist (net picks per shipment/pallet)
create or replace view shipment_picks_v as
with base as (
  select
    e.tenant_id,
    (e.payload->>'shipmentId')::uuid as shipment_id,
    (e.payload->>'palletId')::uuid as pallet_id,
    case when e.event_type='SHIPMENT_PICK_ADDED' then coalesce((e.payload->>'quantityUnits')::numeric,0)
         when e.event_type='SHIPMENT_PICK_REMOVED' then -coalesce((e.payload->>'quantityUnits')::numeric,0)
         else 0 end as signed_qty,
    e.occurred_at
  from events e
  where e.aggregate_type='shipment'
    and e.event_type in ('SHIPMENT_PICK_ADDED','SHIPMENT_PICK_REMOVED')
)
select
  tenant_id, shipment_id, pallet_id,
  sum(signed_qty) as picked_units,
  max(occurred_at) as last_pick_at
from base
group by tenant_id, shipment_id, pallet_id;

-- Latest shipment status from events
create or replace view shipments_status_latest as
with states as (
  select
    e.tenant_id,
    (e.payload->>'shipmentId')::uuid as shipment_id,
    e.event_type,
    e.occurred_at,
    row_number() over (partition by e.tenant_id, (e.payload->>'shipmentId')::uuid order by e.occurred_at desc) rn
  from events e
  where e.aggregate_type='shipment'
    and e.event_type in ('SHIPMENT_CREATED','SHIPMENT_PICKLIST_CREATED','SHIPMENT_WEIGHBRIDGE_IN','SHIPMENT_WEIGHBRIDGE_OUT','SHIPMENT_DISPATCHED','SHIPMENT_CANCELLED')
)
select tenant_id, shipment_id,
  case event_type
    when 'SHIPMENT_DISPATCHED'     then 'dispatched'
    when 'SHIPMENT_CANCELLED'      then 'cancelled'
    when 'SHIPMENT_WEIGHBRIDGE_OUT' then 'weigh_out'
    when 'SHIPMENT_WEIGHBRIDGE_IN'  then 'weigh_in'
    when 'SHIPMENT_PICKLIST_CREATED' then 'picking'
    else 'planned' end as status,
  occurred_at as status_changed_at
from states
where rn = 1;

-- Weighbridge latest in/out and net kg
create or replace view shipment_weighbridge_latest as
with wb_in as (
  select
    e.tenant_id,
    (e.payload->>'shipmentId')::uuid as shipment_id,
    (e.payload->>'grossKg')::numeric as in_gross_kg,
    coalesce((e.payload->>'tareKg')::numeric,null) as in_tare_kg,
    e.occurred_at,
    row_number() over (partition by e.tenant_id, (e.payload->>'shipmentId')::uuid order by e.occurred_at desc) rn
  from events e
  where e.aggregate_type='shipment' and e.event_type='SHIPMENT_WEIGHBRIDGE_IN'
),
wb_out as (
  select
    e.tenant_id,
    (e.payload->>'shipmentId')::uuid as shipment_id,
    (e.payload->>'grossKg')::numeric as out_gross_kg,
    coalesce((e.payload->>'tareKg')::numeric,null) as out_tare_kg,
    e.occurred_at,
    row_number() over (partition by e.tenant_id, (e.payload->>'shipmentId')::uuid order by e.occurred_at desc) rn
  from events e
  where e.aggregate_type='shipment' and e.event_type='SHIPMENT_WEIGHBRIDGE_OUT'
)
select
  coalesce(i.tenant_id, o.tenant_id) as tenant_id,
  coalesce(i.shipment_id, o.shipment_id) as shipment_id,
  i.in_gross_kg,
  i.in_tare_kg,
  o.out_gross_kg,
  o.out_tare_kg,
  case
    when o.out_gross_kg is not null and i.in_gross_kg is not null
      then greatest(o.out_gross_kg - i.in_gross_kg, 0)
    else null end as net_kg_estimate
from wb_in i
full outer join wb_out o
  on o.tenant_id=i.tenant_id and o.shipment_id=i.shipment_id
where coalesce(i.rn,1)=1 and coalesce(o.rn,1)=1;

-- Pallet units shipped (for shipments with status 'dispatched')
create or replace view pallet_shipped_v as
select p.tenant_id, p.pallet_id,
       sum(p.picked_units) as shipped_units
from shipment_picks_v p
join shipments_status_latest s
  on s.tenant_id=p.tenant_id and s.shipment_id=p.shipment_id
where s.status = 'dispatched'
group by p.tenant_id, p.pallet_id;

-- Live pallet inventory including shipped deduction
-- (pallet_inventory_v defined in Packing migration)
create or replace view pallet_inventory_live_v as
select
  base.tenant_id,
  base.pallet_id,
  base.code,
  base.product_sku,
  base.grade,
  base.status,
  base.location_id,
  base.input_units,
  base.scrap_units,
  base.reserved_units,
  coalesce(sh.shipped_units,0) as shipped_units,
  greatest((base.input_units - base.scrap_units - coalesce(sh.shipped_units,0)), 0) as units_on_pallet,
  greatest((base.input_units - base.scrap_units - coalesce(sh.shipped_units,0) - base.reserved_units), 0) as units_available
from pallet_inventory_v base
left join pallet_shipped_v sh
  on sh.tenant_id=base.tenant_id and sh.pallet_id=base.pallet_id;

-- Shipment summaries
create or replace view shipment_summary_v as
select
  s.tenant_id, s.id as shipment_id, s.code, s.status,
  s.customer_code, s.customer_name, s.carrier, s.vehicle_reg, s.trailer_reg, s.seal_no,
  coalesce(sum(sp.picked_units),0) as total_units_picked,
  wl.net_kg_estimate,
  s.created_at, s.dispatched_at
from shipments s
left join shipment_picks_v sp on sp.tenant_id=s.tenant_id and sp.shipment_id=s.id
left join shipment_weighbridge_latest wl on wl.tenant_id=s.tenant_id and wl.shipment_id=s.id
group by s.tenant_id, s.id, wl.net_kg_estimate;

-- KPIs for Dispatch
create or replace view dispatch_kpi_today as
with dispatched as (
  select tenant_id, count(*) as shipments_dispatched_today
  from shipments
  where dispatched_at::date = now()::date
  group by tenant_id
),
units_dispatched as (
  select s.tenant_id, sum(sp.picked_units) as units_dispatched_today
  from shipments s
  join shipments_status_latest sl on sl.tenant_id=s.tenant_id and sl.shipment_id=s.id and sl.status='dispatched'
  left join shipment_picks_v sp on sp.tenant_id=s.tenant_id and sp.shipment_id=s.id
  where s.dispatched_at::date = now()::date
  group by s.tenant_id
),
net_kg_today as (
  select s.tenant_id, sum(coalesce(wl.net_kg_estimate,0)) as net_kg_dispatched_today
  from shipments s
  join shipments_status_latest sl on sl.tenant_id=s.tenant_id and sl.shipment_id=s.id and sl.status='dispatched'
  left join shipment_weighbridge_latest wl on wl.tenant_id=s.tenant_id and wl.shipment_id=s.id
  where s.dispatched_at::date = now()::date
  group by s.tenant_id
),
open_shipments as (
  select s.tenant_id, count(*) as open_shipments
  from shipments s
  join shipments_status_latest sl on sl.tenant_id=s.tenant_id and sl.shipment_id=s.id
  where sl.status in ('planned','picking','weigh_in','weigh_out')
  group by s.tenant_id
)
select
  coalesce(d.tenant_id, u.tenant_id, k.tenant_id, o.tenant_id) as tenant_id,
  coalesce(shipments_dispatched_today,0) as shipments_dispatched_today,
  coalesce(units_dispatched_today,0)    as units_dispatched_today,
  coalesce(net_kg_dispatched_today,0)   as net_kg_dispatched_today,
  coalesce(open_shipments,0)            as open_shipments
from dispatched d
full outer join units_dispatched u using (tenant_id)
full outer join net_kg_today k using (tenant_id)
full outer join open_shipments o using (tenant_id);

-- end 0009_dispatch_domain.sql
