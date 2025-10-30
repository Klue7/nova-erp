-- begin 0010_sales_domain.sql

-- === Master data =================================================================
create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  code text not null,
  name text not null,
  credit_limit numeric,
  status text not null default 'active',
  created_at timestamptz default now(),
  unique (tenant_id, code)
);
alter table customers enable row level security;

create policy "tenant_select_customers"
  on customers for select
  using (tenant_id = (select tenant_id from profiles where id = auth.uid()));

create policy "tenant_insert_customers"
  on customers for insert
  with check (tenant_id = (select tenant_id from profiles where id = auth.uid()));

create policy "tenant_update_customers"
  on customers for update
  using (tenant_id = (select tenant_id from profiles where id = auth.uid()))
  with check (tenant_id = (select tenant_id from profiles where id = auth.uid()));

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  sku text not null,
  name text,
  uom text default 'units',
  status text not null default 'active',
  created_at timestamptz default now(),
  unique (tenant_id, sku)
);
alter table products enable row level security;

create policy "tenant_select_products"
  on products for select
  using (tenant_id = (select tenant_id from profiles where id = auth.uid()));

create policy "tenant_insert_products"
  on products for insert
  with check (tenant_id = (select tenant_id from profiles where id = auth.uid()));

create policy "tenant_update_products"
  on products for update
  using (tenant_id = (select tenant_id from profiles where id = auth.uid()))
  with check (tenant_id = (select tenant_id from profiles where id = auth.uid()));

create table if not exists product_prices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  product_id uuid not null references products(id) on delete cascade,
  currency text not null default 'ZAR',
  unit_price numeric not null,
  effective_from timestamptz not null default now(),
  effective_to timestamptz
);
alter table product_prices enable row level security;

create policy "tenant_select_product_prices"
  on product_prices for select
  using (tenant_id = (select tenant_id from profiles where id = auth.uid()));

create policy "tenant_insert_product_prices"
  on product_prices for insert
  with check (tenant_id = (select tenant_id from profiles where id = auth.uid()));

create policy "tenant_update_product_prices"
  on product_prices for update
  using (tenant_id = (select tenant_id from profiles where id = auth.uid()))
  with check (tenant_id = (select tenant_id from profiles where id = auth.uid()));

create or replace view current_product_price_v as
select p.tenant_id, p.product_id, p.currency, p.unit_price
from (
  select *,
         row_number() over (partition by tenant_id, product_id order by effective_from desc) as rn
  from product_prices
  where effective_from <= now() and (effective_to is null or effective_to >= now())
) p
where p.rn = 1;

-- === Sales orders =================================================================
create table if not exists sales_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  code text not null,
  customer_id uuid not null references customers(id) on delete restrict,
  status text not null default 'draft',   -- draft | confirmed | fulfilled | cancelled
  created_at timestamptz default now(),
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  unique (tenant_id, code)
);
alter table sales_orders enable row level security;

create policy "tenant_select_sales_orders"
  on sales_orders for select
  using (tenant_id = (select tenant_id from profiles where id = auth.uid()));

create policy "tenant_insert_sales_orders"
  on sales_orders for insert
  with check (tenant_id = (select tenant_id from profiles where id = auth.uid()));

create policy "tenant_update_sales_orders"
  on sales_orders for update
  using (tenant_id = (select tenant_id from profiles where id = auth.uid()))
  with check (tenant_id = (select tenant_id from profiles where id = auth.uid()));

-- Convenience subset of events
create or replace view sales_events as
  select e.*
  from events e
  where e.aggregate_type = 'sales_order';

-- Lines from events (added/removed => signed qty)
create or replace view sales_order_lines_v as
with base as (
  select
    e.tenant_id,
    (e.payload->>'orderId')::uuid   as order_id,
    (e.payload->>'productId')::uuid as product_id,
    (e.payload->>'sku')::text       as sku,
    case
      when e.event_type = 'SALES_ORDER_LINE_ADDED' then coalesce((e.payload->>'quantityUnits')::numeric, 0)
      when e.event_type = 'SALES_ORDER_LINE_REMOVED' then -coalesce((e.payload->>'quantityUnits')::numeric, 0)
      else 0
    end as signed_qty,
    (e.payload->>'unitPrice')::numeric as unit_price,
    (e.payload->>'currency')::text     as currency
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
group by tenant_id, order_id, product_id, sku;

create or replace view sales_order_totals_v as
select
  l.tenant_id,
  l.order_id,
  sum(l.quantity_units) as total_units,
  sum(l.line_value_est) as total_value_est
from sales_order_lines_v l
group by l.tenant_id, l.order_id;

-- Reservations per order (reading pallet events with orderId in payload)
create or replace view order_reservations_v as
with res as (
  select
    e.tenant_id,
    (e.payload->>'orderId')::uuid  as order_id,
    (e.payload->>'palletId')::uuid as pallet_id,
    case
      when e.event_type = 'PACK_PALLET_RESERVED' then coalesce((e.payload->>'quantityUnits')::numeric, 0)
      when e.event_type = 'PACK_PALLET_RESERVATION_RELEASED' then -coalesce((e.payload->>'quantityUnits')::numeric, 0)
      else 0
    end as signed_qty
  from events e
  where e.aggregate_type = 'pallet'
    and e.event_type in ('PACK_PALLET_RESERVED','PACK_PALLET_RESERVATION_RELEASED')
    and (e.payload ? 'orderId')
)
select tenant_id, order_id, pallet_id, sum(signed_qty) as reserved_units
from res
group by tenant_id, order_id, pallet_id;

-- Shipped units per order (from dispatch picks tagged with orderId, dispatched only)
create or replace view order_shipped_v as
with dispatched_shipments as (
  select s.tenant_id, s.id as shipment_id
  from shipments s
  join shipments_status_latest sl
    on sl.tenant_id = s.tenant_id
   and sl.shipment_id = s.id
   and sl.status = 'dispatched'
)
select
  e.tenant_id,
  (e.payload->>'orderId')::uuid as order_id,
  sum(
    case
      when e.event_type = 'SHIPMENT_PICK_ADDED' then coalesce((e.payload->>'quantityUnits')::numeric, 0)
      when e.event_type = 'SHIPMENT_PICK_REMOVED' then -coalesce((e.payload->>'quantityUnits')::numeric, 0)
      else 0
    end
  ) as shipped_units
from events e
join dispatched_shipments ds
  on ds.tenant_id = e.tenant_id
 and ds.shipment_id = (e.payload->>'shipmentId')::uuid
where e.aggregate_type = 'shipment'
  and e.event_type in ('SHIPMENT_PICK_ADDED','SHIPMENT_PICK_REMOVED')
  and (e.payload ? 'orderId')
group by e.tenant_id, (e.payload->>'orderId')::uuid;

-- Sales order status latest (from events)
create or replace view sales_status_latest as
with states as (
  select
    e.tenant_id,
    (e.payload->>'orderId')::uuid as order_id,
    e.event_type,
    e.occurred_at,
    row_number() over (partition by e.tenant_id, (e.payload->>'orderId')::uuid order by e.occurred_at desc) rn
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
where rn = 1;

-- KPIs
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
         sum(coalesce((e.payload->>'quantityUnits')::numeric, 0)) as units_ordered_today
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

-- end 0010_sales_domain.sql
