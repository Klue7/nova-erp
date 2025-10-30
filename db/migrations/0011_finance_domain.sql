-- begin 0011_finance_domain.sql

-- =========================
-- Master tables (AR focus)
-- =========================
create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  code text not null,
  customer_id uuid not null references customers(id) on delete restrict,
  currency text not null default 'ZAR',
  status text not null default 'draft',  -- draft | issued | paid | void | cancelled
  issue_date date,
  due_date date,
  created_at timestamptz default now(),
  cancelled_at timestamptz,
  unique (tenant_id, code)
);
alter table invoices enable row level security;

create policy "tenant_select_invoices"
  on invoices for select
  using (tenant_id = (select tenant_id from profiles where id = auth.uid()));

create policy "tenant_insert_invoices"
  on invoices for insert
  with check (tenant_id = (select tenant_id from profiles where id = auth.uid()));

create policy "tenant_update_invoices"
  on invoices for update
  using (tenant_id = (select tenant_id from profiles where id = auth.uid()))
  with check (tenant_id = (select tenant_id from profiles where id = auth.uid()));

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  code text not null,
  customer_id uuid not null references customers(id) on delete restrict,
  currency text not null default 'ZAR',
  amount numeric not null,
  method text,
  reference text,
  received_at timestamptz not null default now(),
  status text not null default 'open',   -- open | applied | reversed | cancelled
  created_at timestamptz default now(),
  unique (tenant_id, code)
);
alter table payments enable row level security;

create policy "tenant_select_payments"
  on payments for select
  using (tenant_id = (select tenant_id from profiles where id = auth.uid()));

create policy "tenant_insert_payments"
  on payments for insert
  with check (tenant_id = (select tenant_id from profiles where id = auth.uid()));

create policy "tenant_update_payments"
  on payments for update
  using (tenant_id = (select tenant_id from profiles where id = auth.uid()))
  with check (tenant_id = (select tenant_id from profiles where id = auth.uid()));

create table if not exists payment_applications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  payment_id uuid not null references payments(id) on delete cascade,
  invoice_id uuid not null references invoices(id) on delete restrict,
  amount_applied numeric not null,
  applied_at timestamptz not null default now()
);
alter table payment_applications enable row level security;

create policy "tenant_select_payment_apps"
  on payment_applications for select
  using (tenant_id = (select tenant_id from profiles where id = auth.uid()));

create policy "tenant_insert_payment_apps"
  on payment_applications for insert
  with check (
    tenant_id = (select tenant_id from profiles where id = auth.uid())
    and payment_id in (select id from payments  where tenant_id = (select tenant_id from profiles where id = auth.uid()))
    and invoice_id in (select id from invoices  where tenant_id = (select tenant_id from profiles where id = auth.uid()))
  );

-- =========================
-- Event convenience views
-- =========================
create or replace view invoice_events as
  select * from events where aggregate_type = 'invoice';

create or replace view payment_events as
  select * from events where aggregate_type = 'payment';

-- =========================
-- Invoice lines (from events)
-- =========================
create or replace view invoice_lines_v as
with base as (
  select
    e.tenant_id,
    (e.payload->>'invoiceId')::uuid  as invoice_id,
    (e.payload->>'productId')::uuid  as product_id,
    (e.payload->>'sku')::text        as sku,
    case when e.event_type='INVOICE_LINE_ADDED' then coalesce((e.payload->>'quantityUnits')::numeric,0)
         when e.event_type='INVOICE_LINE_REMOVED' then -coalesce((e.payload->>'quantityUnits')::numeric,0)
         else 0 end as signed_qty,
    coalesce((e.payload->>'unitPrice')::numeric,0) as unit_price,
    coalesce((e.payload->>'taxRate')::numeric,0)   as tax_rate
  from events e
  where e.aggregate_type='invoice'
    and e.event_type in ('INVOICE_LINE_ADDED','INVOICE_LINE_REMOVED')
)
select
  tenant_id, invoice_id, product_id, sku,
  sum(signed_qty)                         as quantity_units,
  sum(signed_qty * unit_price)            as net_amount,
  sum(signed_qty * unit_price * tax_rate) as tax_amount
from base
group by tenant_id, invoice_id, product_id, sku;

create or replace view invoice_totals_v as
select
  l.tenant_id,
  l.invoice_id,
  coalesce(sum(l.net_amount),0) as subtotal,
  coalesce(sum(l.tax_amount),0) as tax_total,
  coalesce(sum(l.net_amount + l.tax_amount),0) as grand_total
from invoice_lines_v l
group by l.tenant_id, l.invoice_id;

-- =========================
-- Payments → applications
-- =========================
create or replace view payments_applied_v as
select
  pa.tenant_id,
  pa.invoice_id,
  sum(pa.amount_applied) as amount_applied
from payment_applications pa
group by pa.tenant_id, pa.invoice_id;

create or replace view invoice_balance_v as
select
  i.tenant_id,
  i.id as invoice_id,
  i.code,
  i.customer_id,
  i.status,
  i.issue_date,
  i.due_date,
  coalesce(t.grand_total,0) as grand_total,
  coalesce(a.amount_applied,0) as amount_applied,
  (coalesce(t.grand_total,0) - coalesce(a.amount_applied,0)) as balance_due
from invoices i
left join invoice_totals_v t on t.tenant_id=i.tenant_id and t.invoice_id=i.id
left join payments_applied_v a on a.tenant_id=i.tenant_id and a.invoice_id=i.id;

-- =========================
-- AR aging & exposure
-- =========================
create or replace view ar_open_items_v as
select *
from invoice_balance_v
where status in ('issued') and balance_due > 0;

create or replace view ar_aging_v as
select
  tenant_id,
  invoice_id,
  code as invoice_code,
  customer_id,
  balance_due,
  due_date,
  greatest((now()::date - due_date), 0) as days_past_due,
  case
    when (now()::date - due_date) <= 30 then '0-30'
    when (now()::date - due_date) <= 60 then '31-60'
    when (now()::date - due_date) <= 90 then '61-90'
    else '>90'
  end as bucket
from ar_open_items_v;

create or replace view customer_ar_balance_v as
select customer_id, tenant_id, sum(balance_due) as open_balance
from ar_open_items_v
group by tenant_id, customer_id;

-- =========================
-- Finance KPIs
-- =========================
create or replace view finance_kpi_today as
with inv_today as (
  select i.tenant_id, count(*) as invoices_issued_today, coalesce(sum(t.grand_total),0) as value_issued_today
  from invoices i
  left join invoice_totals_v t on t.tenant_id=i.tenant_id and t.invoice_id=i.id
  where i.issue_date = now()::date
  group by i.tenant_id
),
pay_today as (
  select tenant_id, coalesce(sum(amount),0) as payments_received_today
  from payments
  where received_at::date = now()::date
  group by tenant_id
),
open_ar as (
  select tenant_id, coalesce(sum(balance_due),0) as open_ar_total
  from ar_open_items_v
  group by tenant_id
)
select
  coalesce(i.tenant_id, p.tenant_id, a.tenant_id) as tenant_id,
  coalesce(invoices_issued_today,0)   as invoices_issued_today,
  coalesce(value_issued_today,0)      as value_issued_today,
  coalesce(payments_received_today,0) as payments_received_today,
  coalesce(open_ar_total,0)           as open_ar_total
from inv_today i
full outer join pay_today p using (tenant_id)
full outer join open_ar a using (tenant_id);

-- =========================
-- (Optional) shipment picks by order for invoicing helpers
-- =========================
create or replace view shipment_picks_by_order_v as
with base as (
  select
    e.tenant_id,
    (e.payload->>'shipmentId')::uuid as shipment_id,
    (e.payload->>'orderId')::uuid    as order_id,
    (e.payload->>'productSku')::text as sku,
    case when e.event_type='SHIPMENT_PICK_ADDED' then coalesce((e.payload->>'quantityUnits')::numeric,0)
         when e.event_type='SHIPMENT_PICK_REMOVED' then -coalesce((e.payload->>'quantityUnits')::numeric,0)
         else 0 end as signed_qty
  from events e
  where e.aggregate_type='shipment'
    and e.event_type in ('SHIPMENT_PICK_ADDED','SHIPMENT_PICK_REMOVED')
)
select tenant_id, shipment_id, order_id, sku, sum(signed_qty) as net_units
from base
group by tenant_id, shipment_id, order_id, sku;

-- end 0011_finance_domain.sql
