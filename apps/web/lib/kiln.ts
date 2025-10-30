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

function ensureNonNegative(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} cannot be negative.`);
  }
}

async function assertProfile() {
  const { profile } = await getUserProfile();
  if (!profile) {
    throw new Error("Profile required for kiln operations.");
  }
  return profile;
}

async function fetchBatch(batchId: string, tenantId: string) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("kiln_batches")
    .select("id, code, status, tenant_id")
    .eq("tenant_id", tenantId)
    .eq("id", batchId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    throw new Error("Kiln batch not found.");
  }
  return data;
}

export async function createBatch({
  code,
  kilnCode,
  firingCurveCode,
  targetUnits,
}: {
  code: string;
  kilnCode?: string | null;
  firingCurveCode?: string | null;
  targetUnits?: number | null;
}) {
  if (!code.trim()) {
    throw new Error("Batch code is required.");
  }

  const profile = await assertProfile();
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("kiln_batches")
    .upsert(
      {
        tenant_id: profile.tenant_id,
        code: code.trim(),
        kiln_code: kilnCode?.trim() || null,
        firing_curve_code: firingCurveCode?.trim() || null,
        target_units: targetUnits ?? null,
        status: "planned",
      },
      { onConflict: "tenant_id,code" },
    )
    .select("id, code")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    throw new Error("Failed to create kiln batch.");
  }

  await logEvent(await createServerSupabaseClient(), {
    aggregateType: "kiln_batch",
    aggregateId: data.id,
    eventType: "KILN_BATCH_CREATED",
    payload: {
      batchId: data.id,
      batchCode: data.code,
      kilnCode: kilnCode ?? null,
      firingCurveCode: firingCurveCode ?? null,
      targetUnits: targetUnits ?? null,
    },
  });

  return data;
}

export async function addInput({
  batchId,
  dryLoadId,
  quantityUnits,
  reference,
}: {
  batchId: string;
  dryLoadId: string;
  quantityUnits: number;
  reference?: string | null;
}) {
  ensurePositive(quantityUnits, "Quantity");

  const profile = await assertProfile();
  const batch = await fetchBatch(batchId, profile.tenant_id);

  if (batch.status === "completed" || batch.status === "cancelled") {
    throw new Error("Cannot add input to a closed batch.");
  }

  const supabase = await createServerSupabaseClient();

  const { data: loadRow, error: loadError } = await supabase
    .from("dry_loads")
    .select("id, code, completed_at")
    .eq("tenant_id", profile.tenant_id)
    .eq("id", dryLoadId)
    .maybeSingle();

  if (loadError) {
    throw new Error(loadError.message);
  }
  if (!loadRow || !loadRow.completed_at) {
    throw new Error("Dry load must be completed before feeding kiln.");
  }

  const { data: availabilityRow, error: availabilityError } = await supabase
    .from("dry_available_for_kiln_v")
    .select("available_units")
    .eq("tenant_id", profile.tenant_id)
    .eq("load_id", dryLoadId)
    .maybeSingle();

  if (availabilityError && availabilityError.code !== VIEW_MISSING_CODE) {
    throw new Error(availabilityError.message);
  }

  const availableUnits =
    availabilityError?.code === VIEW_MISSING_CODE
      ? 0
      : Number(availabilityRow?.available_units ?? 0);

  if (availableUnits < quantityUnits) {
    throw new Error(
      `Dry load only has ${availableUnits.toFixed(0)} units available.`,
    );
  }

  await logEvent(supabase, {
    aggregateType: "kiln_batch",
    aggregateId: batch.id,
    eventType: "KILN_INPUT_ADDED",
    payload: {
      batchId: batch.id,
      dryLoadId,
      dryLoadCode: loadRow.code ?? null,
      quantityUnits,
      reference: reference ?? null,
    },
    correlationId: randomUUID(),
  });
}

export async function startBatch({ batchId }: { batchId: string }) {
  const profile = await assertProfile();
  const batch = await fetchBatch(batchId, profile.tenant_id);

  if (batch.status === "completed" || batch.status === "cancelled") {
    throw new Error("Batch already closed.");
  }

  const supabase = await createServerSupabaseClient();
  const startedAt = new Date().toISOString();

  const { error } = await supabase
    .from("kiln_batches")
    .update({ status: "active", started_at: startedAt })
    .eq("tenant_id", profile.tenant_id)
    .eq("id", batch.id);

  if (error) {
    throw new Error(error.message);
  }

  await logEvent(supabase, {
    aggregateType: "kiln_batch",
    aggregateId: batch.id,
    eventType: "KILN_BATCH_STARTED",
    payload: {
      batchId: batch.id,
      startedAt,
    },
  });
}

export async function pauseBatch({
  batchId,
  minutes,
  reason,
}: {
  batchId: string;
  minutes: number;
  reason: string;
}) {
  ensurePositive(minutes, "Downtime minutes");

  const profile = await assertProfile();
  const batch = await fetchBatch(batchId, profile.tenant_id);

  if (batch.status !== "active") {
    throw new Error("Only active batches can be paused.");
  }

  const supabase = await createServerSupabaseClient();

  const { error } = await supabase
    .from("kiln_batches")
    .update({ status: "paused" })
    .eq("tenant_id", profile.tenant_id)
    .eq("id", batch.id);

  if (error) {
    throw new Error(error.message);
  }

  await logEvent(supabase, {
    aggregateType: "kiln_batch",
    aggregateId: batch.id,
    eventType: "KILN_BATCH_PAUSED",
    payload: {
      batchId: batch.id,
      minutes,
      reason,
    },
  });
}

export async function resumeBatch({ batchId }: { batchId: string }) {
  const profile = await assertProfile();
  const batch = await fetchBatch(batchId, profile.tenant_id);

  if (batch.status !== "paused") {
    throw new Error("Only paused batches can be resumed.");
  }

  const supabase = await createServerSupabaseClient();

  const { error } = await supabase
    .from("kiln_batches")
    .update({ status: "active" })
    .eq("tenant_id", profile.tenant_id)
    .eq("id", batch.id);

  if (error) {
    throw new Error(error.message);
  }

  await logEvent(supabase, {
    aggregateType: "kiln_batch",
    aggregateId: batch.id,
    eventType: "KILN_BATCH_RESUMED",
    payload: {
      batchId: batch.id,
    },
  });
}

export async function recordZoneTemp({
  batchId,
  zone,
  temperatureC,
}: {
  batchId: string;
  zone: string;
  temperatureC: number;
}) {
  ensurePositive(temperatureC, "Temperature");

  const profile = await assertProfile();
  const batch = await fetchBatch(batchId, profile.tenant_id);

  const supabase = await createServerSupabaseClient();

  await logEvent(supabase, {
    aggregateType: "kiln_batch",
    aggregateId: batch.id,
    eventType: "KILN_ZONE_TEMP_RECORDED",
    payload: {
      batchId: batch.id,
      zone,
      temperatureC,
    },
  });
}

export async function recordFuelUsage({
  batchId,
  fuelType,
  amount,
  unit,
}: {
  batchId: string;
  fuelType: string;
  amount: number;
  unit: string;
}) {
  ensurePositive(amount, "Fuel amount");

  const profile = await assertProfile();
  const batch = await fetchBatch(batchId, profile.tenant_id);

  const supabase = await createServerSupabaseClient();

  await logEvent(supabase, {
    aggregateType: "kiln_batch",
    aggregateId: batch.id,
    eventType: "KILN_FUEL_USAGE_RECORDED",
    payload: {
      batchId: batch.id,
      fuelType,
      amount,
      unit,
    },
  });
}

export async function recordOutput({
  batchId,
  firedUnits,
  shrinkagePct,
}: {
  batchId: string;
  firedUnits: number;
  shrinkagePct?: number | null;
}) {
  ensureNonNegative(firedUnits, "Fired units");

  const profile = await assertProfile();
  const batch = await fetchBatch(batchId, profile.tenant_id);

  const supabase = await createServerSupabaseClient();

  await logEvent(supabase, {
    aggregateType: "kiln_batch",
    aggregateId: batch.id,
    eventType: "KILN_OUTPUT_RECORDED",
    payload: {
      batchId: batch.id,
      firedUnits,
      shrinkagePct: shrinkagePct ?? null,
    },
  });
}

export async function completeBatch({ batchId }: { batchId: string }) {
  const profile = await assertProfile();
  const batch = await fetchBatch(batchId, profile.tenant_id);

  if (batch.status === "completed") {
    return;
  }

  const supabase = await createServerSupabaseClient();
  const completedAt = new Date().toISOString();

  const { error } = await supabase
    .from("kiln_batches")
    .update({ status: "completed", completed_at: completedAt })
    .eq("tenant_id", profile.tenant_id)
    .eq("id", batch.id);

  if (error) {
    throw new Error(error.message);
  }

  await logEvent(supabase, {
    aggregateType: "kiln_batch",
    aggregateId: batch.id,
    eventType: "KILN_BATCH_COMPLETED",
    payload: {
      batchId: batch.id,
      completedAt,
    },
  });
}

export async function cancelBatch({
  batchId,
  reason,
}: {
  batchId: string;
  reason?: string | null;
}) {
  const profile = await assertProfile();
  const batch = await fetchBatch(batchId, profile.tenant_id);

  if (batch.status === "cancelled") {
    return;
  }

  const supabase = await createServerSupabaseClient();

  const { error } = await supabase
    .from("kiln_batches")
    .update({ status: "cancelled" })
    .eq("tenant_id", profile.tenant_id)
    .eq("id", batch.id);

  if (error) {
    throw new Error(error.message);
  }

  await logEvent(supabase, {
    aggregateType: "kiln_batch",
    aggregateId: batch.id,
    eventType: "KILN_BATCH_CANCELLED",
    payload: {
      batchId: batch.id,
      reason: reason ?? null,
    },
  });
}
