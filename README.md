# Nova Bricks ERP Monorepo

Nova Bricks is an event-driven ERP platform for brick manufacturing, built with Next.js (App Router) and Supabase in a pnpm workspace.

## Repository Layout

- `apps/web` – Next.js app with server components, Tailwind, and shadcn/ui primitives.
- `brain/` – Knowledge base PDFs and summaries for domain context.
- `.bmad-core/` – BMAD automation artefacts consumed by Codex CLI agents.
- `db/migrations/` – SQL applied to the hosted Supabase instance.

## Getting Started

1. Install dependencies once: `pnpm install --no-frozen-lockfile`
2. Create `apps/web/.env.local` with your Supabase project values:
   ```
   NEXT_PUBLIC_SUPABASE_URL=<your-supabase-url>
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<your-supabase-publishable-key>
   NEXT_PUBLIC_SITE_URL=<https-url-for-this-app>
   NEXT_PUBLIC_ENABLE_PASSWORD_AUTH=true # optional: allow password logins for test users
   ```
   `NEXT_PUBLIC_SITE_URL` should match the Site URL in Supabase Auth (used for
   magic-link redirects). Optional: add `DEFAULT_TENANT_ID` or other envs as we
   introduce them.
3. Run the web app: `pnpm dev:web`
4. Lint and test as needed: `pnpm lint:web`, `pnpm --filter web test`

## Supabase Schema

Apply the base schema by pasting `db/migrations/0001_profiles_and_events.sql` into the Supabase SQL editor (or running it via `supabase db`). The same SQL appears in the Phase 2 summary for easy copy/paste.

This migration creates:
- `profiles` table for role + tenant metadata (RLS enforced)
- `events` append-only log with tenant-scoped policies

## Conformance Audit

Use `db/audit/tenant_conformance.sql` to validate that domain views and events stay aligned:

1. Open Supabase SQL Editor for your project.
2. Copy the contents of `db/audit/tenant_conformance.sql`.
3. Replace `'nova-demo'` with the tenant code you want to verify.
4. Run the script – every `…count` row must return `0` for a healthy tenant.

If a check reports a non-zero value, use the drill-down queries at the bottom of the file to investigate (e.g. negative availability, orphan reservations, finance over-application) and emit the missing counter-events.

## Auth & Profiles

- `/login` sends a Supabase magic link. Signed-in users are redirected to `/dashboard`, which then sends them to the correct module route based on role.
- First-time users without a profile are taken to `/onboarding` to set `full_name` and `role`. Tenant defaults to `auth.users.id` unless Supabase `user_metadata.tenant_id` is already populated.
- In Supabase Dashboard → Authentication → URL Configuration, set **Site URL**
  to `https://<your-app-domain>` (or localhost URL during development).
- Also add `https://<your-app-domain>/auth/confirm` to the **Redirect URLs**
  list to support magic-link verification.
- Update a user’s role/tenant anytime with:
  ```sql
  update profiles
    set role = 'mining_operator'
  where id = '<auth-user-id>';
  ```
  To seed a brand-new profile without using the onboarding screen, insert a
  row directly:
  ```sql
  insert into profiles (id, role, tenant_id, full_name)
  values ('<auth-user-id>', 'mining_operator', '<tenant-uuid>', 'Mina Operator')
  on conflict (id) do update set
    role = excluded.role,
    tenant_id = excluded.tenant_id,
    full_name = excluded.full_name;
  ```
  (You can reuse the auth user id as `tenant_id` until tenant provisioning is
  automated.)

## Phase Status

### Phase 1
- App shell with public landing experience and protected layout.
- Animated hero, Quick Actions grid, and module placeholders.
- shadcn/ui primitives vendored in `apps/web/components/ui`.

### Phase 2
- Supabase magic-link auth flow, session guards, and onboarding flow.
- Profiles + events SQL migration with RLS policies.
- RBAC helpers (`apps/web/lib/rbac.ts`) and event SDK (`apps/web/lib/events.ts`).
- Mining operations workspace with vehicle assignment, shift lifecycle controls, and load capture that pairs mining + stockpile events.

### Stockpile Module (Phase 3)
- Execute `db/migrations/0002_stockpile_domain.sql` in Supabase to create the
  stockpile tables and analytic views (`stockpile_balances_v`,
  `stockpile_movements`, `stockpile_quality_latest`).
- Stockpile utilities live in `apps/web/lib/stockpile.ts` and handle all
  server-side operations + event logging.
- Server actions are defined in `apps/web/app/(protected)/stockpile/actions.ts`
  and invoked by the dashboard dialogs.
- The Stockpile dashboard route is `/stockpile`; stockpile operators and mining
  operators can access it.

### Mixing Module (Phase 4)
- Paste `db/migrations/0003_mixing_domain.sql` into the Supabase SQL editor to
  create `mix_batches`, `mix_components_v`, `mix_inputs_v`, `mix_status_latest`,
  and `mix_kpi_today` views.
- Server-side helpers are in `apps/web/lib/mixing.ts`; all mixing actions use
  these functions to validate stockpile availability and emit both mix and
  stockpile events (shared correlation IDs keep event trails linked).
- React server actions live in `apps/web/app/(protected)/mixing/actions.ts` and
  feed the `/mixing` dashboard dialogs.
- The Mixing dashboard enforces access for `mixing_operator` (and admins). Use
  the “Create Batch” dialog to seed a batch, then add components; quantity
  checks run against `stockpile_balances_v` so insufficient inventory raises an
  error.

### Crushing Module (Phase 5)
- Run `db/migrations/0004_crushing_domain.sql` in Supabase to install
  `crush_runs`, KPI views (`crush_run_metrics_v`, `crush_kpi_today`), and the
  mix-to-crushing availability helpers.
- Server utilities live in `apps/web/lib/crushing.ts`; they guarantee mix batch
  availability before logging `CRUSH_COMPONENT_ADDED` and keep the pairing of
  run operations (start, downtime, output, complete) with consistent
  correlation IDs.
- Actions in `apps/web/app/(protected)/crushing/actions.ts` back the `/crushing`
  dashboard dialogs for creating runs, adding inputs, logging downtime, and
  recording output.
- `/crushing` shows KPIs (active runs, output, downtime, average net TPH) along
  with per-run detail panes. Only `crushing_operator` and admins have access;
  other roles are redirected with an “Access denied” toast.

### Extrusion Module (Phase 6)
- Execute `db/migrations/0005_extrusion_domain.sql` in Supabase to add
  `extrusion_runs`, extrusion KPI views, and the crushing-to-extrusion
  availability helpers (`crush_available_for_extrusion_v`,
  `crush_consumption_for_extrusion_v`).
- Server utilities live in `apps/web/lib/extrusion.ts`; they enforce crushed
  output availability, prevent negative quantities, and emit all lifecycle
  events (start/pause/resume, output, scrap, die changes, complete/cancel).
- Server actions in `apps/web/app/(protected)/extrusion/actions.ts` power the
  `/extrusion` dashboard dialogs and revalidate the page on success.
- The `/extrusion` dashboard shows KPIs for active runs, units + scrap today,
  and average net UPH, alongside the planned/active run table and detailed pane
  with inputs, output/scrap summary, and action dialogs. Access is limited to
  `extrusion_operator` and `admin` roles; others are redirected with an access
  denied toast.

### Dry Yard Module (Phase 7)
- Apply `db/migrations/0006_dry_yard_domain.sql` in Supabase to create rack
  master data plus drying KPI views (`dry_kpi_today`, `dry_load_metrics_v`,
  `dry_rack_occupancy_v`) and extrusion-to-dry yard availability helpers.
- Server utilities live in `apps/web/lib/dry.ts` handling rack creation, load
  lifecycle (start, move, complete/cancel), moisture logging, and capacity +
  availability validation before adding inputs.
- Server actions in `apps/web/app/(protected)/dry-yard/actions.ts` back the
  `/dry-yard` dialogs for racks, loads, moisture readings, movements, and scrap
  logging.
- The `/dry-yard` dashboard surfaces KPIs, rack utilisation, planned/active
  loads, and a detailed pane with inputs and recent moisture history. Only
  `dryyard_operator` and `admin` roles have access; others are redirected with
  an access-denied toast.

### Kiln Module (Phase 8)
- Run `db/migrations/0007_kiln_domain.sql` in Supabase to set up
  `kiln_batches`, firing metrics (`kiln_batch_metrics_v`, `kiln_kpi_today`),
  zone temperature and fuel usage views, plus the dry-load availability view
  `dry_available_for_kiln_v`.
- Server utilities live in `apps/web/lib/kiln.ts` and cover the full kiln batch
  lifecycle: creating batches, validating dry-load availability when adding
  inputs, logging zone temps/fuel usage, and recording output/yield.
- Server actions are in `apps/web/app/(protected)/kiln/actions.ts` and power the
  `/kiln` dashboard dialogs for start/pause/resume, temperature and fuel
  logging, output capture, and completion/cancellation.
- The `/kiln` dashboard shows KPIs (active batches, units fired, fuel usage,
  average yield), a planned/active batch table, and a detail pane with inputs,
  zone temperatures, fuel summary, and outputs. Only `kiln_operator` and
  `admin` roles may access it; other roles are redirected with an access-denied
  toast.

### Packing Module (Phase 9)
- Paste `db/migrations/0008_packing_domain.sql` into the Supabase SQL editor to
  create packing locations, pallet inventory views, kiln-to-pallet availability,
  and the `packing_kpi_today` helper.
- Server-side utilities live in `apps/web/lib/packing.ts` and enforce kiln
  availability plus pallet state (open/closed) before logging events for every
  action (create, grade, move, reserve, scrap, close/cancel, etc.).
- Server actions reside in `apps/web/app/(protected)/packing/actions.ts`; they
  power the `/packing` dashboard dialogs and revalidate the route after each
  successful mutation.
- The `/packing` dashboard surfaces KPIs, the live pallet inventory table, and a
  detail pane with input breakdowns and recent events. `packing_operator` and
  `admin` roles can access it; other roles are redirected with an access-denied
  toast.
- The “Print label” action logs a `PACK_LABEL_PRINTED` event and opens
  `/packing/label/[id]`, a printable page that shows pallet metadata and a QR
  placeholder for warehouse teams.

### Dispatch Module (Phase 10)
- Run `db/migrations/0009_dispatch_domain.sql` in Supabase to create the
  `shipments` table, dispatch KPI views, weighbridge summaries, and the
  `pallet_inventory_live_v` view that subtracts shipped units from pallet
  availability.
- Dispatch helpers live in `apps/web/lib/dispatch.ts`; they validate pallet
  availability via `pallet_inventory_live_v`, reserve pallet units when picks
  are added (`PACK_PALLET_RESERVED`), and release reservations when picks are
  removed, shipments are dispatched, or cancelled.
- Server actions are defined in `apps/web/app/(protected)/dispatch/actions.ts`
  and back the `/dispatch` dashboard dialogs for carriers, addresses, picklists,
  weighbridge entries, dispatch, and cancellation.
- The `/dispatch` dashboard shows outbound KPIs, planned shipments, picklist and
  weighbridge cards, delivery address preview, and recent events. Only
  `dispatch_clerk` and `admin` roles have access; others are redirected with an
  access-denied toast.
- Completing the dispatch flow updates pallet availability (via shipped units)
  and produces printable delivery notes at `/dispatch/dn/[id]` with QR stub and
  signature placeholders.

### Sales Module (Phase 11)
- Paste `db/migrations/0010_sales_domain.sql` into Supabase to provision master
  data tables (`customers`, `products`, `product_prices`), `sales_orders`, and
  the analytic views powering KPIs, reservations, and shipment rollups.
- Sales utilities live in `apps/web/lib/sales.ts`; they validate pricing,
  enforce pallet availability when reserving inventory, emit paired sales and
  pallet events (shared correlation IDs), and compute per-order fulfilment
  status.
- Server actions are defined in `apps/web/app/(protected)/sales/actions.ts` and
  revalidate `/sales` after every mutation (creating customers/products/orders,
  managing lines, reservations, confirmations, cancellations, and fulfilment
  lookups).
- The `/sales` dashboard is available to `sales_rep` and `admin` roles. It
  surfaces live KPIs, an orders table, customer/product maintenance tabs, and a
  detailed order workspace with action dialogs for managing lines, pallet
  reservations, cancellations, and fulfilment checks. Unauthorized roles are
  redirected to their default dashboard with an access-denied toast.

### Finance Module (Phase 12)
- Apply `db/migrations/0011_finance_domain.sql` in Supabase to create invoices,
  payments, payment applications, finance KPIs, AR aging buckets, and the
  shipment helpers used when seeding invoices from dispatch picks.
- Finance utilities live in `apps/web/lib/finance.ts`. They handle invoice
  creation, lines, issuing/voiding, payment intake, applications, reversals, and
  the `invoiceFromShipment` helper that derives billable lines from picks. All
  helpers ensure tenant scoping, validate amounts, and emit append-only events.
- Server actions in `apps/web/app/(protected)/finance/actions.ts` power the
  dialogs on the finance dashboard and revalidate the `/finance` route after
  every change.
- The `/finance` dashboard (roles: `finance`, `admin`) surfaces cashflow KPIs,
  invoices with balances, payments and applications, and AR aging/exposure. It
  supports drafting invoices, issuing/voiding, building invoices from shipments,
  receiving payments, and managing allocations.

### Admin & Tenancy Module (Phase 13)
- Paste `db/migrations/0012_admin_domain.sql` into Supabase to provision
  `tenants`, `memberships`, `invites`, `tenant_settings`, the helper functions
  (`is_member_of`, `is_admin_of`), and the admin-focused views
  (`user_memberships_v`, `admin_audit_v`).
- Admin server utilities live in `apps/web/lib/admin.ts`. They cover tenant
  creation, invites, membership/role management, tenant switching, and tenant
  settings updates while emitting the corresponding admin events.
- Server actions in `apps/web/app/(protected)/admin/actions.ts` back every UI
  dialog (create tenant, invite, accept, membership mutations, tenant switch,
  settings updates, and invite revocation) and revalidate `/admin` after
  success.
- The `/admin` dashboard is restricted to `admin` roles and platform admins
  (`profiles.is_platform_admin`). Tabs include:
  - **Tenants** (platform admins only) with a create-tenant dialog.
  - **Members** for the active tenant (membership table, add/assign/remove
    forms, and tenant settings JSON editor).
  - **Invites** with status table, invite dialog, cancel action, and a
    developer helper to accept tokens.
  - **Audit** displaying filtered events from `admin_audit_v`.
  - **My Tenants** for switching active tenant context.
- A helper route `/admin/accept-invite` lets authenticated users paste invite
  tokens directly. Tenant switching calls `switchActiveTenantAction`, which
  enforces membership (unless platform admin) before updating `profiles`.

### Reporting Module (Phase 14)
- Run `db/migrations/0013_reporting_domain.sql` in Supabase to install the
  cross-module reporting views (`rpt_daily_throughput_v`, `rpt_wip_summary_v`,
  `rpt_quality_today_v`, `rpt_order_dispatch_leadtime_v`, `rpt_exec_today_v`).
  These views compose the existing module materialized views—if a domain has
  not been installed yet, the report will simply surface zeros.
- Reporting utilities live in `apps/web/lib/reports.ts`; they fetch exec KPIs,
  daily throughput, WIP snapshots, quality metrics, and order-to-dispatch lead
  times, and expose CSV helpers + percentile calculations for tests.
- CSV server actions are implemented in
  `apps/web/app/(protected)/reports/actions.ts` and return file payloads that
  the client downloads (throughput, WIP, lead times).
- The `/reports` dashboard (roles: `admin`, `finance`, `viewer`, platform
  admin) provides:
  - KPI row with dispatch/packing volume, open orders/reservations, and finance
    overlays (invoices, payments, open AR) sourced from `rpt_exec_today_v`.
  - Recharts trend across mixing/crushing/extrusion/packing/dispatch throughput
    for the last 30 days (client filters allow adjusting the window).
  - WIP table summarising planned/active counts per stage plus open pallets.
  - Quality cards showing extrusion + dry scrap (today) and active kiln yield %.
  - Order→Dispatch panel with percentile stats, histogram, and tabular detail,
    along with CSV export.
  - Export buttons wired to the server actions for quick downloads.
- All metrics originate from derived views and assume paired events reuse the
  same `correlation_id` across modules; run the conformance audit SQL if any
  chart looks off.
- The filter bar supports date range (default 30 days) and optional SKU/Grade
  text filters applied client-side. Clicking KPI cards navigates to their
  source modules (dispatch, packing, sales, finance).

Refer to `apps/web/README.md` for any app-specific notes, and see
`docs/test-users.md` for a walkthrough on creating one test account per role.
