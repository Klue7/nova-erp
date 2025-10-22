import { randomUUID } from "node:crypto";

import { getUserProfile } from "@/lib/rbac";
import { logEvent } from "@/lib/events";
import { createServerSupabaseClient } from "@/utils/supabase/server";

const VIEW_MISSING_CODE = "42P01";

function ensurePositive(quantity: number, label: string) {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error(`${label} must be greater than zero.`);
  }
}

async function assertProfile() {
  const { profile } = await getUserProfile();
  if (!profile) {
    throw new Error("A profile is required to perform mixing operations.");
  }
  return profile;
}

async function fetchBatch(batchId: string, tenantId: string) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("mix_batches")
    .select("id, code, status, tenant_id, target_output_tonnes")
    .eq("id", batchId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    throw new Error("Batch not found.");
  }
  return data;
}

async function fetchStockpile(stockpileId: string, tenantId: string) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("stockpiles")
    .select("id, code")
    .eq("id", stockpileId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    throw new Error("Stockpile not found.");
  }
  return data;
}

async function verifyStockpileAvailability(
  stockpileId: string,
  tenantId: string,
  quantityTonnes: number,
) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("stockpile_balances_v")
    .select("available_tonnes")
    .eq("tenant_id", tenantId)
    .eq("stockpile_id", stockpileId)
    .maybeSingle();

  if (error) {
    if (error.code === VIEW_MISSING_CODE) {
      return;
    }
    throw new Error(error.message);
  }

  const available = data?.available_tonnes ?? 0;
  if (available < quantityTonnes) {
    throw new Error(
      `Insufficient stockpile inventory. Available ${available} t, requested ${quantityTonnes} t.`,
    );
  }
}

export async function createBatch({
  code,
  targetOutputTonnes,
}: {
  code: string;
  targetOutputTonnes?: number | null;
}) {
  if (!code.trim()) {
    throw new Error("Batch code is required.");
  }

  const profile = await assertProfile();
  const supabase = await createServerSupabaseClient();

  const payload = {
    tenant_id: profile.tenant_id,
    code: code.trim(),
    target_output_tonnes: targetOutputTonnes ?? null,
    status: "planned",
  };

  const { data, error } = await supabase
    .from("mix_batches")
    .upsert(payload, { onConflict: "tenant_id,code" })
    .select("id, code")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    throw new Error("Failed to create batch.");
  }

  await logEvent(supabase, {
    aggregateType: "mix_batch",
    aggregateId: data.id,
    eventType: "MIX_BATCH_CREATED",
    payload: {
      batchId: data.id,
      batchCode: data.code,
      targetOutputTonnes: targetOutputTonnes ?? null,
    },
  });

  return data;
}

export async function addComponent({
  batchId,
  stockpileId,
  quantityTonnes,
  materialType,
  reference,
}: {
  batchId: string;
  stockpileId: string;
  quantityTonnes: number;
  materialType: string;
  reference?: string | null;
}) {
  ensurePositive(quantityTonnes, "Quantity");
  if (!materialType.trim()) {
    throw new Error("Material type is required.");
  }
  const profile = await assertProfile();
  const batch = await fetchBatch(batchId, profile.tenant_id);
  const stockpile = await fetchStockpile(stockpileId, profile.tenant_id);
  await verifyStockpileAvailability(stockpileId, profile.tenant_id, quantityTonnes);

  const supabase = await createServerSupabaseClient();
  const correlationId = randomUUID();

  await logEvent(supabase, {
    aggregateType: "mix_batch",
    aggregateId: batch.id,
    eventType: "MIX_COMPONENT_ADDED",
    payload: {
      batchId: batch.id,
      batchCode: batch.code,
      stockpileId: stockpile.id,
      stockpileCode: stockpile.code,
      materialType: materialType.trim(),
      quantityTonnes,
      reference: reference ?? null,
    },
    correlationId,
  });

  await logEvent(supabase, {
    aggregateType: "stockpile",
    aggregateId: stockpile.id,
    eventType: "STOCKPILE_TRANSFERRED_OUT",
    payload: {
      stockpileId: stockpile.id,
      stockpileCode: stockpile.code,
      quantityTonnes,
      reference: reference ?? null,
      toBatchId: batch.id,
    },
    correlationId,
  });
}

export async function removeComponent({
  batchId,
  stockpileId,
  quantityTonnes,
  reference,
}: {
  batchId: string;
  stockpileId: string;
  quantityTonnes: number;
  reference?: string | null;
}) {
  ensurePositive(quantityTonnes, "Quantity");
  const profile = await assertProfile();
  const batch = await fetchBatch(batchId, profile.tenant_id);
  const stockpile = await fetchStockpile(stockpileId, profile.tenant_id);

  const supabase = await createServerSupabaseClient();
  const correlationId = randomUUID();

  await logEvent(supabase, {
    aggregateType: "mix_batch",
    aggregateId: batch.id,
    eventType: "MIX_COMPONENT_REMOVED",
    payload: {
      batchId: batch.id,
      batchCode: batch.code,
      stockpileId: stockpile.id,
      stockpileCode: stockpile.code,
      quantityTonnes,
      reference: reference ?? null,
    },
    correlationId,
  });

  await logEvent(supabase, {
    aggregateType: "stockpile",
    aggregateId: stockpile.id,
    eventType: "STOCKPILE_TRANSFERRED_IN",
    payload: {
      stockpileId: stockpile.id,
      stockpileCode: stockpile.code,
      quantityTonnes,
      reference: reference ?? null,
      fromBatchId: batch.id,
    },
    correlationId,
  });
}

export async function startBatch({ batchId }: { batchId: string }) {
  const profile = await assertProfile();
  const batch = await fetchBatch(batchId, profile.tenant_id);
  if (batch.status !== "planned") {
    throw new Error("Only planned batches can be started.");
  }
  const supabase = await createServerSupabaseClient();
  const startedAt = new Date().toISOString();

  const { error } = await supabase
    .from("mix_batches")
    .update({ status: "active", started_at: startedAt })
    .eq("id", batch.id)
    .eq("tenant_id", profile.tenant_id);

  if (error) {
    throw new Error(error.message);
  }

  await logEvent(supabase, {
    aggregateType: "mix_batch",
    aggregateId: batch.id,
    eventType: "MIX_BATCH_STARTED",
    payload: {
      batchId: batch.id,
      batchCode: batch.code,
      startedAt,
    },
  });
}

export async function completeBatch({
  batchId,
  outputTonnes,
  moisturePct,
}: {
  batchId: string;
  outputTonnes?: number | null;
  moisturePct?: number | null;
}) {
  const profile = await assertProfile();
  const batch = await fetchBatch(batchId, profile.tenant_id);
  if (batch.status !== "active") {
    throw new Error("Only active batches can be completed.");
  }
  const supabase = await createServerSupabaseClient();
  const completedAt = new Date().toISOString();

  const { error } = await supabase
    .from("mix_batches")
    .update({ status: "completed", completed_at: completedAt })
    .eq("id", batch.id)
    .eq("tenant_id", profile.tenant_id);

  if (error) {
    throw new Error(error.message);
  }

  await logEvent(supabase, {
    aggregateType: "mix_batch",
    aggregateId: batch.id,
    eventType: "MIX_BATCH_COMPLETED",
    payload: {
      batchId: batch.id,
      batchCode: batch.code,
      outputTonnes: outputTonnes ?? null,
      moisturePct: moisturePct ?? null,
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
  if (batch.status === "completed") {
    throw new Error("Completed batches cannot be cancelled.");
  }
  const supabase = await createServerSupabaseClient();

  const { error } = await supabase
    .from("mix_batches")
    .update({ status: "cancelled" })
    .eq("id", batch.id)
    .eq("tenant_id", profile.tenant_id);

  if (error) {
    throw new Error(error.message);
  }

  await logEvent(supabase, {
    aggregateType: "mix_batch",
    aggregateId: batch.id,
    eventType: "MIX_BATCH_CANCELLED",
    payload: {
      batchId: batch.id,
      batchCode: batch.code,
      reason: reason ?? null,
    },
  });
}
