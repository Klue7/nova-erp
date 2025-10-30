-- begin 0015_invite_policy_fix.sql

drop policy if exists "tenant_select_invites" on invites;

drop function if exists current_user_email();

create or replace function current_user_email()
returns text
language plpgsql
security definer
set search_path = public, auth
stable
as $$
declare
  jwt_email text;
  fetched_email text;
begin
  jwt_email := nullif(current_setting('request.jwt.claim.email', true), '');
  if jwt_email is not null then
    return jwt_email;
  end if;

  begin
    select email
      into fetched_email
    from auth.users
    where id = auth.uid();
  exception
    when others then
      return null;
  end;

  return fetched_email;
end;
$$;

create policy "tenant_select_invites"
  on invites for select
  using (
    is_admin_of(tenant_id)
    or coalesce(lower(email), '') = coalesce(lower(current_user_email()), '')
  );

drop view if exists rpt_exec_today_v;
drop view if exists sales_kpi_today;
drop view if exists sales_order_totals_v;
drop view if exists order_reservations_v;
drop view if exists order_shipped_v;
drop view if exists sales_status_latest;
drop view if exists sales_order_lines_v;
drop view if exists rpt_order_dispatch_leadtime_v;
drop view if exists shipment_picks_by_order_v;
drop function if exists try_cast_uuid(text);
drop function if exists try_cast_numeric(text);

create or replace function try_cast_uuid(value text)
returns uuid
language plpgsql
immutable
as $$
begin
  if value is null or trim(value) = '' then
    return null;
  end if;
  return value::uuid;
exception
  when others then
    return null;
end;
$$;

create or replace function try_cast_numeric(value text)
returns numeric
language plpgsql
immutable
as $$
begin
  if value is null or trim(value) = '' then
    return null;
  end if;
  return value::numeric;
exception
  when others then
    return null;
end;
$$;

create or replace view shipment_picks_by_order_v as
with base as (
  select
    e.tenant_id,
    try_cast_uuid(e.payload->>'shipmentId') as shipment_id,
    try_cast_uuid(e.payload->>'orderId')    as order_id,
    (e.payload->>'productSku')::text        as sku,
    case
      when e.event_type = 'SHIPMENT_PICK_ADDED' then coalesce(try_cast_numeric(e.payload->>'quantityUnits'), 0)
      when e.event_type = 'SHIPMENT_PICK_REMOVED' then -coalesce(try_cast_numeric(e.payload->>'quantityUnits'), 0)
      else 0
    end as signed_qty
  from events e
  where e.aggregate_type = 'shipment'
    and e.event_type in ('SHIPMENT_PICK_ADDED', 'SHIPMENT_PICK_REMOVED')
)
select tenant_id, shipment_id, order_id, sku, sum(signed_qty) as net_units
from base
where shipment_id is not null
  and order_id is not null
group by tenant_id, shipment_id, order_id, sku;

create or replace view sales_order_lines_v as
with base as (
  select
    e.tenant_id,
    try_cast_uuid(e.payload->>'orderId')   as order_id,
    try_cast_uuid(e.payload->>'productId') as product_id,
    (e.payload->>'sku')::text              as sku,
    case
      when e.event_type = 'SALES_ORDER_LINE_ADDED'
        then coalesce(try_cast_numeric(e.payload->>'quantityUnits'), 0)
      when e.event_type = 'SALES_ORDER_LINE_REMOVED'
        then -coalesce(try_cast_numeric(e.payload->>'quantityUnits'), 0)
      else 0
    end as signed_qty,
    try_cast_numeric(e.payload->>'unitPrice') as unit_price,
    (e.payload->>'currency')::text            as currency
  from events e
  where e.aggregate_type = 'sales_order'
    and e.event_type in ('SALES_ORDER_LINE_ADDED','SALES_ORDER_LINE_REMOVED')
)
select tenant_id,
       order_id,
       product_id,
       sku,
       sum(signed_qty) as quantity_units,
       sum(coalesce(unit_price, 0) * signed_qty) as line_value_est,
       max(currency) as currency
from base
where order_id is not null
  and product_id is not null
group by tenant_id, order_id, product_id, sku;

create or replace view sales_order_totals_v as
select
  l.tenant_id,
  l.order_id,
  sum(l.quantity_units) as total_units,
  sum(l.line_value_est) as total_value_est
from sales_order_lines_v l
group by l.tenant_id, l.order_id;

create or replace view order_reservations_v as
with res as (
  select
    e.tenant_id,
    try_cast_uuid(e.payload->>'orderId')  as order_id,
    try_cast_uuid(e.payload->>'palletId') as pallet_id,
    case
      when e.event_type = 'PACK_PALLET_RESERVED'
        then coalesce(try_cast_numeric(e.payload->>'quantityUnits'), 0)
      when e.event_type = 'PACK_PALLET_RESERVATION_RELEASED'
        then -coalesce(try_cast_numeric(e.payload->>'quantityUnits'), 0)
      else 0
    end as signed_qty
  from events e
  where e.aggregate_type = 'pallet'
    and e.event_type in ('PACK_PALLET_RESERVED','PACK_PALLET_RESERVATION_RELEASED')
    and (e.payload ? 'orderId')
)
select tenant_id, order_id, pallet_id, sum(signed_qty) as reserved_units
from res
where order_id is not null
group by tenant_id, order_id, pallet_id;

create or replace view order_shipped_v as
with dispatched_shipments as (
  select s.tenant_id, s.id as shipment_id
  from shipments s
  join shipments_status_latest sl
    on sl.tenant_id = s.tenant_id
   and sl.shipment_id = s.id
   and sl.status = 'dispatched'
),
shipment_events as (
  select
    e.tenant_id,
    try_cast_uuid(e.payload->>'shipmentId') as shipment_id,
    try_cast_uuid(e.payload->>'orderId')    as order_id,
    e.event_type,
    coalesce(try_cast_numeric(e.payload->>'quantityUnits'), 0) as quantity_units
  from events e
  where e.aggregate_type = 'shipment'
    and e.event_type in ('SHIPMENT_PICK_ADDED','SHIPMENT_PICK_REMOVED')
    and (e.payload ? 'orderId')
)
select
  se.tenant_id,
  se.order_id,
  sum(
    case
      when se.event_type = 'SHIPMENT_PICK_ADDED' then se.quantity_units
      when se.event_type = 'SHIPMENT_PICK_REMOVED' then -se.quantity_units
      else 0
    end
  ) as shipped_units
from shipment_events se
join dispatched_shipments ds
  on ds.tenant_id = se.tenant_id
 and ds.shipment_id = se.shipment_id
where se.order_id is not null
group by se.tenant_id, se.order_id;

create or replace view sales_status_latest as
with states as (
  select
    e.tenant_id,
    try_cast_uuid(e.payload->>'orderId') as order_id,
    e.event_type,
    e.occurred_at,
    row_number() over (
      partition by e.tenant_id, try_cast_uuid(e.payload->>'orderId')
      order by e.occurred_at desc
    ) rn
  from events e
  where e.aggregate_type = 'sales_order'
    and e.event_type in ('SALES_ORDER_CREATED','SALES_ORDER_CONFIRMED','SALES_ORDER_CANCELLED')
)
select tenant_id, order_id,
  case event_type
    when 'SALES_ORDER_CANCELLED' then 'cancelled'
    when 'SALES_ORDER_CONFIRMED' then 'confirmed'
    else 'draft'
  end as status,
  occurred_at as status_changed_at
from states
where rn = 1
  and order_id is not null;

create or replace view sales_kpi_today as
with orders_open as (
  select so.tenant_id, count(*) as open_orders
  from sales_orders so
  left join sales_status_latest sl
    on sl.tenant_id = so.tenant_id
   and sl.order_id = so.id
  where coalesce(sl.status, so.status) in ('draft','confirmed')
  group by so.tenant_id
),
ordered_today as (
  select e.tenant_id,
         sum(coalesce(try_cast_numeric(e.payload->>'quantityUnits'), 0)) as units_ordered_today
  from events e
  where e.aggregate_type = 'sales_order'
    and e.event_type = 'SALES_ORDER_LINE_ADDED'
    and e.occurred_at::date = now()::date
  group by e.tenant_id
),
reserved as (
  select tenant_id, sum(reserved_units) as units_reserved
  from order_reservations_v
  group by tenant_id
),
shipped_today as (
  select s.tenant_id,
         coalesce(sum(sp.picked_units), 0) as units_shipped_today
  from shipments s
  join shipments_status_latest sl
    on sl.tenant_id = s.tenant_id
   and sl.shipment_id = s.id
   and sl.status = 'dispatched'
  left join shipment_picks_v sp
    on sp.tenant_id = s.tenant_id
   and sp.shipment_id = s.id
  where s.dispatched_at::date = now()::date
  group by s.tenant_id
)
select coalesce(o.tenant_id, ot.tenant_id, r.tenant_id, st.tenant_id) as tenant_id,
       coalesce(open_orders, 0) as open_orders,
       coalesce(units_ordered_today, 0) as units_ordered_today,
       coalesce(units_reserved, 0) as units_reserved,
       coalesce(units_shipped_today, 0) as units_shipped_today
from orders_open o
full outer join ordered_today ot using (tenant_id)
full outer join reserved r using (tenant_id)
full outer join shipped_today st using (tenant_id);

create or replace view rpt_order_dispatch_leadtime_v as
with first_disp as (
  select
    sp.tenant_id,
    sp.order_id,
    min(s.dispatched_at) as first_dispatch_at
  from shipment_picks_by_order_v sp
  join shipments s on s.id = sp.shipment_id and s.tenant_id = sp.tenant_id
  join shipments_status_latest sl
    on sl.tenant_id = s.tenant_id
   and sl.shipment_id = s.id
   and sl.status = 'dispatched'
  group by sp.tenant_id, sp.order_id
)
select
  so.tenant_id,
  so.id as order_id,
  so.code as order_code,
  so.created_at::date as order_date,
  fd.first_dispatch_at::date as first_dispatch_date,
  case
    when fd.first_dispatch_at is not null
      then greatest((fd.first_dispatch_at::date - so.created_at::date), 0)
    else null
  end as days_order_to_dispatch
from sales_orders so
left join first_disp fd
  on fd.tenant_id = so.tenant_id
 and fd.order_id = so.id;

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
