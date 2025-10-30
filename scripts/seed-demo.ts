/* eslint-disable no-console */
import 'dotenv/config'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { faker } from '@faker-js/faker'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'

/**
 * Load & validate env
 */
const Env = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(10),
  DEMO_TENANT_CODE: z.string().min(3),
  DEMO_ACTOR_ID: z.string().uuid(),
  DEMO_DAYS: z.coerce.number().int().min(1).max(60).default(10),
  DEMO_MIN_DAILY_PALLETS: z.coerce.number().int().min(1).max(50).default(2),
  DEMO_MAX_DAILY_PALLETS: z.coerce.number().int().min(1).max(50).default(6),
})
const env = Env.parse(process.env)

type UUID = string
type Json = Record<string, unknown>

type VehicleCtx = {
  id: UUID
  code: string
  capacityTonnes: number | null
}

type Ctx = {
  supabase: SupabaseClient
  tenantId: UUID
  actorId: UUID
  actorRole: string
  actorName: string
  vehicles: VehicleCtx[]
  now: Date
}

const delay = (ms: number) => new Promise(res => setTimeout(res, ms))

async function fetchActorProfile(ctx: Pick<Ctx, 'supabase'>, actorId: UUID) {
  const { data, error } = await ctx.supabase
    .from('profiles')
    .select('full_name, role')
    .eq('id', actorId)
    .maybeSingle()

  if (error && error.code !== 'PGRST116') {
    throw error
  }

  return {
    name: (data?.full_name as string | null) ?? 'Demo Operator',
    role: (data?.role as string | null) ?? 'admin',
  }
}

async function ensureVehicles(ctx: Pick<Ctx, 'supabase' | 'tenantId'>) {
  const fleet = [
    { code: 'TRUCK-101', description: 'Bell B30E articulated dump truck', capacity: 30 },
    { code: 'TRUCK-202', description: 'CAT 772G rigid dump truck', capacity: 45 },
    { code: 'LOADER-5', description: 'CAT 988 loader feeding plant', capacity: 20 },
  ]

  await ctx.supabase
    .from('mining_vehicles')
    .upsert(
      fleet.map(item => ({
        tenant_id: ctx.tenantId,
        code: item.code,
        description: item.description,
        capacity_tonnes: item.capacity,
        status: 'active',
      })),
      { onConflict: 'tenant_id,code' }
    )

  const { data, error } = await ctx.supabase
    .from('mining_vehicles')
    .select('id, code, capacity_tonnes')
    .eq('tenant_id', ctx.tenantId)
    .in(
      'code',
      fleet.map(item => item.code)
    )

  if (error) {
    throw error
  }

  return (data ?? []).map(row => ({
    id: row.id as UUID,
    code: row.code as string,
    capacityTonnes: row.capacity_tonnes ? Number(row.capacity_tonnes) : null,
  }))
}

async function upsertTenantAndAdmin(ctx: Pick<Ctx, 'supabase'>, code: string, actorId: UUID) {
  // tenants is in admin migration. Create or fetch by code.
  const { data: t1, error: e1 } = await ctx.supabase
    .from('tenants')
    .select('id,code')
    .eq('code', code)
    .maybeSingle()
  if (e1) throw e1
  if (t1) return t1.id as UUID

  const { data: ins, error: e2 } = await ctx.supabase
    .from('tenants')
    .insert({ code, name: code.toUpperCase() })
    .select('id')
    .single()
  if (e2) throw e2
  const tenantId = ins.id as UUID

  // Add admin membership for actor
  const { error: e3 } = await ctx.supabase
    .from('memberships')
    .insert({ tenant_id: tenantId, user_id: actorId, role: 'admin' })
  if (e3 && !String(e3.message).includes('duplicate')) throw e3

  // Set profile active tenant if possible
  const { error: e4 } = await ctx.supabase
    .from('profiles')
    .update({ tenant_id: tenantId })
    .eq('id', actorId)
  if (e4) console.warn('profiles update warning:', e4.message)

  return tenantId
}

async function insertEvent(
  ctx: Ctx,
  p: {
    occurred_at: string
    aggregate_type: string
    aggregate_id: string
    event_type: string
    payload: Json
    actor_role?: string
    correlation_id?: string
    causation_id?: string
  }
) {
  const row = {
    occurred_at: p.occurred_at,
    tenant_id: ctx.tenantId,
    actor_id: ctx.actorId,
    actor_role: p.actor_role ?? ctx.actorRole,
    aggregate_type: p.aggregate_type,
    aggregate_id: p.aggregate_id,
    event_type: p.event_type,
    payload: p.payload,
    source: 'seed',
    correlation_id: p.correlation_id ?? null,
    causation_id: p.causation_id ?? null,
  }
  const { error } = await ctx.supabase.from('events').insert(row)
  if (error) throw new Error(`insertEvent ${p.event_type}: ${error.message}`)
}

function at(dayOffset: number, hour: number, minute = 0) {
  const d = new Date()
  d.setHours(9, 0, 0, 0) // normalize baseline
  d.setDate(d.getDate() - dayOffset)
  d.setHours(
    hour,
    minute,
    faker.number.int({ min: 0, max: 59 }),
    faker.number.int({ min: 0, max: 999 })
  )
  return d.toISOString()
}

async function seedDay(ctx: Ctx, dayOffset: number) {
  // --- Mining / Stockpile ---
  const spId = randomUUID()
  const spCode = `SP-${String(dayOffset).padStart(2, '0')}`
  // stockpiles master (id, tenant_id, code, status)
  await ctx.supabase
    .from('stockpiles')
    .upsert({ id: spId, tenant_id: ctx.tenantId, code: spCode, status: 'active', material_type: 'Clay_A' })

  await insertEvent(ctx, {
    occurred_at: at(dayOffset, 7, 30),
    aggregate_type: 'stockpile',
    aggregate_id: spId,
    event_type: 'STOCKPILE_CREATED',
    payload: { stockpileId: spId, stockpileCode: spCode, materialType: 'Clay_A', location: 'Yard-1' },
  })

  const vehicle = ctx.vehicles.length > 0
    ? faker.helpers.arrayElement(ctx.vehicles)
    : { id: randomUUID(), code: 'TRUCK-000', capacityTonnes: 30 }

  if (ctx.vehicles.length === 0) {
    await ctx.supabase
      .from('mining_vehicles')
      .upsert({
        id: vehicle.id,
        tenant_id: ctx.tenantId,
        code: vehicle.code,
        status: 'active',
        capacity_tonnes: vehicle.capacityTonnes ?? 30,
      })
  }

  const shiftId = randomUUID()
  const shiftStart = at(dayOffset, 6, 30)
  const shiftEnd = at(dayOffset, 14, 45)

  await ctx.supabase
    .from('mining_shifts')
    .upsert({
      id: shiftId,
      tenant_id: ctx.tenantId,
      vehicle_id: vehicle.id,
      operator_id: ctx.actorId,
      operator_name: ctx.actorName,
      operator_role: 'mining_operator',
      status: 'completed',
      started_at: new Date(shiftStart),
      ended_at: new Date(shiftEnd),
    })

  await insertEvent(ctx, {
    occurred_at: shiftStart,
    aggregate_type: 'mining.shift',
    aggregate_id: shiftId,
    event_type: 'MINING_SHIFT_STARTED',
    payload: {
      shiftId,
      vehicleId: vehicle.id,
      vehicleCode: vehicle.code,
      operatorId: ctx.actorId,
      operatorName: ctx.actorName,
      operatorRole: 'mining_operator',
      startedAt: shiftStart,
    },
    actor_role: 'mining_operator',
  })

  let minedTonnes = 0
  const loadCount = faker.number.int({ min: 3, max: 6 })
  for (let i = 0; i < loadCount; i++) {
    const loadId = randomUUID()
    const haulHour = 7 + Math.floor(i / 2)
    const haulMinute = (i % 2) * 25 + faker.number.int({ min: 0, max: 5 })
    const occurredAt = at(dayOffset, haulHour, haulMinute)
    const tonnage = faker.number.float({ min: 18, max: 36, fractionDigits: 1 })
    const moisture = faker.number.float({ min: 6, max: 11, fractionDigits: 1 })
    minedTonnes += tonnage
    const corr = randomUUID()

    await insertEvent(ctx, {
      occurred_at: occurredAt,
      aggregate_type: 'mining.load',
      aggregate_id: loadId,
      event_type: 'MINING_LOAD_RECORDED',
      payload: {
        loadId,
        shiftId,
        vehicleId: vehicle.id,
        vehicleCode: vehicle.code,
        stockpileId: spId,
        stockpileCode: spCode,
        tonnage,
        moisturePct: moisture,
        operatorId: ctx.actorId,
        operatorName: ctx.actorName,
        recordedAt: occurredAt,
      },
      correlation_id: corr,
      actor_role: 'mining_operator',
    })

    await insertEvent(ctx, {
      occurred_at: occurredAt,
      aggregate_type: 'stockpile',
      aggregate_id: spId,
      event_type: 'STOCKPILE_RECEIPT_RECORDED',
      payload: {
        stockpileId: spId,
        stockpileCode: spCode,
        quantityTonnes: tonnage,
        reference: vehicle.code,
        notes: `Haul ${i + 1}`,
      },
      correlation_id: corr,
      actor_role: 'mining_operator',
    })
  }

  await insertEvent(ctx, {
    occurred_at: shiftEnd,
    aggregate_type: 'mining.shift',
    aggregate_id: shiftId,
    event_type: 'MINING_SHIFT_COMPLETED',
    payload: {
      shiftId,
      vehicleId: vehicle.id,
      operatorId: ctx.actorId,
      operatorName: ctx.actorName,
      completedAt: shiftEnd,
      loads: loadCount,
      totalTonnage: minedTonnes,
    },
    actor_role: 'mining_operator',
  })

  // --- Mixing ---
  const mixId = randomUUID()
  const mixCode = `MB-${faker.number.int({ min: 100, max: 999 })}`
  await ctx.supabase
    .from('mix_batches')
    .upsert({ id: mixId, tenant_id: ctx.tenantId, code: mixCode, status: 'planned' })
  await insertEvent(ctx, {
    occurred_at: at(dayOffset, 9, 0),
    aggregate_type: 'mix_batch',
    aggregate_id: mixId,
    event_type: 'MIX_BATCH_CREATED',
    payload: { batchId: mixId, batchCode: mixCode, targetOutputTonnes: 40 },
  })
  const compTonnes = Math.min(
    minedTonnes * 0.8,
    faker.number.float({ min: 15, max: 35, fractionDigits: 1 })
  )
  const corr1 = randomUUID()
  await insertEvent(ctx, {
    occurred_at: at(dayOffset, 9, 15),
    aggregate_type: 'mix_batch',
    aggregate_id: mixId,
    event_type: 'MIX_COMPONENT_ADDED',
    payload: {
      batchId: mixId,
      stockpileId: spId,
      stockpileCode: spCode,
      materialType: 'Clay_A',
      quantityTonnes: compTonnes,
    },
    correlation_id: corr1,
  })
  await insertEvent(ctx, {
    occurred_at: at(dayOffset, 9, 16),
    aggregate_type: 'stockpile',
    aggregate_id: spId,
    event_type: 'STOCKPILE_TRANSFERRED_OUT',
    payload: { stockpileId: spId, quantityTonnes: compTonnes, toBatchId: mixId },
    correlation_id: corr1,
  })
  await ctx.supabase
    .from('mix_batches')
    .update({ status: 'active', started_at: new Date(at(dayOffset, 9, 20)) })
    .eq('id', mixId)
  await insertEvent(ctx, {
    occurred_at: at(dayOffset, 9, 20),
    aggregate_type: 'mix_batch',
    aggregate_id: mixId,
    event_type: 'MIX_BATCH_STARTED',
    payload: { batchId: mixId, startedAt: at(dayOffset, 9, 20) },
  })
  const mixOut = Number(
    (compTonnes * faker.number.float({ min: 0.92, max: 0.98, fractionDigits: 3 })).toFixed(1)
  )
  await ctx.supabase
    .from('mix_batches')
    .update({ status: 'completed', completed_at: new Date(at(dayOffset, 10, 0)) })
    .eq('id', mixId)
  await insertEvent(ctx, {
    occurred_at: at(dayOffset, 10, 0),
    aggregate_type: 'mix_batch',
    aggregate_id: mixId,
    event_type: 'MIX_BATCH_COMPLETED',
    payload: { batchId: mixId, outputTonnes: mixOut, completedAt: at(dayOffset, 10, 0) },
  })

  // --- Crushing ---
  const crushId = randomUUID()
  const crushCode = `CR-${faker.number.int({ min: 100, max: 999 })}`
  await ctx.supabase
    .from('crush_runs')
    .upsert({ id: crushId, tenant_id: ctx.tenantId, code: crushCode, status: 'planned' })
  await insertEvent(ctx, {
    occurred_at: at(dayOffset, 10, 10),
    aggregate_type: 'crush_run',
    aggregate_id: crushId,
    event_type: 'CRUSH_RUN_CREATED',
    payload: { runId: crushId, runCode: crushCode, targetTPH: 120 },
  })
  const corr2 = randomUUID()
  const crushIn = Math.min(
    mixOut,
    faker.number.float({ min: 10, max: 30, fractionDigits: 1 })
  )
  await insertEvent(ctx, {
    occurred_at: at(dayOffset, 10, 20),
    aggregate_type: 'crush_run',
    aggregate_id: crushId,
    event_type: 'CRUSH_COMPONENT_ADDED',
    payload: {
      runId: crushId,
      mixBatchId: mixId,
      mixBatchCode: mixCode,
      quantityTonnes: crushIn,
    },
    correlation_id: corr2,
  })
  await ctx.supabase
    .from('crush_runs')
    .update({ status: 'active', started_at: new Date(at(dayOffset, 10, 25)) })
    .eq('id', crushId)
  await insertEvent(ctx, {
    occurred_at: at(dayOffset, 11, 20),
    aggregate_type: 'crush_run',
    aggregate_id: crushId,
    event_type: 'CRUSH_RUN_STARTED',
    payload: { runId: crushId, startedAt: at(dayOffset, 10, 25) },
  })
  // Downtime + Output
  await insertEvent(ctx, {
    occurred_at: at(dayOffset, 11, 40),
    aggregate_type: 'crush_run',
    aggregate_id: crushId,
    event_type: 'CRUSH_RUN_DOWNTIME_LOGGED',
    payload: {
      runId: crushId,
      minutes: faker.number.int({ min: 5, max: 20 }),
      reason: 'Screen change',
    },
  })
  const crushOut = Number(
    (crushIn * faker.number.float({ min: 0.88, max: 0.96, fractionDigits: 3 })).toFixed(1)
  )
  await insertEvent(ctx, {
    occurred_at: at(dayOffset, 12, 10),
    aggregate_type: 'crush_run',
    aggregate_id: crushId,
    event_type: 'CRUSH_RUN_OUTPUT_RECORDED',
    payload: {
      runId: crushId,
      outputTonnes: crushOut,
      finesPct: faker.number.float({ min: 10, max: 18, fractionDigits: 1 }),
    },
  })
  await ctx.supabase
    .from('crush_runs')
    .update({ status: 'completed', completed_at: new Date(at(dayOffset, 12, 20)) })
    .eq('id', crushId)
  await insertEvent(ctx, {
    occurred_at: at(dayOffset, 12, 20),
    aggregate_type: 'crush_run',
    aggregate_id: crushId,
    event_type: 'CRUSH_RUN_COMPLETED',
    payload: { runId: crushId, completedAt: at(dayOffset, 12, 20) },
  })

  // --- Extrusion ---
  const exId = randomUUID()
  const exCode = `EX-${faker.number.int({ min: 100, max: 999 })}`
  await ctx.supabase
    .from('extrusion_runs')
    .upsert({
      id: exId,
      tenant_id: ctx.tenantId,
      code: exCode,
      status: 'planned',
      press_line: 'PL-1',
      die_code: 'DIE-CLAY-01',
      product_sku: 'BRICK-PAV',
    })
  await insertEvent(ctx, {
    occurred_at: at(dayOffset, 12, 30),
    aggregate_type: 'extrusion_run',
    aggregate_id: exId,
    event_type: 'EXTRUSION_RUN_CREATED',
    payload: {
      runId: exId,
      runCode: exCode,
      pressLine: 'PL-1',
      dieCode: 'DIE-CLAY-01',
      productSku: 'BRICK-PAV',
      targetUnits: 12000,
    },
  })
  const exInTonnes = Number((crushOut * 0.9).toFixed(1))
  await insertEvent(ctx, {
    occurred_at: at(dayOffset, 12, 35),
    aggregate_type: 'extrusion_run',
    aggregate_id: exId,
    event_type: 'EXTRUSION_INPUT_ADDED',
    payload: {
      runId: exId,
      crushRunId: crushId,
      crushRunCode: crushCode,
      quantityTonnes: exInTonnes,
    },
  })
  await ctx.supabase
    .from('extrusion_runs')
    .update({ status: 'active', started_at: new Date(at(dayOffset, 12, 40)) })
    .eq('id', exId)
  await insertEvent(ctx, {
    occurred_at: at(dayOffset, 12, 40),
    aggregate_type: 'extrusion_run',
    aggregate_id: exId,
    event_type: 'EXTRUSION_RUN_STARTED',
    payload: { runId: exId, startedAt: at(dayOffset, 12, 40) },
  })
  const exUnits = faker.number.int({ min: 8000, max: 13000 })
  await insertEvent(ctx, {
    occurred_at: at(dayOffset, 13, 30),
    aggregate_type: 'extrusion_run',
    aggregate_id: exId,
    event_type: 'EXTRUSION_OUTPUT_RECORDED',
    payload: {
      runId: exId,
      outputUnits: exUnits,
      meters: faker.number.float({ min: 200, max: 500, fractionDigits: 1 }),
    },
  })
  await insertEvent(ctx, {
    occurred_at: at(dayOffset, 13, 40),
    aggregate_type: 'extrusion_run',
    aggregate_id: exId,
    event_type: 'EXTRUSION_SCRAP_RECORDED',
    payload: {
      runId: exId,
      scrapUnits: faker.number.int({ min: 50, max: 200 }),
      reason: 'breakage',
    },
  })
  await ctx.supabase
    .from('extrusion_runs')
    .update({ status: 'completed', completed_at: new Date(at(dayOffset, 13, 50)) })
    .eq('id', exId)
  await insertEvent(ctx, {
    occurred_at: at(dayOffset, 13, 50),
    aggregate_type: 'extrusion_run',
    aggregate_id: exId,
    event_type: 'EXTRUSION_RUN_COMPLETED',
    payload: { runId: exId, completedAt: at(dayOffset, 13, 50) },
  })

  // --- Dry Yard ---
  // Ensure a couple racks
  const [rackA, rackB] = [randomUUID(), randomUUID()]
  await ctx.supabase.from('dry_racks').upsert([
    { id: rackA, tenant_id: ctx.tenantId, code: 'RACK-A', capacity_units: 15000, status: 'active' },
    { id: rackB, tenant_id: ctx.tenantId, code: 'RACK-B', capacity_units: 15000, status: 'active' },
  ])
  const loadId = randomUUID()
  const loadCode = `DL-${faker.number.int({ min: 100, max: 999 })}`
  await ctx.supabase
    .from('dry_loads')
    .upsert({ id: loadId, tenant_id: ctx.tenantId, code: loadCode, rack_id: rackA, status: 'planned' })
  await insertEvent(ctx, {
    occurred_at: at(dayOffset, 14, 0),
    aggregate_type: 'dry_load',
    aggregate_id: loadId,
    event_type: 'DRY_LOAD_CREATED',
    payload: { loadId, loadCode, rackId: rackA, targetMoisturePct: 8 },
  })
  const dryIn = Math.min(exUnits - 100, faker.number.int({ min: 4000, max: 9000 }))
  await insertEvent(ctx, {
    occurred_at: at(dayOffset, 14, 10),
    aggregate_type: 'dry_load',
    aggregate_id: loadId,
    event_type: 'DRY_INPUT_ADDED',
    payload: { loadId, runId: exId, quantityUnits: dryIn },
  })
  await ctx.supabase
    .from('dry_loads')
    .update({ status: 'active', started_at: new Date(at(dayOffset, 14, 20)) })
    .eq('id', loadId)
  await insertEvent(ctx, {
    occurred_at: at(dayOffset, 15, 0),
    aggregate_type: 'dry_load',
    aggregate_id: loadId,
    event_type: 'DRY_MOISTURE_RECORDED',
    payload: {
      loadId,
      moisturePct: faker.number.float({ min: 6, max: 12, fractionDigits: 1 }),
      method: 'probe',
    },
  })
  await ctx.supabase
    .from('dry_loads')
    .update({ status: 'completed', completed_at: new Date(at(dayOffset, 18, 0)) })
    .eq('id', loadId)
  await insertEvent(ctx, {
    occurred_at: at(dayOffset, 18, 0),
    aggregate_type: 'dry_load',
    aggregate_id: loadId,
    event_type: 'DRY_LOAD_COMPLETED',
    payload: { loadId, completedAt: at(dayOffset, 18, 0) },
  })

  // --- Kiln ---
  const kbId = randomUUID()
  const kbCode = `KB-${faker.number.int({ min: 100, max: 999 })}`
  await ctx.supabase
    .from('kiln_batches')
    .upsert({
      id: kbId,
      tenant_id: ctx.tenantId,
      code: kbCode,
      status: 'planned',
      kiln_code: 'K-1',
      firing_curve_code: 'FC-STD',
      target_units: dryIn,
    })
  await insertEvent(ctx, {
    occurred_at: at(dayOffset, 18, 10),
    aggregate_type: 'kiln_batch',
    aggregate_id: kbId,
    event_type: 'KILN_BATCH_CREATED',
    payload: {
      batchId: kbId,
      batchCode: kbCode,
      kilnCode: 'K-1',
      firingCurveCode: 'FC-STD',
      targetUnits: dryIn,
    },
  })
  await insertEvent(ctx, {
    occurred_at: at(dayOffset, 18, 20),
    aggregate_type: 'kiln_batch',
    aggregate_id: kbId,
    event_type: 'KILN_INPUT_ADDED',
    payload: { batchId: kbId, dryLoadId: loadId, quantityUnits: Math.round(dryIn * 0.95) },
  })
  await ctx.supabase
    .from('kiln_batches')
    .update({ status: 'active', started_at: new Date(at(dayOffset, 18, 30)) })
    .eq('id', kbId)
  await insertEvent(ctx, {
    occurred_at: at(dayOffset, 19, 0),
    aggregate_type: 'kiln_batch',
    aggregate_id: kbId,
    event_type: 'KILN_BATCH_STARTED',
    payload: { batchId: kbId, startedAt: at(dayOffset, 18, 30) },
  })
  await insertEvent(ctx, {
    occurred_at: at(dayOffset, 20, 0),
    aggregate_type: 'kiln_batch',
    aggregate_id: kbId,
    event_type: 'KILN_FUEL_USAGE_RECORDED',
    payload: {
      batchId: kbId,
      fuelType: 'gas',
      amount: faker.number.float({ min: 100, max: 250, fractionDigits: 1 }),
      unit: 'Nm³',
    },
  })
  const fired = Math.round(dryIn * faker.number.float({ min: 0.9, max: 0.98, fractionDigits: 3 }))
  await insertEvent(ctx, {
    occurred_at: at(dayOffset, 21, 0),
    aggregate_type: 'kiln_batch',
    aggregate_id: kbId,
    event_type: 'KILN_OUTPUT_RECORDED',
    payload: {
      batchId: kbId,
      firedUnits: fired,
      shrinkagePct: faker.number.float({ min: 2, max: 8, fractionDigits: 1 }),
    },
  })
  await ctx.supabase
    .from('kiln_batches')
    .update({ status: 'completed', completed_at: new Date(at(dayOffset, 21, 10)) })
    .eq('id', kbId)
  await insertEvent(ctx, {
    occurred_at: at(dayOffset, 21, 10),
    aggregate_type: 'kiln_batch',
    aggregate_id: kbId,
    event_type: 'KILN_BATCH_COMPLETED',
    payload: { batchId: kbId, completedAt: at(dayOffset, 21, 10) },
  })

  // --- Packing ---
  // Ensure a location
  const locId = randomUUID()
  await ctx.supabase
    .from('pack_locations')
    .upsert({
      id: locId,
      tenant_id: ctx.tenantId,
      code: 'STAGE-1',
      type: 'staging',
      capacity_pallets: 500,
      status: 'active',
    })
  const palletsToday = faker.number.int({
    min: Number(process.env.DEMO_MIN_DAILY_PALLETS ?? 2),
    max: Number(process.env.DEMO_MAX_DAILY_PALLETS ?? 6),
  })
  const palletIds: UUID[] = []
  let remaining = fired
  for (let i = 0; i < palletsToday; i++) {
    const pid = randomUUID()
    palletIds.push(pid)
    const pCode = `PAL-${dayOffset}-${i + 1}`
    await ctx.supabase
      .from('pallets')
      .upsert({
        id: pid,
        tenant_id: ctx.tenantId,
        code: pCode,
        product_sku: 'BRICK-PAV',
        grade: faker.helpers.arrayElement(['A', 'B']),
        capacity_units: 8000,
        location_id: locId,
        status: 'open',
      })
    await insertEvent(ctx, {
      occurred_at: at(dayOffset, 21, 20 + i),
      aggregate_type: 'pallet',
      aggregate_id: pid,
      event_type: 'PACK_PALLET_CREATED',
      payload: {
        palletId: pid,
        palletCode: pCode,
        productSku: 'BRICK-PAV',
        grade: 'A',
        capacityUnits: 8000,
        locationId: locId,
      },
    })
    const put = Math.min(remaining, faker.number.int({ min: 500, max: 3000 }))
    remaining -= put
    await insertEvent(ctx, {
      occurred_at: at(dayOffset, 21, 25 + i),
      aggregate_type: 'pallet',
      aggregate_id: pid,
      event_type: 'PACK_INPUT_ADDED',
      payload: { palletId: pid, kilnBatchId: kbId, quantityUnits: put },
    })
  }

  // --- Sales (one order) ---
  // Ensure product & price & customer
  const { data: prodRow } = await ctx.supabase
    .from('products')
    .select('id')
    .eq('tenant_id', ctx.tenantId)
    .eq('sku', 'BRICK-PAV')
    .maybeSingle()
  let productId = prodRow?.id as UUID | undefined
  if (!productId) {
    const { data: p2 } = await ctx.supabase
      .from('products')
      .insert({ tenant_id: ctx.tenantId, sku: 'BRICK-PAV', name: 'Paving Brick' })
      .select('id')
      .single()
    productId = p2.id as UUID
    await ctx.supabase
      .from('product_prices')
      .insert({ tenant_id: ctx.tenantId, product_id: productId, unit_price: 3.5, currency: 'ZAR' })
  }
  const { data: custRow } = await ctx.supabase
    .from('customers')
    .select('id')
    .eq('tenant_id', ctx.tenantId)
    .eq('code', 'CUST-001')
    .maybeSingle()
  let customerId = custRow?.id as UUID | undefined
  if (!customerId) {
    const { data: c2 } = await ctx.supabase
      .from('customers')
      .insert({ tenant_id: ctx.tenantId, code: 'CUST-001', name: 'Demo Customer', credit_limit: 100000 })
      .select('id')
      .single()
    customerId = c2.id as UUID
  }

  const soId = randomUUID()
  const soCode = `SO-${faker.number.int({ min: 1000, max: 9999 })}`
  await ctx.supabase
    .from('sales_orders')
    .insert({
      id: soId,
      tenant_id: ctx.tenantId,
      code: soCode,
      customer_id: customerId,
      status: 'confirmed',
      confirmed_at: new Date(at(dayOffset, 21, 40)),
    })
  await insertEvent(ctx, {
    occurred_at: at(dayOffset, 21, 30),
    aggregate_type: 'sales_order',
    aggregate_id: soId,
    event_type: 'SALES_ORDER_CREATED',
    payload: { orderId: soId, orderCode: soCode, customerId },
  })
  const orderUnits = Math.min(fired * 0.6, faker.number.int({ min: 1000, max: 6000 }))
  await insertEvent(ctx, {
    occurred_at: at(dayOffset, 21, 31),
    aggregate_type: 'sales_order',
    aggregate_id: soId,
    event_type: 'SALES_ORDER_LINE_ADDED',
    payload: {
      orderId: soId,
      productId,
      sku: 'BRICK-PAV',
      quantityUnits: orderUnits,
      unitPrice: 3.5,
      currency: 'ZAR',
    },
  })
  await insertEvent(ctx, {
    occurred_at: at(dayOffset, 21, 40),
    aggregate_type: 'sales_order',
    aggregate_id: soId,
    event_type: 'SALES_ORDER_CONFIRMED',
    payload: { orderId: soId },
  })

  // Reserve from pallets for that order (and emit paired pallet reservation events)
  let remainingToReserve = Math.min(orderUnits, fired)
  for (const pid of palletIds) {
    if (remainingToReserve <= 0) break
    const qty = Math.min(remainingToReserve, faker.number.int({ min: 300, max: 1500 }))
    remainingToReserve -= qty
    const corr = randomUUID()
    await insertEvent(ctx, {
      occurred_at: at(dayOffset, 21, 45),
      aggregate_type: 'pallet',
      aggregate_id: pid,
      event_type: 'PACK_PALLET_RESERVED',
      payload: { palletId: pid, orderId: soId, quantityUnits: qty },
      correlation_id: corr,
    })
    await insertEvent(ctx, {
      occurred_at: at(dayOffset, 21, 45),
      aggregate_type: 'sales_order',
      aggregate_id: soId,
      event_type: 'SALES_ORDER_RESERVED',
      payload: { orderId: soId, palletId: pid, quantityUnits: qty },
      correlation_id: corr,
    })
  }

  // --- Dispatch (pick, weighbridge, dispatch)
  const shId = randomUUID()
  const shCode = `SH-${faker.number.int({ min: 1000, max: 9999 })}`
  await ctx.supabase
    .from('shipments')
    .insert({
      id: shId,
      tenant_id: ctx.tenantId,
      code: shCode,
      status: 'picking',
      customer_code: 'CUST-001',
      customer_name: 'Demo Customer',
    })
  await insertEvent(ctx, {
    occurred_at: at(dayOffset, 22, 0),
    aggregate_type: 'shipment',
    aggregate_id: shId,
    event_type: 'SHIPMENT_CREATED',
    payload: {
      shipmentId: shId,
      shipmentCode: shCode,
      customerCode: 'CUST-001',
      customerName: 'Demo Customer',
    },
  })
  await insertEvent(ctx, {
    occurred_at: at(dayOffset, 22, 5),
    aggregate_type: 'shipment',
    aggregate_id: shId,
    event_type: 'SHIPMENT_PICKLIST_CREATED',
    payload: { shipmentId: shId },
  })

  // Convert part of the reservations into picks
  let remainingToPick = Math.min(orderUnits, fired * 0.5)
  for (const pid of palletIds) {
    if (remainingToPick <= 0) break
    const qty = Math.min(remainingToPick, faker.number.int({ min: 200, max: 1200 }))
    remainingToPick -= qty
    const corr = randomUUID()
    await insertEvent(ctx, {
      occurred_at: at(dayOffset, 22, 10),
      aggregate_type: 'pallet',
      aggregate_id: pid,
      event_type: 'PACK_PALLET_RESERVED',
      payload: { palletId: pid, orderId: soId, quantityUnits: qty },
      correlation_id: corr,
    })
    await insertEvent(ctx, {
      occurred_at: at(dayOffset, 22, 11),
      aggregate_type: 'shipment',
      aggregate_id: shId,
      event_type: 'SHIPMENT_PICK_ADDED',
      payload: {
        shipmentId: shId,
        palletId: pid,
        quantityUnits: qty,
        orderId: soId,
        productSku: 'BRICK-PAV',
        grade: 'A',
      },
      correlation_id: corr,
    })
  }

  await insertEvent(ctx, {
    occurred_at: at(dayOffset, 22, 20),
    aggregate_type: 'shipment',
    aggregate_id: shId,
    event_type: 'SHIPMENT_WEIGHBRIDGE_IN',
    payload: {
      shipmentId: shId,
      grossKg: faker.number.int({ min: 18000, max: 26000 }),
      tareKg: faker.number.int({ min: 8000, max: 11000 }),
    },
  })
  await insertEvent(ctx, {
    occurred_at: at(dayOffset, 22, 50),
    aggregate_type: 'shipment',
    aggregate_id: shId,
    event_type: 'SHIPMENT_WEIGHBRIDGE_OUT',
    payload: {
      shipmentId: shId,
      grossKg: faker.number.int({ min: 22000, max: 30000 }),
      tareKg: faker.number.int({ min: 8000, max: 11000 }),
    },
  })
  await ctx.supabase
    .from('shipments')
    .update({ status: 'dispatched', dispatched_at: new Date(at(dayOffset, 23, 0)) })
    .eq('id', shId)
  await insertEvent(ctx, {
    occurred_at: at(dayOffset, 23, 0),
    aggregate_type: 'shipment',
    aggregate_id: shId,
    event_type: 'SHIPMENT_DISPATCHED',
    payload: { shipmentId: shId, totalUnits: orderUnits, dispatchedAt: at(dayOffset, 23, 0) },
  })

  // Release any residual reservations on dispatch (modelled by views; here we emit the release for symmetry)
  for (const pid of palletIds) {
    await insertEvent(ctx, {
      occurred_at: at(dayOffset, 23, 1),
      aggregate_type: 'pallet',
      aggregate_id: pid,
      event_type: 'PACK_PALLET_RESERVATION_RELEASED',
      payload: { palletId: pid, orderId: soId, quantityUnits: 0 }, // 0 = no-op if none; keeps events consistent
    })
  }

  // --- Finance (invoice from shipment; payment)
  const invId = randomUUID()
  const invCode = `INV-${faker.number.int({ min: 10000, max: 99999 })}`
  await ctx.supabase
    .from('invoices')
    .insert({
      id: invId,
      tenant_id: ctx.tenantId,
      code: invCode,
      customer_id: customerId,
      currency: 'ZAR',
      status: 'issued',
      issue_date: new Date(at(dayOffset, 23, 0)),
      due_date: new Date(at(dayOffset - 1, 23, 0)),
    })
  await insertEvent(ctx, {
    occurred_at: at(dayOffset, 23, 2),
    aggregate_type: 'invoice',
    aggregate_id: invId,
    event_type: 'INVOICE_CREATED',
    payload: { invoiceId: invId, invoiceCode: invCode, customerId },
  })
  await insertEvent(ctx, {
    occurred_at: at(dayOffset, 23, 3),
    aggregate_type: 'invoice',
    aggregate_id: invId,
    event_type: 'INVOICE_LINE_ADDED',
    payload: {
      invoiceId: invId,
      productId,
      sku: 'BRICK-PAV',
      quantityUnits: Math.round(orderUnits * 0.5),
      unitPrice: 3.5,
      taxRate: 0.15,
    },
  })
  await insertEvent(ctx, {
    occurred_at: at(dayOffset, 23, 4),
    aggregate_type: 'invoice',
    aggregate_id: invId,
    event_type: 'INVOICE_ISSUED',
    payload: {
      invoiceId: invId,
      issueDate: at(dayOffset, 23, 0),
      dueDate: at(Math.max(dayOffset - 1, 0), 23, 0),
      termsDays: 30,
    },
  })
  // Occasionally record a payment next day for variety; we don't wait synchronously here.
}

async function main() {
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })
  const tenantId = await upsertTenantAndAdmin({ supabase }, env.DEMO_TENANT_CODE, env.DEMO_ACTOR_ID)
  const actorProfile = await fetchActorProfile({ supabase }, env.DEMO_ACTOR_ID)
  const vehicles = await ensureVehicles({ supabase, tenantId })

  const ctx: Ctx = {
    supabase,
    tenantId,
    actorId: env.DEMO_ACTOR_ID,
    actorRole: actorProfile.role,
    actorName: actorProfile.name,
    vehicles,
    now: new Date(),
  }

  console.log(`🌱 Seeding demo tenant '${env.DEMO_TENANT_CODE}' (${tenantId}) for ${env.DEMO_DAYS} day(s)…`)
  for (let d = env.DEMO_DAYS; d >= 1; d--) {
    await seedDay(ctx, d)
    // tiny delay to avoid rate limiting
    await delay(50)
  }
  console.log('✅ Seed complete')
}

main().catch(err => {
  console.error('❌ Seed failed:', err)
  process.exit(1)
})
