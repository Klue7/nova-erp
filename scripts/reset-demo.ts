import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'

const Env = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(10),
  DEMO_TENANT_CODE: z.string().min(3),
})
const env = Env.parse(process.env)

async function main() {
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })
  // Resolve tenant id
  const { data: t, error: e1 } = await supabase
    .from('tenants')
    .select('id')
    .eq('code', env.DEMO_TENANT_CODE)
    .maybeSingle()
  if (e1) throw e1
  if (!t) {
    console.log('No such tenant; nothing to reset.')
    return
  }
  const tenantId = t.id as string

  console.log(`🔁 Resetting demo data for tenant ${env.DEMO_TENANT_CODE} (${tenantId})…`)

  // Delete order: children first, then parents; finally events.
  // Only demo-safe tables touched here. Extend if needed.
  const tables = [
    'payment_applications',
    'payments',
    'invoices',
    'shipments',
    'pallets',
    'pack_locations',
    'kiln_batches',
    'dry_loads',
    'dry_racks',
    'extrusion_runs',
    'crush_runs',
    'mix_batches',
    'mining_shifts',
    'mining_vehicles',
    'stockpiles',
    'product_prices',
    'products',
    'customers',
  ]
  for (const tbl of tables) {
    const { error } = await supabase.from(tbl).delete().eq('tenant_id', tenantId)
    if (error && !String(error.message).includes('does not exist')) {
      console.warn(`Warning deleting ${tbl}:`, error.message)
    }
  }
  // Delete events last
  const { error: e2 } = await supabase.from('events').delete().eq('tenant_id', tenantId)
  if (e2) console.warn('Warning deleting events:', e2.message)

  console.log('✅ Demo reset complete')
}

main().catch(err => {
  console.error('Reset failed:', err)
  process.exit(1)
})
