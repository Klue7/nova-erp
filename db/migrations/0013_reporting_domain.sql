-- begin 0013_reporting_domain.sql

-- ============= Daily throughput (events by day) =============
-- Mixing input (t), Crushing output (t), Extrusion output (units), Packed units, Dispatched units
create or replace view rpt_daily_throughput_v as
with mix as (
  select tenant_id, occurred_at::date as d,
         sum(coalesce((payload->>'quantityTonnes')::numeric,0)) as mix_input_tonnes
  from events
  where aggregate_type='mix_batch' and event_type='MIX_COMPONENT_ADDED'
  group by tenant_id, occurred_at::date
),
crush as (
  select tenant_id, occurred_at::date as d,
         sum(coalesce((payload->>'outputTonnes')::numeric,0)) as crush_output_tonnes
  from events
  where aggregate_type='crush_run' and event_type in ('CRUSH_RUN_OUTPUT_RECORDED','CRUSH_RUN_COMPLETED')
  group by tenant_id, occurred_at::date
),
extru as (
  select tenant_id, occurred_at::date as d,
         sum(coalesce((payload->>'outputUnits')::numeric,0)) as extrusion_output_units
  from events
  where aggregate_type='extrusion_run' and event_type in ('EXTRUSION_OUTPUT_RECORDED','EXTRUSION_RUN_COMPLETED')
  group by tenant_id, occurred_at::date
),
pack as (
  select tenant_id, occurred_at::date as d,
         sum(coalesce((payload->>'quantityUnits')::numeric,0)) as packed_units
  from events
  where aggregate_type='pallet' and event_type='PACK_INPUT_ADDED'
  group by tenant_id, occurred_at::date
),
disp as (
  select s.tenant_id, s.dispatched_at::date as d,
         coalesce(sum(p.picked_units),0) as units_dispatched
  from shipments s
  join shipments_status_latest sl on sl.tenant_id=s.tenant_id and sl.shipment_id=s.id and sl.status='dispatched'
  left join shipment_picks_v p on p.tenant_id=s.tenant_id and p.shipment_id=s.id
  group by s.tenant_id, s.dispatched_at::date
)
select
  coalesce(mix.tenant_id, crush.tenant_id, extru.tenant_id, pack.tenant_id, disp.tenant_id) as tenant_id,
  coalesce(mix.d, crush.d, extru.d, pack.d, disp.d) as d,
  coalesce(mix_input_tonnes,0)   as mix_input_tonnes,
  coalesce(crush_output_tonnes,0) as crush_output_tonnes,
  coalesce(extrusion_output_units,0) as extrusion_output_units,
  coalesce(packed_units,0)       as packed_units,
  coalesce(units_dispatched,0)   as units_dispatched
from mix
full outer join crush using (tenant_id, d)
full outer join extru using (tenant_id, d)
full outer join pack using (tenant_id, d)
full outer join disp using (tenant_id, d);

-- ============= WIP summary by stage =============
create or replace view rpt_wip_summary_v as
select 'mixing'    as stage, tenant_id,
       sum((status='planned')::int) planned, sum((status='active')::int) active
from mix_status_latest group by tenant_id
union all
select 'crushing'  as stage, tenant_id,
       sum((status='planned')::int), sum((status='active')::int)
from crush_status_latest group by tenant_id
union all
select 'extrusion' as stage, tenant_id,
       sum((status in ('planned','paused'))::int), sum((status='active')::int)
from extrusion_status_latest group by tenant_id
union all
select 'dry'       as stage, tenant_id,
       sum((status='planned')::int), sum((status='active')::int)
from dry_status_latest group by tenant_id
union all
select 'kiln'      as stage, tenant_id,
       sum((status in ('planned','paused'))::int), sum((status='active')::int)
from kiln_status_latest group by tenant_id
union all
select 'packing_open_pallets' as stage, tenant_id,
       0 as planned, count(*) filter (where status='open') as active
from pallets group by tenant_id;

-- ============= Quality / Scrap & Yield =============
create or replace view rpt_quality_today_v as
with extru_scrap as (
  select tenant_id, sum(coalesce((payload->>'scrapUnits')::numeric,0)) as extrusion_scrap_today
  from events
  where aggregate_type='extrusion_run'
    and event_type='EXTRUSION_SCRAP_RECORDED'
    and occurred_at::date = now()::date
  group by tenant_id
),
dry_scrap as (
  select tenant_id, sum(coalesce((payload->>'scrapUnits')::numeric,0)) as dry_scrap_today
  from events
  where aggregate_type='dry_load'
    and event_type='DRY_SCRAP_RECORDED'
    and occurred_at::date = now()::date
  group by tenant_id
),
kiln_yield as (
  select tenant_id,
         avg(yield_pct) filter (where yield_pct is not null) as kiln_yield_pct_active_avg
  from kiln_batch_metrics_v
  group by tenant_id
)
select coalesce(e.tenant_id, d.tenant_id, k.tenant_id) as tenant_id,
       coalesce(extrusion_scrap_today,0) as extrusion_scrap_today,
       coalesce(dry_scrap_today,0)       as dry_scrap_today,
       kiln_yield_pct_active_avg
from extru_scrap e
full outer join dry_scrap d using (tenant_id)
full outer join kiln_yield k using (tenant_id);

-- ============= Order → Dispatch lead time (days) =============
-- Uses shipment_picks_by_order_v (from Finance migration).
create or replace view rpt_order_dispatch_leadtime_v as
with first_disp as (
  select
    sp.tenant_id,
    sp.order_id,
    min(s.dispatched_at) as first_dispatch_at
  from shipment_picks_by_order_v sp
  join shipments s on s.id=sp.shipment_id and s.tenant_id=sp.tenant_id
  join shipments_status_latest sl on sl.tenant_id=s.tenant_id and sl.shipment_id=s.id and sl.status='dispatched'
  group by sp.tenant_id, sp.order_id
)
select
  so.tenant_id,
  so.id as order_id,
  so.code as order_code,
  so.created_at::date as order_date,
  fd.first_dispatch_at::date as first_dispatch_date,
  case when fd.first_dispatch_at is not null
       then greatest((fd.first_dispatch_at::date - so.created_at::date),0)
       else null end as days_order_to_dispatch
from sales_orders so
left join first_disp fd
  on fd.tenant_id=so.tenant_id and fd.order_id=so.id;

-- ============= Executive rollup: last 30d trend & today's KPIs =============
create or replace view rpt_exec_today_v as
with tenant_union as (
  select coalesce(dk.tenant_id, pk.tenant_id, sk.tenant_id, fk.tenant_id, sa.tenant_id) as tenant_id
  from dispatch_kpi_today dk
  full outer join packing_kpi_today pk using (tenant_id)
  full outer join extrusion_kpi_today sk using (tenant_id)
  full outer join finance_kpi_today fk using (tenant_id)
  full outer join sales_kpi_today sa using (tenant_id)
)
select
  tu.tenant_id,
  (select sum(units_dispatched)
     from rpt_daily_throughput_v t
    where t.tenant_id = tu.tenant_id
      and t.d = now()::date) as units_dispatched_today,
  (select sum(packed_units)
     from rpt_daily_throughput_v t
    where t.tenant_id = tu.tenant_id
      and t.d = now()::date) as units_packed_today,
  (select open_orders from sales_kpi_today where tenant_id = tu.tenant_id) as open_orders,
  (select units_reserved from sales_kpi_today where tenant_id = tu.tenant_id) as units_reserved,
  (select invoices_issued_today from finance_kpi_today where tenant_id = tu.tenant_id) as invoices_issued_today,
  (select payments_received_today from finance_kpi_today where tenant_id = tu.tenant_id) as payments_received_today,
  (select open_ar_total from finance_kpi_today where tenant_id = tu.tenant_id) as open_ar_total
from tenant_union tu;

-- end 0013_reporting_domain.sql
