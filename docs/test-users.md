# Test Account Playbook

Use these steps to create demo users for each Nova Bricks role in your hosted
Supabase project. They let you log in with the magic-link flow and experience
the protected dashboards exactly as an operator would.

> **Prerequisites**
> - You have run the migration in `db/migrations/0001_profiles_and_events.sql`.
> - You are an owner/administrator of the Supabase project (so you can create
>   auth users and run SQL against the database).

---

## 1. Choose emails for each role

| Role                | Suggested email             | Friendly name          |
| ------------------- | --------------------------- | ---------------------- |
| mining_operator     | mining.operator+dev@example.com   | Mina Operator          |
| stockpile_operator  | stockpile.operator+dev@example.com| Stella Stockpile       |
| mixing_operator     | mixing.operator+dev@example.com   | Max Mixer              |
| crushing_operator   | crushing.operator+dev@example.com | Cruz Crushing          |
| extrusion_operator  | extrusion.operator+dev@example.com| Ezra Extrusion         |
| dryyard_operator    | dryyard.operator+dev@example.com  | Dana Dry Yard          |
| kiln_operator       | kiln.operator+dev@example.com     | Kai Kiln               |
| packing_operator    | packing.operator+dev@example.com  | Piper Packing          |
| dispatch_clerk      | dispatch.clerk+dev@example.com    | Drew Dispatch          |
| sales_rep           | sales.rep+dev@example.com         | Sage Sales             |
| finance             | finance+dev@example.com           | Finley Finance         |
| admin               | admin+dev@example.com             | Alex Admin             |
| viewer              | viewer+dev@example.com            | Val Viewer             |

Feel free to replace the domain with something you control (e.g. a
`@example.org` alias) so you can receive the magic-link emails.

---

## 2. Create Supabase Auth users

1. In the Supabase dashboard, go to **Authentication → Users → Add user**.
2. Enter the email, set an initial password (e.g. `NovaBricks!123`), and tick
   “Auto confirm user” so they can log in immediately.
3. Repeat for each role you want to preview.
4. (Optional) You can also enable email aliasing by using a single inbox with
   “plus addressing”, e.g. `yourname+mining@domain.com`. Supabase treats each
   alias as a unique account.

*(Tip: you can also use the Supabase CLI – `supabase auth signups create --email … --password …` – if you prefer scripting. That command requires the service role key, so do **not** run it inside Next.js code.)*

---

## 3. Stamp profile + tenant metadata

Run the SQL block below in the Supabase SQL editor **as a single execution**
after substituting the email addresses you actually created (the `WITH
target_users AS (...)` clause must remain attached to the following `INSERT`).
This will:

- Upsert a `profiles` row with the correct role + friendly name.
- Default each tenant to the corresponding auth user id (feel free to group
  multiple roles under a shared tenant UUID if you want to simulate multi-user
  organisations).
- Store the `tenant_id` in `auth.users.user_metadata` so onboarding can skip the
  tenant prompt.

```sql
-- Replace the emails with the ones you created.
with target_users as (
  select id, email
  from auth.users
  where email in (
    'mining.operator@example.com',
    'stockpile.operator@example.com',
    'mixing.operator@example.com',
    'crushing.operator@example.com',
    'extrusion.operator@example.com',
    'dryyard.operator@example.com',
    'kiln.operator@example.com',
    'packing.operator@example.com',
    'dispatch.clerk@example.com',
    'sales.rep@example.com',
    'finance@example.com',
    'admin@example.com',
    'viewer@example.com'
  )
)
-- 1) seed/refresh the profile rows
insert into profiles (id, role, tenant_id, full_name)
select
  tu.id,
  case
    when tu.email = 'mining.operator@example.com' then 'mining_operator'
    when tu.email = 'stockpile.operator@example.com' then 'stockpile_operator'
    when tu.email = 'mixing.operator@example.com' then 'mixing_operator'
    when tu.email = 'crushing.operator@example.com' then 'crushing_operator'
    when tu.email = 'extrusion.operator@example.com' then 'extrusion_operator'
    when tu.email = 'dryyard.operator@example.com' then 'dryyard_operator'
    when tu.email = 'kiln.operator@example.com' then 'kiln_operator'
    when tu.email = 'packing.operator@example.com' then 'packing_operator'
    when tu.email = 'dispatch.clerk@example.com' then 'dispatch_clerk'
    when tu.email = 'sales.rep@example.com' then 'sales_rep'
    when tu.email = 'finance@example.com' then 'finance'
    when tu.email = 'admin@example.com' then 'admin'
    else 'viewer'
  end as role,
  tu.id as tenant_id,
  case
    when tu.email = 'mining.operator@example.com' then 'Mina Operator'
    when tu.email = 'stockpile.operator@example.com' then 'Stella Stockpile'
    when tu.email = 'mixing.operator@example.com' then 'Max Mixer'
    when tu.email = 'crushing.operator@example.com' then 'Cruz Crushing'
    when tu.email = 'extrusion.operator@example.com' then 'Ezra Extrusion'
    when tu.email = 'dryyard.operator@example.com' then 'Dana Dry Yard'
    when tu.email = 'kiln.operator@example.com' then 'Kai Kiln'
    when tu.email = 'packing.operator@example.com' then 'Piper Packing'
    when tu.email = 'dispatch.clerk@example.com' then 'Drew Dispatch'
    when tu.email = 'sales.rep@example.com' then 'Sage Sales'
    when tu.email = 'finance@example.com' then 'Finley Finance'
    when tu.email = 'admin@example.com' then 'Alex Admin'
    else 'Val Viewer'
  end as full_name
from target_users tu
on conflict (id) do update
set role = excluded.role,
    tenant_id = excluded.tenant_id,
    full_name = excluded.full_name;

-- 2) align auth.users metadata with the profile tenant_id (optional but useful)
update auth.users u
set raw_user_meta_data = coalesce(u.raw_user_meta_data, '{}'::jsonb) || jsonb_build_object(
  'tenant_id',
  (select tenant_id from profiles where profiles.id = u.id)
)
where exists (select 1 from target_users tu where tu.id = u.id);
```

---

## 4. Log in (password or magic link)

1. Set `NEXT_PUBLIC_ENABLE_PASSWORD_AUTH=true` in `apps/web/.env.local` and
   restart `pnpm dev:web`. The login screen will now show a “Password” tab.
2. Visit `/login`, pick either the **Password** or **Magic link** mode, and use
   the credentials you created. For passwords we suggest reusing a common test
   value such as `NovaBricks!123`.

The onboarding screen will be skipped because the profile is already in place,
and you should land directly on the module mapped to the role.

If you ever need to reset a profile for testing, re-run the SQL above for the
subset of accounts you care about or simply delete the rows from `profiles` and
revisit `/onboarding`.
