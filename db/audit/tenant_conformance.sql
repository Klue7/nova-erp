-- ===== SET TENANT =====
with tenant as (
  select id as tenant_id from tenants where code = 'nova-demo'
), 

-- ===== Event hygiene =====
event_hygiene as (
  select
    count(*) filter (where tenant_id is null) as missing_tenant,
    count(*) filter (where aggregate_type is null) as missing_agg,
    count(*) filter (where occurred_at is null) as missing_time
  from events e join tenant t on e.tenant_id = t.tenant_id
),

-- ===== Negative availability across stages =====
negatives as (
  select 'stockpile' as stage, count(*) as cnt
    from stockpile_balances_v v join tenant t on v.tenant_id=t.tenant_id
    where available_tonnes < 0
  union all
  select 'mix→crush', count(*) from mix_available_for_crushing_v v join tenant t on v.tenant_id=t.tenant_id
    where available_tonnes < 0
  union all
  select 'crush→extrusion', count(*) from crush_available_for_extrusion_v v join tenant t on v.tenant_id=t.tenant_id
    where available_tonnes < 0
  union all
  select 'extrusion→dry', count(*) from extrusion_available_for_drying_v v join tenant t on v.tenant_id=t.tenant_id
    where available_units < 0
  union all
  select 'dry→kiln', count(*) from dry_available_for_kiln_v v join tenant t on v.tenant_id=t.tenant_id
    where available_units < 0
  union all
  select 'kiln→packing', count(*) from kiln_available_for_packing_v v join tenant t on v.tenant_id=t.tenant_id
    where available_units < 0
  union all
  select 'packing inventory', count(*) from pallet_inventory_v v join tenant t on v.tenant_id=t.tenant_id
    where units_available < 0
  union all
  select 'inventory live', count(*) from pallet_inventory_live_v v join tenant t on v.tenant_id=t.tenant_id
    where units_available < 0
),

-- ===== Rack capacity guard =====
rack_over as (
  select r.code as rack_code, ro.occupied_units, r.capacity_units
  from dry_rack_occupancy_v ro
  join dry_racks r on r.id=ro.rack_id and r.tenant_id=ro.tenant_id
  join tenant t on ro.tenant_id=t.tenant_id
  where ro.occupied_units > r.capacity_units
),

-- ===== Status ↔ timestamp sanity (active must have started_at; completed must have completed_at) =====
status_ts as (
  select 'mix_batches' as tbl, code, status
  from mix_batches m join tenant t on m.tenant_id=t.tenant_id
  where (status='active' and started_at is null) or (status='completed' and completed_at is null)
  union all
  select 'crush_runs', code, status from crush_runs m join tenant t on m.tenant_id=t.tenant_id
  where (status='active' and started_at is null) or (status='completed' and completed_at is null)
  union all
  select 'extrusion_runs', code, status from extrusion_runs m join tenant t on m.tenant_id=t.tenant_id
  where (status='active' and started_at is null) or (status='completed' and completed_at is null)
  union all
  select 'dry_loads', code, status from dry_loads m join tenant t on m.tenant_id=t.tenant_id
  where (status='active' and started_at is null) or (status='completed' and completed_at is null)
  union all
  select 'kiln_batches', code, status from kiln_batches m join tenant t on m.tenant_id=t.tenant_id
  where (status='active' and started_at is null) or (status='completed' and completed_at is null)
),

-- ===== Reservation pairing (Dispatch picks must have pallet reservations with same correlation_id) =====
orphan_picks as (
  with picks as (
    select tenant_id, correlation_id
    from events e join tenant t on e.tenant_id=t.tenant_id
    where aggregate_type='shipment' and event_type='SHIPMENT_PICK_ADDED' and correlation_id is not null
    group by tenant_id, correlation_id
  ),
  res as (
    select tenant_id, correlation_id
    from events e join tenant t on e.tenant_id=t.tenant_id
    where aggregate_type='pallet' and event_type='PACK_PALLET_RESERVED' and correlation_id is not null
    group by tenant_id, correlation_id
  )
  select p.correlation_id
  from picks p
  left join res r on r.tenant_id=p.tenant_id and r.correlation_id=p.correlation_id
  where r.correlation_id is null
),

-- ===== Sales: reserved must not exceed ordered =====
over_reserved_orders as (
  select so.code as order_code, coalesce(t.total_units,0) as total_units, coalesce(r.reserved_units,0) as reserved_units
  from sales_orders so
  left join sales_order_totals_v t on t.tenant_id=so.tenant_id and t.order_id=so.id
  left join order_reservations_v r on r.tenant_id=so.tenant_id and r.order_id=so.id
  join tenant ten on so.tenant_id=ten.tenant_id
  where coalesce(r.reserved_units,0) > coalesce(t.total_units,0)
),

-- ===== Packing: reserved must not exceed units_on_pallet =====
over_reserved_pallets as (
  select p.code as pallet_code, inv.units_on_pallet, inv.reserved_units
  from pallet_inventory_v inv
  join pallets p on p.id=inv.pallet_id and p.tenant_id=inv.tenant_id
  join tenant t on inv.tenant_id=t.tenant_id
  where inv.reserved_units > inv.units_on_pallet
),

-- ===== Finance: payments applied must not exceed payment amount =====
over_applied_payments as (
  select pay.code as payment_code, pay.amount, coalesce(sum(pa.amount_applied),0) as applied
  from payments pay
  left join payment_applications pa on pa.payment_id=pay.id and pa.tenant_id=pay.tenant_id
  join tenant t on pay.tenant_id=t.tenant_id
  group by pay.code, pay.amount
  having coalesce(sum(pa.amount_applied),0) > pay.amount
),

-- ===== Finance: invoice balances must be consistent (no negative balances) =====
bad_invoices as (
  select code as invoice_code, grand_total, amount_applied, balance_due
  from invoice_balance_v iv join tenant t on iv.tenant_id=t.tenant_id
  where balance_due < 0 or grand_total < 0 or amount_applied < 0
)

-- ======= REPORT =======
select 'event_hygiene.missing_tenant' as check, missing_tenant::text as value from event_hygiene
union all select 'event_hygiene.missing_agg', missing_agg::text from event_hygiene
union all select 'event_hygiene.missing_time', missing_time::text from event_hygiene
union all select 'negatives.' || stage, cnt::text from negatives
union all select 'rack_over.count', count(*)::text from rack_over
union all select 'status_ts.count', count(*)::text from status_ts
union all select 'orphan_picks.count', count(*)::text from orphan_picks
union all select 'over_reserved_orders.count', count(*)::text from over_reserved_orders
union all select 'over_reserved_pallets.count', count(*)::text from over_reserved_pallets
union all select 'over_applied_payments.count', count(*)::text from over_applied_payments
union all select 'bad_invoices.count', count(*)::text from bad_invoices
order by 1;

-- Drill-down helpers (run as needed)
-- select * from rack_over;
-- select * from status_ts order by tbl, code;
-- select * from over_reserved_orders;
-- select * from over_reserved_pallets;
-- select * from over_applied_payments;
-- select * from bad_invoices;
