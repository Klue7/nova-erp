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
    throw new Error("Profile required for extrusion operations.");
  }
  return profile;
}

async function fetchRun(runId: string, tenantId: string) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("extrusion_runs")
    .select("id, code, status, tenant_id")
    .eq("id", runId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    throw new Error("Extrusion run not found.");
  }
  return data;
}

async function fetchCrushAvailability(
  crushRunId: string,
  tenantId: string,
): Promise<{ id: string; code: string; availableTonnes: number | null }> {
  const supabase = await createServerSupabaseClient();

  const { data: crushRun, error: crushError } = await supabase
    .from("crush_runs")
    .select("id, code")
    .eq("tenant_id", tenantId)
    .eq("id", crushRunId)
    .maybeSingle();

  if (crushError) {
    throw new Error(crushError.message);
  }
  if (!crushRun) {
    throw new Error("Crushing run not found.");
  }

  const { data: outputsRow, error: outputsError } = await supabase
    .from("crush_outputs_v")
    .select("output_tonnes")
    .eq("tenant_id", tenantId)
    .eq("run_id", crushRunId)
    .maybeSingle();

  if (outputsError && outputsError.code !== VIEW_MISSING_CODE) {
    throw new Error(outputsError.message);
  }

  const producedTonnes =
    outputsError?.code === VIEW_MISSING_CODE
      ? null
      : Number(outputsRow?.output_tonnes ?? 0);

  if (producedTonnes !== null && producedTonnes <= 0) {
    throw new Error("Crushing run has not produced output yet.");
  }

  const { data: availabilityRow, error: availabilityError } = await supabase
    .from("crush_available_for_extrusion_v")
    .select("available_tonnes")
    .eq("tenant_id", tenantId)
    .eq("crush_run_id", crushRunId)
    .maybeSingle();

  if (availabilityError && availabilityError.code !== VIEW_MISSING_CODE) {
    throw new Error(availabilityError.message);
  }

  const availableTonnes =
    availabilityError?.code === VIEW_MISSING_CODE
      ? null
      : Number(availabilityRow?.available_tonnes ?? 0);

  return {
    id: crushRun.id,
    code: crushRun.code,
    availableTonnes: Number.isFinite(availableTonnes) ? availableTonnes : null,
  };
}

export async function createRun({
  code,
  pressLine,
  dieCode,
  productSku,
  targetUnits,
}: {
  code: string;
  pressLine?: string | null;
  dieCode?: string | null;
  productSku?: string | null;
  targetUnits?: number | null;
}) {
  if (!code.trim()) {
    throw new Error("Run code is required.");
  }

  const profile = await assertProfile();
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("extrusion_runs")
    .upsert(
      {
        tenant_id: profile.tenant_id,
        code: code.trim(),
        press_line: pressLine?.trim() || null,
        die_code: dieCode?.trim() || null,
        product_sku: productSku?.trim() || null,
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
    throw new Error("Failed to create extrusion run.");
  }

  await logEvent(supabase, {
    aggregateType: "extrusion_run",
    aggregateId: data.id,
    eventType: "EXTRUSION_RUN_CREATED",
    payload: {
      runId: data.id,
      runCode: data.code,
      pressLine: pressLine ?? null,
      dieCode: dieCode ?? null,
      productSku: productSku ?? null,
      targetUnits: targetUnits ?? null,
    },
  });

  return data;
}

export async function addInput({
  runId,
  crushRunId,
  quantityTonnes,
  reference,
}: {
  runId: string;
  crushRunId: string;
  quantityTonnes: number;
  reference?: string | null;
}) {
  ensurePositive(quantityTonnes, "Quantity");

  const profile = await assertProfile();
  const run = await fetchRun(runId, profile.tenant_id);
  const crushRun = await fetchCrushAvailability(crushRunId, profile.tenant_id);

  if (
    crushRun.availableTonnes !== null &&
    crushRun.availableTonnes < quantityTonnes
  ) {
    throw new Error(
      `Insufficient crushed output. ${crushRun.availableTonnes.toFixed(2)} t remaining.`,
    );
  }

  const supabase = await createServerSupabaseClient();
  await logEvent(supabase, {
    aggregateType: "extrusion_run",
    aggregateId: run.id,
    eventType: "EXTRUSION_INPUT_ADDED",
    payload: {
      runId: run.id,
      runCode: run.code,
      crushRunId: crushRun.id,
      crushRunCode: crushRun.code,
      quantityTonnes,
      reference: reference ?? null,
    },
    correlationId: randomUUID(),
  });
}

export async function startRun({ runId }: { runId: string }) {
  const profile = await assertProfile();
  const run = await fetchRun(runId, profile.tenant_id);
  const supabase = await createServerSupabaseClient();

  const { error } = await supabase
    .from("extrusion_runs")
    .update({ status: "active", started_at: new Date().toISOString() })
    .eq("id", run.id)
    .eq("tenant_id", profile.tenant_id);

  if (error) {
    throw new Error(error.message);
  }

  await logEvent(supabase, {
    aggregateType: "extrusion_run",
    aggregateId: run.id,
    eventType: "EXTRUSION_RUN_STARTED",
    payload: {
      runId: run.id,
      startedAt: new Date().toISOString(),
    },
  });
}

export async function pauseRun({
  runId,
  minutes,
  reason,
}: {
  runId: string;
  minutes: number;
  reason?: string | null;
}) {
  ensurePositive(minutes, "Pause duration");

  const profile = await assertProfile();
  const run = await fetchRun(runId, profile.tenant_id);
  const supabase = await createServerSupabaseClient();

  const { error } = await supabase
    .from("extrusion_runs")
    .update({ status: "paused" })
    .eq("id", run.id)
    .eq("tenant_id", profile.tenant_id);

  if (error) {
    throw new Error(error.message);
  }

  await logEvent(supabase, {
    aggregateType: "extrusion_run",
    aggregateId: run.id,
    eventType: "EXTRUSION_RUN_PAUSED",
    payload: {
      runId: run.id,
      minutes,
      reason: reason ?? null,
    },
  });
}

export async function resumeRun({ runId }: { runId: string }) {
  const profile = await assertProfile();
  const run = await fetchRun(runId, profile.tenant_id);
  const supabase = await createServerSupabaseClient();

  const { error } = await supabase
    .from("extrusion_runs")
    .update({ status: "active" })
    .eq("id", run.id)
    .eq("tenant_id", profile.tenant_id);

  if (error) {
    throw new Error(error.message);
  }

  await logEvent(supabase, {
    aggregateType: "extrusion_run",
    aggregateId: run.id,
    eventType: "EXTRUSION_RUN_RESUMED",
    payload: {
      runId: run.id,
    },
  });
}

export async function recordOutput({
  runId,
  outputUnits,
  meters,
  weightTonnes,
}: {
  runId: string;
  outputUnits: number;
  meters?: number | null;
  weightTonnes?: number | null;
}) {
  ensureNonNegative(outputUnits, "Output units");

  const profile = await assertProfile();
  const run = await fetchRun(runId, profile.tenant_id);
  const supabase = await createServerSupabaseClient();

  await logEvent(supabase, {
    aggregateType: "extrusion_run",
    aggregateId: run.id,
    eventType: "EXTRUSION_OUTPUT_RECORDED",
    payload: {
      runId: run.id,
      outputUnits,
      meters: meters ?? null,
      weightTonnes: weightTonnes ?? null,
    },
  });
}

export async function recordScrap({
  runId,
  scrapUnits,
  reason,
}: {
  runId: string;
  scrapUnits: number;
  reason?: string | null;
}) {
  ensurePositive(scrapUnits, "Scrap units");

  const profile = await assertProfile();
  const run = await fetchRun(runId, profile.tenant_id);
  const supabase = await createServerSupabaseClient();

  await logEvent(supabase, {
    aggregateType: "extrusion_run",
    aggregateId: run.id,
    eventType: "EXTRUSION_SCRAP_RECORDED",
    payload: {
      runId: run.id,
      scrapUnits,
      reason: reason ?? null,
    },
  });
}

export async function changeDie({
  runId,
  dieCode,
}: {
  runId: string;
  dieCode: string;
}) {
  if (!dieCode.trim()) {
    throw new Error("Die code is required.");
  }

  const profile = await assertProfile();
  const run = await fetchRun(runId, profile.tenant_id);
  const supabase = await createServerSupabaseClient();

  const { error } = await supabase
    .from("extrusion_runs")
    .update({ die_code: dieCode.trim() })
    .eq("id", run.id)
    .eq("tenant_id", profile.tenant_id);

  if (error) {
    throw new Error(error.message);
  }

  await logEvent(supabase, {
    aggregateType: "extrusion_run",
    aggregateId: run.id,
    eventType: "EXTRUSION_DIE_CHANGED",
    payload: {
      runId: run.id,
      dieCode: dieCode.trim(),
    },
  });
}

export async function completeRun({ runId }: { runId: string }) {
  const profile = await assertProfile();
  const run = await fetchRun(runId, profile.tenant_id);
  const supabase = await createServerSupabaseClient();
  const completedAt = new Date().toISOString();

  const { error } = await supabase
    .from("extrusion_runs")
    .update({ status: "completed", completed_at: completedAt })
    .eq("id", run.id)
    .eq("tenant_id", profile.tenant_id);

  if (error) {
    throw new Error(error.message);
  }

  await logEvent(supabase, {
    aggregateType: "extrusion_run",
    aggregateId: run.id,
    eventType: "EXTRUSION_RUN_COMPLETED",
    payload: {
      runId: run.id,
      completedAt,
    },
  });
}

export async function cancelRun({
  runId,
  reason,
}: {
  runId: string;
  reason?: string | null;
}) {
  const profile = await assertProfile();
  const run = await fetchRun(runId, profile.tenant_id);
  const supabase = await createServerSupabaseClient();

  const { error } = await supabase
    .from("extrusion_runs")
    .update({ status: "cancelled" })
    .eq("id", run.id)
    .eq("tenant_id", profile.tenant_id);

  if (error) {
    throw new Error(error.message);
  }

  await logEvent(supabase, {
    aggregateType: "extrusion_run",
    aggregateId: run.id,
    eventType: "EXTRUSION_RUN_CANCELLED",
    payload: {
      runId: run.id,
      reason: reason ?? null,
    },
  });
}
