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

async function assertProfile() {
  const { profile } = await getUserProfile();
  if (!profile) {
    throw new Error("Profile required for packing operations.");
  }
  return profile;
}

async function fetchPallet(palletId: string, tenantId: string) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("pallets")
    .select("id, code, status, tenant_id")
    .eq("tenant_id", tenantId)
    .eq("id", palletId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    throw new Error("Pallet not found.");
  }
  return data;
}

function ensurePalletOpen(status: string) {
  if (status !== "open") {
    throw new Error("This action is only allowed on open pallets.");
  }
}

export async function createLocation({
  code,
  type,
  capacityPallets,
  status = "active",
}: {
  code: string;
  type?: string | null;
  capacityPallets?: number | null;
  status?: string;
}) {
  if (!code.trim()) {
    throw new Error("Location code is required.");
  }

  const profile = await assertProfile();
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("pack_locations")
    .upsert(
      {
        tenant_id: profile.tenant_id,
        code: code.trim(),
        type: type?.trim() || null,
        capacity_pallets: capacityPallets ?? null,
        status: status?.trim() || "active",
      },
      { onConflict: "tenant_id,code" },
    )
    .select("id, code, capacity_pallets")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    throw new Error("Failed to create location.");
  }

  return {
    id: data.id,
    code: data.code,
    capacity_pallets: data.capacity_pallets,
  };
}

export async function createPallet({
  code,
  productSku,
  grade,
  capacityUnits,
  locationId,
}: {
  code: string;
  productSku: string;
  grade: string;
  capacityUnits?: number | null;
  locationId?: string | null;
}) {
  if (!code.trim()) {
    throw new Error("Pallet code is required.");
  }
  if (!productSku.trim()) {
    throw new Error("Product SKU is required.");
  }
  if (!grade.trim()) {
    throw new Error("Grade is required.");
  }

  const profile = await assertProfile();
  const supabase = await createServerSupabaseClient();
  const normalizedSku = productSku.trim();
  const normalizedGrade = grade.trim();
  const normalizedCode = code.trim();
  const normalizedLocation = locationId?.trim() || null;

  const { data, error } = await supabase
    .from("pallets")
    .insert({
      tenant_id: profile.tenant_id,
      code: normalizedCode,
      product_sku: normalizedSku,
      grade: normalizedGrade,
      capacity_units: capacityUnits ?? null,
      location_id: normalizedLocation,
      status: "open",
    })
    .select("id, code")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    throw new Error("Failed to create pallet.");
  }

  await logEvent(supabase, {
    aggregateType: "pallet",
    aggregateId: data.id,
    eventType: "PACK_PALLET_CREATED",
    payload: {
      palletId: data.id,
      palletCode: data.code,
      productSku: normalizedSku,
      grade: normalizedGrade,
      capacityUnits: capacityUnits ?? null,
      locationId: normalizedLocation,
    },
  });

  return data;
}

export async function addInput({
  palletId,
  kilnBatchId,
  quantityUnits,
  reference,
}: {
  palletId: string;
  kilnBatchId: string;
  quantityUnits: number;
  reference?: string | null;
}) {
  ensurePositive(quantityUnits, "Quantity");

  const profile = await assertProfile();
  const pallet = await fetchPallet(palletId, profile.tenant_id);
  ensurePalletOpen(pallet.status);

  const supabase = await createServerSupabaseClient();

  const { data: kilnBatch, error: kilnError } = await supabase
    .from("kiln_batches")
    .select("id, code, status")
    .eq("tenant_id", profile.tenant_id)
    .eq("id", kilnBatchId)
    .maybeSingle();

  if (kilnError) {
    throw new Error(kilnError.message);
  }
  if (!kilnBatch) {
    throw new Error("Kiln batch not found.");
  }

  const { data: availabilityRow, error: availabilityError } = await supabase
    .from("kiln_available_for_packing_v")
    .select("available_units")
    .eq("tenant_id", profile.tenant_id)
    .eq("kiln_batch_id", kilnBatchId)
    .maybeSingle();

  if (availabilityError && availabilityError.code !== VIEW_MISSING_CODE) {
    throw new Error(availabilityError.message);
  }

  const availableUnits = Number(availabilityRow?.available_units ?? 0);
  if (availabilityError?.code !== VIEW_MISSING_CODE && availableUnits < quantityUnits) {
    throw new Error(
      `Only ${availableUnits.toFixed(0)} units available from kiln batch ${kilnBatch.code}.`,
    );
  }

  await logEvent(supabase, {
    aggregateType: "pallet",
    aggregateId: pallet.id,
    eventType: "PACK_INPUT_ADDED",
    payload: {
      palletId: pallet.id,
      palletCode: pallet.code,
      kilnBatchId,
      kilnBatchCode: kilnBatch.code ?? null,
      quantityUnits,
      reference: reference ?? null,
    },
    correlationId: randomUUID(),
  });
}

export async function gradePallet({
  palletId,
  grade,
}: {
  palletId: string;
  grade: string;
}) {
  if (!grade.trim()) {
    throw new Error("Grade is required.");
  }

  const profile = await assertProfile();
  const pallet = await fetchPallet(palletId, profile.tenant_id);

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from("pallets")
    .update({ grade: grade.trim() })
    .eq("tenant_id", profile.tenant_id)
    .eq("id", pallet.id);

  if (error) {
    throw new Error(error.message);
  }

  await logEvent(supabase, {
    aggregateType: "pallet",
    aggregateId: pallet.id,
    eventType: "PACK_PALLET_GRADED",
    payload: {
      palletId: pallet.id,
      grade: grade.trim(),
    },
  });
}

export async function movePallet({
  palletId,
  toLocationId,
}: {
  palletId: string;
  toLocationId: string;
}) {
  if (!toLocationId.trim()) {
    throw new Error("Destination location is required.");
  }

  const profile = await assertProfile();
  const pallet = await fetchPallet(palletId, profile.tenant_id);
  ensurePalletOpen(pallet.status);

  const supabase = await createServerSupabaseClient();
  const nextLocationId = toLocationId.trim();

  const { error } = await supabase
    .from("pallets")
    .update({ location_id: nextLocationId })
    .eq("tenant_id", profile.tenant_id)
    .eq("id", pallet.id);

  if (error) {
    throw new Error(error.message);
  }

  await logEvent(supabase, {
    aggregateType: "pallet",
    aggregateId: pallet.id,
    eventType: "PACK_PALLET_MOVED",
    payload: {
      palletId: pallet.id,
      toLocationId: nextLocationId,
    },
  });
}

export async function printLabel({
  palletId,
  labelType,
}: {
  palletId: string;
  labelType?: string | null;
}) {
  const profile = await assertProfile();
  const pallet = await fetchPallet(palletId, profile.tenant_id);

  const supabase = await createServerSupabaseClient();
  await logEvent(supabase, {
    aggregateType: "pallet",
    aggregateId: pallet.id,
    eventType: "PACK_LABEL_PRINTED",
    payload: {
      palletId: pallet.id,
      labelType: labelType?.trim() || null,
    },
  });
}

export async function reserveUnits({
  palletId,
  orderId,
  quantityUnits,
}: {
  palletId: string;
  orderId: string;
  quantityUnits: number;
}) {
  ensurePositive(quantityUnits, "Quantity");
  if (!orderId.trim()) {
    throw new Error("Order reference is required.");
  }

  const profile = await assertProfile();
  const pallet = await fetchPallet(palletId, profile.tenant_id);

  const supabase = await createServerSupabaseClient();
  const { data: inventoryRow, error } = await supabase
    .from("pallet_inventory_v")
    .select("units_available")
    .eq("tenant_id", profile.tenant_id)
    .eq("pallet_id", pallet.id)
    .maybeSingle();

  if (error && error.code !== VIEW_MISSING_CODE) {
    throw new Error(error.message);
  }

  const available = Number(inventoryRow?.units_available ?? 0);
  if (available < quantityUnits) {
    throw new Error(
      `Only ${available.toFixed(0)} units available for reservation on pallet ${pallet.code}.`,
    );
  }

  const orderRef = orderId.trim();

  await logEvent(supabase, {
    aggregateType: "pallet",
    aggregateId: pallet.id,
    eventType: "PACK_PALLET_RESERVED",
    payload: {
      palletId: pallet.id,
      orderId: orderRef,
      quantityUnits,
    },
  });
}

export async function releaseReservation({
  palletId,
  orderId,
  quantityUnits,
}: {
  palletId: string;
  orderId: string;
  quantityUnits: number;
}) {
  ensurePositive(quantityUnits, "Quantity");
  if (!orderId.trim()) {
    throw new Error("Order reference is required.");
  }

  const profile = await assertProfile();
  const pallet = await fetchPallet(palletId, profile.tenant_id);

  const supabase = await createServerSupabaseClient();
  const orderRef = orderId.trim();
  await logEvent(supabase, {
    aggregateType: "pallet",
    aggregateId: pallet.id,
    eventType: "PACK_PALLET_RESERVATION_RELEASED",
    payload: {
      palletId: pallet.id,
      orderId: orderRef,
      quantityUnits,
    },
  });
}

export async function scrapUnits({
  palletId,
  scrapUnits,
  reason,
}: {
  palletId: string;
  scrapUnits: number;
  reason?: string | null;
}) {
  ensurePositive(scrapUnits, "Scrap units");

  const profile = await assertProfile();
  const pallet = await fetchPallet(palletId, profile.tenant_id);

  const supabase = await createServerSupabaseClient();
  await logEvent(supabase, {
    aggregateType: "pallet",
    aggregateId: pallet.id,
    eventType: "PACK_SCRAP_RECORDED",
    payload: {
      palletId: pallet.id,
      scrapUnits,
      reason: reason?.trim() || null,
    },
  });
}

export async function closePallet({ palletId }: { palletId: string }) {
  const profile = await assertProfile();
  const pallet = await fetchPallet(palletId, profile.tenant_id);
  ensurePalletOpen(pallet.status);

  const supabase = await createServerSupabaseClient();
  const closedAt = new Date().toISOString();

  const { error } = await supabase
    .from("pallets")
    .update({ status: "closed", closed_at: closedAt })
    .eq("tenant_id", profile.tenant_id)
    .eq("id", pallet.id);

  if (error) {
    throw new Error(error.message);
  }

  await logEvent(supabase, {
    aggregateType: "pallet",
    aggregateId: pallet.id,
    eventType: "PACK_PALLET_CLOSED",
    payload: {
      palletId: pallet.id,
      closedAt,
    },
  });
}

export async function cancelPallet({
  palletId,
  reason,
}: {
  palletId: string;
  reason?: string | null;
}) {
  const profile = await assertProfile();
  const pallet = await fetchPallet(palletId, profile.tenant_id);

  const supabase = await createServerSupabaseClient();

  const { error } = await supabase
    .from("pallets")
    .update({ status: "cancelled" })
    .eq("tenant_id", profile.tenant_id)
    .eq("id", pallet.id);

  if (error) {
    throw new Error(error.message);
  }

  await logEvent(supabase, {
    aggregateType: "pallet",
    aggregateId: pallet.id,
    eventType: "PACK_PALLET_CANCELLED",
    payload: {
      palletId: pallet.id,
      reason: reason?.trim() || null,
    },
  });
}
