import { randomUUID } from "node:crypto";

import { getUserProfile } from "@/lib/rbac";
import { logEvent } from "@/lib/events";
import { createServerSupabaseClient } from "@/utils/supabase/server";

const VIEW_MISSING_CODE = "42P01";

function ensurePositive(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be greater than zero.`);
  }
}

function ensurePercent(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`${label} must be between 0 and 100.`);
  }
}

async function assertProfile() {
  const { profile } = await getUserProfile();
  if (!profile) {
    throw new Error("Profile required for dry yard operations.");
  }
  return profile;
}

async function fetchRack(rackId: string, tenantId: string) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("dry_racks")
    .select("id, code, capacity_units, status")
    .eq("tenant_id", tenantId)
    .eq("id", rackId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    throw new Error("Rack not found.");
  }
  return data;
}

async function fetchLoad(loadId: string, tenantId: string) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("dry_loads")
    .select("id, code, rack_id, status, tenant_id")
    .eq("tenant_id", tenantId)
    .eq("id", loadId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    throw new Error("Dry load not found.");
  }
  return data;
}

async function fetchRackOccupancy(
  rackId: string,
  tenantId: string,
): Promise<number> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("dry_rack_occupancy_v")
    .select("occupied_units")
    .eq("tenant_id", tenantId)
    .eq("rack_id", rackId)
    .maybeSingle();

  if (error && error.code !== VIEW_MISSING_CODE) {
    throw new Error(error.message);
  }

  const value =
    error?.code === VIEW_MISSING_CODE
      ? 0
      : Number(data?.occupied_units ?? 0);
  return Number.isFinite(value) ? value : 0;
}

async function fetchLoadUnits(loadId: string, tenantId: string) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("dry_inputs_v")
    .select("input_units")
    .eq("tenant_id", tenantId)
    .eq("load_id", loadId)
    .maybeSingle();

  if (error && error.code !== VIEW_MISSING_CODE) {
    throw new Error(error.message);
  }

  const value =
    error?.code === VIEW_MISSING_CODE
      ? 0
      : Number(data?.input_units ?? 0);
  return Number.isFinite(value) ? value : 0;
}

export async function createRack({
  code,
  bay,
  capacityUnits,
  status = "active",
}: {
  code: string;
  bay?: string | null;
  capacityUnits: number;
  status?: string;
}) {
  if (!code.trim()) {
    throw new Error("Rack code is required.");
  }
  ensurePositive(capacityUnits, "Capacity");

  const profile = await assertProfile();
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("dry_racks")
    .insert({
      tenant_id: profile.tenant_id,
      code: code.trim(),
      bay: bay?.trim() || null,
      capacity_units: capacityUnits,
      status: status ?? "active",
    })
    .select("id, code, capacity_units")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    throw new Error("Failed to create rack.");
  }

  return data;
}

export async function createLoad({
  code,
  rackId,
  targetMoisturePct,
}: {
  code: string;
  rackId: string;
  targetMoisturePct?: number | null;
}) {
  if (!code.trim()) {
    throw new Error("Load code is required.");
  }

  const profile = await assertProfile();
  await fetchRack(rackId, profile.tenant_id);

  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("dry_loads")
    .upsert(
      {
        tenant_id: profile.tenant_id,
        code: code.trim(),
        rack_id: rackId,
        target_moisture_pct:
          targetMoisturePct !== undefined ? targetMoisturePct : null,
        status: "planned",
      },
      { onConflict: "tenant_id,code" },
    )
    .select("id, code, rack_id")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    throw new Error("Failed to create dry load.");
  }

  await logEvent(await createServerSupabaseClient(), {
    aggregateType: "dry_load",
    aggregateId: data.id,
    eventType: "DRY_LOAD_CREATED",
    payload: {
      loadId: data.id,
      loadCode: data.code,
      rackId,
      targetMoisturePct: targetMoisturePct ?? null,
    },
  });

  return data;
}

export async function addInput({
  loadId,
  extrusionRunId,
  quantityUnits,
  reference,
}: {
  loadId: string;
  extrusionRunId: string;
  quantityUnits: number;
  reference?: string | null;
}) {
  ensurePositive(quantityUnits, "Quantity");

  const profile = await assertProfile();
  const load = await fetchLoad(loadId, profile.tenant_id);

  if (!load.rack_id) {
    throw new Error("Assign the load to a rack before adding inputs.");
  }
  if (load.status === "completed" || load.status === "cancelled") {
    throw new Error("Cannot add inputs to a completed or cancelled load.");
  }

  const rack = await fetchRack(load.rack_id, profile.tenant_id);
  const supabase = await createServerSupabaseClient();

  const occupancy = await fetchRackOccupancy(load.rack_id, profile.tenant_id);
  const availableCapacity = Number(rack.capacity_units ?? 0);
  if (occupancy + quantityUnits > availableCapacity + 1e-6) {
    throw new Error(
      `Rack ${rack.code} capacity exceeded. Available: ${(availableCapacity - occupancy).toFixed(0)} units.`,
    );
  }

  const { data: availableRow, error: availableError } = await supabase
    .from("extrusion_available_for_drying_v")
    .select("available_units")
    .eq("tenant_id", profile.tenant_id)
    .eq("extrusion_run_id", extrusionRunId)
    .maybeSingle();

  if (availableError && availableError.code !== VIEW_MISSING_CODE) {
    throw new Error(availableError.message);
  }

  const availableUnits =
    availableError?.code === VIEW_MISSING_CODE
      ? 0
      : Number(availableRow?.available_units ?? 0);

  if (availableUnits < quantityUnits) {
    throw new Error(
      `Extrusion run only has ${availableUnits.toFixed(0)} units available.`,
    );
  }

  const { data: extrusionRun, error: extrusionError } = await supabase
    .from("extrusion_runs")
    .select("id, code")
    .eq("tenant_id", profile.tenant_id)
    .eq("id", extrusionRunId)
    .maybeSingle();

  if (extrusionError) {
    throw new Error(extrusionError.message);
  }
  if (!extrusionRun) {
    throw new Error("Extrusion run not found.");
  }

  await logEvent(supabase, {
    aggregateType: "dry_load",
    aggregateId: load.id,
    eventType: "DRY_INPUT_ADDED",
    payload: {
      loadId: load.id,
      loadCode: load.code,
      rackId: load.rack_id,
      runId: extrusionRun.id,
      runCode: extrusionRun.code,
      quantityUnits,
      reference: reference ?? null,
    },
    correlationId: randomUUID(),
  });
}

export async function startLoad({ loadId }: { loadId: string }) {
  const profile = await assertProfile();
  const load = await fetchLoad(loadId, profile.tenant_id);
  if (load.status === "completed" || load.status === "cancelled") {
    throw new Error("Load already closed.");
  }

  const supabase = await createServerSupabaseClient();
  const startedAt = new Date().toISOString();

  const { error } = await supabase
    .from("dry_loads")
    .update({ status: "active", started_at: startedAt })
    .eq("tenant_id", profile.tenant_id)
    .eq("id", load.id);

  if (error) {
    throw new Error(error.message);
  }

  await logEvent(supabase, {
    aggregateType: "dry_load",
    aggregateId: load.id,
    eventType: "DRY_LOAD_STARTED",
    payload: {
      loadId: load.id,
      startedAt,
    },
  });
}

export async function recordMoisture({
  loadId,
  moisturePct,
  method,
}: {
  loadId: string;
  moisturePct: number;
  method?: string | null;
}) {
  ensurePercent(moisturePct, "Moisture");

  const profile = await assertProfile();
  const load = await fetchLoad(loadId, profile.tenant_id);

  const supabase = await createServerSupabaseClient();

  await logEvent(supabase, {
    aggregateType: "dry_load",
    aggregateId: load.id,
    eventType: "DRY_MOISTURE_RECORDED",
    payload: {
      loadId: load.id,
      moisturePct,
      method: method ?? null,
    },
  });
}

export async function moveLoad({
  loadId,
  toRackId,
}: {
  loadId: string;
  toRackId: string;
}) {
  const profile = await assertProfile();
  const load = await fetchLoad(loadId, profile.tenant_id);

  if (load.rack_id === toRackId) {
    throw new Error("Load is already on the selected rack.");
  }

  const currentUnits = await fetchLoadUnits(load.id, profile.tenant_id);
  const destinationRack = await fetchRack(toRackId, profile.tenant_id);
  const destinationOccupancy = await fetchRackOccupancy(
    toRackId,
    profile.tenant_id,
  );

  if (destinationOccupancy + currentUnits > Number(destinationRack.capacity_units ?? 0) + 1e-6) {
    throw new Error(
      `Rack ${destinationRack.code} cannot accept this load; insufficient capacity.`,
    );
  }

  const supabase = await createServerSupabaseClient();

  const { error } = await supabase
    .from("dry_loads")
    .update({ rack_id: toRackId })
    .eq("tenant_id", profile.tenant_id)
    .eq("id", load.id);

  if (error) {
    throw new Error(error.message);
  }

  await logEvent(supabase, {
    aggregateType: "dry_load",
    aggregateId: load.id,
    eventType: "DRY_LOAD_MOVED",
    payload: {
      loadId: load.id,
      fromRackId: load.rack_id,
      toRackId,
    },
    correlationId: randomUUID(),
  });
}

export async function recordScrap({
  loadId,
  scrapUnits,
  reason,
}: {
  loadId: string;
  scrapUnits: number;
  reason?: string | null;
}) {
  ensurePositive(scrapUnits, "Scrap units");

  const profile = await assertProfile();
  const load = await fetchLoad(loadId, profile.tenant_id);
  const supabase = await createServerSupabaseClient();

  await logEvent(supabase, {
    aggregateType: "dry_load",
    aggregateId: load.id,
    eventType: "DRY_SCRAP_RECORDED",
    payload: {
      loadId: load.id,
      scrapUnits,
      reason: reason ?? null,
    },
  });
}

export async function completeLoad({ loadId }: { loadId: string }) {
  const profile = await assertProfile();
  const load = await fetchLoad(loadId, profile.tenant_id);

  const supabase = await createServerSupabaseClient();
  const completedAt = new Date().toISOString();

  const { error } = await supabase
    .from("dry_loads")
    .update({ status: "completed", completed_at: completedAt })
    .eq("tenant_id", profile.tenant_id)
    .eq("id", load.id);

  if (error) {
    throw new Error(error.message);
  }

  await logEvent(supabase, {
    aggregateType: "dry_load",
    aggregateId: load.id,
    eventType: "DRY_LOAD_COMPLETED",
    payload: {
      loadId: load.id,
      completedAt,
    },
  });
}

export async function cancelLoad({
  loadId,
  reason,
}: {
  loadId: string;
  reason?: string | null;
}) {
  const profile = await assertProfile();
  const load = await fetchLoad(loadId, profile.tenant_id);

  const supabase = await createServerSupabaseClient();

  const { error } = await supabase
    .from("dry_loads")
    .update({ status: "cancelled" })
    .eq("tenant_id", profile.tenant_id)
    .eq("id", load.id);

  if (error) {
    throw new Error(error.message);
  }

  await logEvent(supabase, {
    aggregateType: "dry_load",
    aggregateId: load.id,
    eventType: "DRY_LOAD_CANCELLED",
    payload: {
      loadId: load.id,
      reason: reason ?? null,
    },
  });
}
