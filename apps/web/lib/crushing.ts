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
    throw new Error("Profile required to perform crushing operations.");
  }
  return profile;
}

async function fetchRun(runId: string, tenantId: string) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("crush_runs")
    .select("id, code, status, tenant_id")
    .eq("id", runId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    throw new Error("Crushing run not found.");
  }
  return data;
}

async function fetchMixBatch(
  mixBatchId: string,
  tenantId: string,
): Promise<{ id: string; code: string; availableTonnes: number }> {
  const supabase = await createServerSupabaseClient();

  const { data: batch, error: batchError } = await supabase
    .from("mix_batches")
    .select("id, code")
    .eq("tenant_id", tenantId)
    .eq("id", mixBatchId)
    .maybeSingle();

  if (batchError) {
    throw new Error(batchError.message);
  }
  if (!batch) {
    throw new Error("Mix batch not found.");
  }

  const { data: statusRow, error: statusError } = await supabase
    .from("mix_status_latest")
    .select("status")
    .eq("tenant_id", tenantId)
    .eq("batch_id", mixBatchId)
    .maybeSingle();

  if (statusError && statusError.code !== VIEW_MISSING_CODE) {
    throw new Error(statusError.message);
  }

  if (statusRow && statusRow.status !== "completed") {
    throw new Error("Only completed mix batches can supply crushing input.");
  }

  const { data: availability, error: availabilityError } = await supabase
    .from("mix_available_for_crushing_v")
    .select("available_tonnes")
    .eq("tenant_id", tenantId)
    .eq("batch_id", mixBatchId)
    .maybeSingle();

  if (
    availabilityError &&
    availabilityError.code !== VIEW_MISSING_CODE
  ) {
    throw new Error(availabilityError.message);
  }

  const availableTonnes = Number(
    availability?.available_tonnes ?? (statusRow ? 0 : batch ? 0 : 0),
  );

  return {
    id: batch.id,
    code: batch.code,
    availableTonnes: Number.isFinite(availableTonnes)
      ? availableTonnes
      : 0,
  };
}

export async function createRun({
  code,
  targetTPH,
}: {
  code: string;
  targetTPH?: number | null;
}) {
  if (!code.trim()) {
    throw new Error("Run code is required.");
  }

  const profile = await assertProfile();
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("crush_runs")
    .upsert(
      {
        tenant_id: profile.tenant_id,
        code: code.trim(),
        target_tph: targetTPH ?? null,
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
    throw new Error("Failed to create crushing run.");
  }

  await logEvent(await createServerSupabaseClient(), {
    aggregateType: "crush_run",
    aggregateId: data.id,
    eventType: "CRUSH_RUN_CREATED",
    payload: {
      runId: data.id,
      runCode: data.code,
      targetTPH: targetTPH ?? null,
    },
  });

  return data;
}

export async function addInput({
  runId,
  mixBatchId,
  quantityTonnes,
  reference,
}: {
  runId: string;
  mixBatchId: string;
  quantityTonnes: number;
  reference?: string | null;
}) {
  ensurePositive(quantityTonnes, "Quantity");
  const profile = await assertProfile();
  const run = await fetchRun(runId, profile.tenant_id);
  const mixBatch = await fetchMixBatch(mixBatchId, profile.tenant_id);

  if (mixBatch.availableTonnes < quantityTonnes) {
    throw new Error(
      `Insufficient mix batch availability. ${mixBatch.availableTonnes.toFixed(2)} t remaining.`,
    );
  }

  const supabase = await createServerSupabaseClient();
  const correlationId = randomUUID();

  await logEvent(supabase, {
    aggregateType: "crush_run",
    aggregateId: run.id,
    eventType: "CRUSH_COMPONENT_ADDED",
    payload: {
      runId: run.id,
      runCode: run.code,
      mixBatchId: mixBatch.id,
      mixBatchCode: mixBatch.code,
      quantityTonnes,
      reference: reference ?? null,
    },
    correlationId,
  });
}

export async function startRun({ runId }: { runId: string }) {
  const profile = await assertProfile();
  const run = await fetchRun(runId, profile.tenant_id);

  if (run.status !== "planned") {
    throw new Error("Only planned runs can be started.");
  }

  const supabase = await createServerSupabaseClient();
  const startedAt = new Date().toISOString();

  const { error } = await supabase
    .from("crush_runs")
    .update({ status: "active", started_at: startedAt })
    .eq("id", run.id)
    .eq("tenant_id", profile.tenant_id);

  if (error) {
    throw new Error(error.message);
  }

  await logEvent(supabase, {
    aggregateType: "crush_run",
    aggregateId: run.id,
    eventType: "CRUSH_RUN_STARTED",
    payload: {
      runId: run.id,
      runCode: run.code,
      startedAt,
    },
  });
}

export async function logDowntime({
  runId,
  minutes,
  reason,
}: {
  runId: string;
  minutes: number;
  reason: string;
}) {
  ensurePositive(minutes, "Downtime minutes");
  if (!reason.trim()) {
    throw new Error("Provide a downtime reason.");
  }

  const profile = await assertProfile();
  const run = await fetchRun(runId, profile.tenant_id);
  const supabase = await createServerSupabaseClient();

  await logEvent(supabase, {
    aggregateType: "crush_run",
    aggregateId: run.id,
    eventType: "CRUSH_RUN_DOWNTIME_LOGGED",
    payload: {
      runId: run.id,
      runCode: run.code,
      minutes,
      reason,
    },
  });
}

export async function recordOutput({
  runId,
  outputTonnes,
  finesPct,
}: {
  runId: string;
  outputTonnes: number;
  finesPct?: number | null;
}) {
  ensureNonNegative(outputTonnes, "Output tonnes");
  if (finesPct !== undefined && finesPct !== null && !Number.isFinite(finesPct)) {
    throw new Error("Fines percent must be numeric if provided.");
  }

  const profile = await assertProfile();
  const run = await fetchRun(runId, profile.tenant_id);
  const supabase = await createServerSupabaseClient();

  await logEvent(supabase, {
    aggregateType: "crush_run",
    aggregateId: run.id,
    eventType: "CRUSH_RUN_OUTPUT_RECORDED",
    payload: {
      runId: run.id,
      runCode: run.code,
      outputTonnes,
      finesPct: finesPct ?? null,
    },
  });
}

export async function completeRun({ runId }: { runId: string }) {
  const profile = await assertProfile();
  const run = await fetchRun(runId, profile.tenant_id);

  if (run.status !== "active") {
    throw new Error("Only active runs can be completed.");
  }

  const supabase = await createServerSupabaseClient();
  const completedAt = new Date().toISOString();

  const { error } = await supabase
    .from("crush_runs")
    .update({ status: "completed", completed_at: completedAt })
    .eq("id", run.id)
    .eq("tenant_id", profile.tenant_id);

  if (error) {
    throw new Error(error.message);
  }

  await logEvent(supabase, {
    aggregateType: "crush_run",
    aggregateId: run.id,
    eventType: "CRUSH_RUN_COMPLETED",
    payload: {
      runId: run.id,
      runCode: run.code,
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

  if (run.status === "completed") {
    throw new Error("Completed runs cannot be cancelled.");
  }

  const supabase = await createServerSupabaseClient();

  const { error } = await supabase
    .from("crush_runs")
    .update({ status: "cancelled" })
    .eq("id", run.id)
    .eq("tenant_id", profile.tenant_id);

  if (error) {
    throw new Error(error.message);
  }

  await logEvent(supabase, {
    aggregateType: "crush_run",
    aggregateId: run.id,
    eventType: "CRUSH_RUN_CANCELLED",
    payload: {
      runId: run.id,
      runCode: run.code,
      reason: reason ?? null,
    },
  });
}
