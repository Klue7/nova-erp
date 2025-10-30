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
    throw new Error("Profile required for dispatch operations.");
  }
  return profile;
}

async function fetchShipment(shipmentId: string, tenantId: string) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("shipments")
    .select(
      "id, tenant_id, code, status, customer_code, customer_name, delivery_address, carrier, vehicle_reg, trailer_reg, seal_no",
    )
    .eq("tenant_id", tenantId)
    .eq("id", shipmentId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    throw new Error("Shipment not found.");
  }
  return data;
}

function assertShipmentMutable(status: string) {
  if (status === "dispatched") {
    throw new Error("Shipment already dispatched.");
  }
  if (status === "cancelled") {
    throw new Error("Shipment is cancelled.");
  }
}

export async function createShipment({
  code,
  customerCode,
  customerName,
  deliveryAddress,
}: {
  code: string;
  customerCode?: string | null;
  customerName?: string | null;
  deliveryAddress?: Record<string, unknown> | null;
}) {
  if (!code.trim()) {
    throw new Error("Shipment code is required.");
  }

  const profile = await assertProfile();
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("shipments")
    .insert({
      tenant_id: profile.tenant_id,
      code: code.trim(),
      customer_code: customerCode?.trim() || null,
      customer_name: customerName?.trim() || null,
      delivery_address: deliveryAddress ?? null,
      status: "planned",
    })
    .select("id, code")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    throw new Error("Failed to create shipment.");
  }

  await logEvent(supabase, {
    aggregateType: "shipment",
    aggregateId: data.id,
    eventType: "SHIPMENT_CREATED",
    payload: {
      shipmentId: data.id,
      shipmentCode: data.code,
      customerCode: customerCode?.trim() || null,
      customerName: customerName?.trim() || null,
    },
  });

  return data;
}

export async function setCarrier({
  shipmentId,
  carrier,
  vehicleReg,
  trailerReg,
  sealNo,
}: {
  shipmentId: string;
  carrier: string;
  vehicleReg?: string | null;
  trailerReg?: string | null;
  sealNo?: string | null;
}) {
  if (!carrier.trim()) {
    throw new Error("Carrier is required.");
  }
  const profile = await assertProfile();
  const shipment = await fetchShipment(shipmentId, profile.tenant_id);
  assertShipmentMutable(shipment.status);

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from("shipments")
    .update({
      carrier: carrier.trim(),
      vehicle_reg: vehicleReg?.trim() || null,
      trailer_reg: trailerReg?.trim() || null,
      seal_no: sealNo?.trim() || null,
    })
    .eq("tenant_id", profile.tenant_id)
    .eq("id", shipment.id);

  if (error) {
    throw new Error(error.message);
  }

  await logEvent(supabase, {
    aggregateType: "shipment",
    aggregateId: shipment.id,
    eventType: "SHIPMENT_CARRIER_SET",
    payload: {
      shipmentId: shipment.id,
      carrier: carrier.trim(),
      vehicleReg: vehicleReg?.trim() || null,
      trailerReg: trailerReg?.trim() || null,
      sealNo: sealNo?.trim() || null,
    },
  });
}

export async function setAddress({
  shipmentId,
  deliveryAddress,
}: {
  shipmentId: string;
  deliveryAddress: Record<string, unknown> | null;
}) {
  const profile = await assertProfile();
  const shipment = await fetchShipment(shipmentId, profile.tenant_id);
  assertShipmentMutable(shipment.status);

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from("shipments")
    .update({ delivery_address: deliveryAddress })
    .eq("tenant_id", profile.tenant_id)
    .eq("id", shipment.id);

  if (error) {
    throw new Error(error.message);
  }

  await logEvent(supabase, {
    aggregateType: "shipment",
    aggregateId: shipment.id,
    eventType: "SHIPMENT_ADDRESS_SET",
    payload: {
      shipmentId: shipment.id,
    },
  });
}

export async function createPicklist({ shipmentId }: { shipmentId: string }) {
  const profile = await assertProfile();
  const shipment = await fetchShipment(shipmentId, profile.tenant_id);
  assertShipmentMutable(shipment.status);

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from("shipments")
    .update({ status: "picking" })
    .eq("tenant_id", profile.tenant_id)
    .eq("id", shipment.id);

  if (error) {
    throw new Error(error.message);
  }

  await logEvent(supabase, {
    aggregateType: "shipment",
    aggregateId: shipment.id,
    eventType: "SHIPMENT_PICKLIST_CREATED",
    payload: {
      shipmentId: shipment.id,
    },
  });
}

export async function addPick({
  shipmentId,
  palletId,
  quantityUnits,
  productSku,
  grade,
  orderId,
}: {
  shipmentId: string;
  palletId: string;
  quantityUnits: number;
  productSku?: string | null;
  grade?: string | null;
  orderId?: string | null;
}) {
  ensurePositive(quantityUnits, "Quantity");
  const profile = await assertProfile();
  const shipment = await fetchShipment(shipmentId, profile.tenant_id);
  assertShipmentMutable(shipment.status);

  const supabase = await createServerSupabaseClient();
  const { data: palletRow, error: inventoryError } = await supabase
    .from("pallet_inventory_live_v")
    .select("pallet_id, code, product_sku, grade, units_available")
    .eq("tenant_id", profile.tenant_id)
    .eq("pallet_id", palletId)
    .maybeSingle();

  if (inventoryError) {
    if (inventoryError.code !== VIEW_MISSING_CODE) {
      throw new Error(inventoryError.message);
    }
  }

  if (!palletRow) {
    throw new Error("Pallet not available for picking.");
  }

  const available = Number(palletRow.units_available ?? 0);
  if (available < quantityUnits) {
    throw new Error(
      `Only ${available.toFixed(0)} units available on pallet ${palletRow.code}.`,
    );
  }

  const correlationId = randomUUID();

  await logEvent(supabase, {
    aggregateType: "pallet",
    aggregateId: palletId,
    eventType: "PACK_PALLET_RESERVED",
    payload: {
      palletId,
      orderId: orderId?.trim() || null,
      quantityUnits,
    },
    correlationId,
  });

  await logEvent(supabase, {
    aggregateType: "shipment",
    aggregateId: shipment.id,
    eventType: "SHIPMENT_PICK_ADDED",
    payload: {
      shipmentId: shipment.id,
      palletId,
      palletCode: palletRow.code,
      quantityUnits,
      productSku: productSku?.trim() || palletRow.product_sku || null,
      grade: grade?.trim() || palletRow.grade || null,
      orderId: orderId?.trim() || null,
    },
    correlationId,
  });
}

export async function removePick({
  shipmentId,
  palletId,
  quantityUnits,
  orderId,
}: {
  shipmentId: string;
  palletId: string;
  quantityUnits: number;
  orderId?: string | null;
}) {
  ensurePositive(quantityUnits, "Quantity");
  const profile = await assertProfile();
  const shipment = await fetchShipment(shipmentId, profile.tenant_id);
  assertShipmentMutable(shipment.status);

  const supabase = await createServerSupabaseClient();
  const { data: pickRow, error } = await supabase
    .from("shipment_picks_v")
    .select("picked_units")
    .eq("tenant_id", profile.tenant_id)
    .eq("shipment_id", shipment.id)
    .eq("pallet_id", palletId)
    .maybeSingle();

  if (error && error.code !== VIEW_MISSING_CODE) {
    throw new Error(error.message);
  }

  const pickedUnits = Number(pickRow?.picked_units ?? 0);
  if (pickedUnits < quantityUnits) {
    throw new Error(
      `Cannot remove ${quantityUnits} units – only ${pickedUnits.toFixed(0)} picked from this pallet.`,
    );
  }

  const correlationId = randomUUID();

  await logEvent(supabase, {
    aggregateType: "shipment",
    aggregateId: shipment.id,
    eventType: "SHIPMENT_PICK_REMOVED",
    payload: {
      shipmentId: shipment.id,
      palletId,
      quantityUnits,
      orderId: orderId?.trim() || null,
    },
    correlationId,
  });

  await logEvent(supabase, {
    aggregateType: "pallet",
    aggregateId: palletId,
    eventType: "PACK_PALLET_RESERVATION_RELEASED",
    payload: {
      palletId,
      orderId: orderId?.trim() || null,
      quantityUnits,
    },
    correlationId,
  });
}

export async function weighbridgeIn({
  shipmentId,
  grossKg,
  tareKg,
}: {
  shipmentId: string;
  grossKg: number;
  tareKg?: number | null;
}) {
  ensurePositive(grossKg, "Gross weight");
  if (tareKg !== null && tareKg !== undefined && !Number.isFinite(tareKg)) {
    throw new Error("Tare weight is invalid.");
  }

  const profile = await assertProfile();
  const shipment = await fetchShipment(shipmentId, profile.tenant_id);
  assertShipmentMutable(shipment.status);

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from("shipments")
    .update({ status: "weigh_in" })
    .eq("tenant_id", profile.tenant_id)
    .eq("id", shipment.id);

  if (error) {
    throw new Error(error.message);
  }

  await logEvent(supabase, {
    aggregateType: "shipment",
    aggregateId: shipment.id,
    eventType: "SHIPMENT_WEIGHBRIDGE_IN",
    payload: {
      shipmentId: shipment.id,
      grossKg,
      tareKg: tareKg ?? null,
    },
  });
}

export async function weighbridgeOut({
  shipmentId,
  grossKg,
  tareKg,
}: {
  shipmentId: string;
  grossKg: number;
  tareKg?: number | null;
}) {
  ensurePositive(grossKg, "Gross weight");
  if (tareKg !== null && tareKg !== undefined && !Number.isFinite(tareKg)) {
    throw new Error("Tare weight is invalid.");
  }

  const profile = await assertProfile();
  const shipment = await fetchShipment(shipmentId, profile.tenant_id);
  assertShipmentMutable(shipment.status);

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from("shipments")
    .update({ status: "weigh_out" })
    .eq("tenant_id", profile.tenant_id)
    .eq("id", shipment.id);

  if (error) {
    throw new Error(error.message);
  }

  await logEvent(supabase, {
    aggregateType: "shipment",
    aggregateId: shipment.id,
    eventType: "SHIPMENT_WEIGHBRIDGE_OUT",
    payload: {
      shipmentId: shipment.id,
      grossKg,
      tareKg: tareKg ?? null,
    },
  });
}

async function getShipmentPickTotals(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  tenantId: string,
  shipmentId: string,
) {
  const { data, error } = await supabase
    .from("shipment_picks_v")
    .select("pallet_id, picked_units")
    .eq("tenant_id", tenantId)
    .eq("shipment_id", shipmentId);

  if (error && error.code !== VIEW_MISSING_CODE) {
    throw new Error(error.message);
  }
  return (data ?? []).filter((row) => Number(row.picked_units ?? 0) > 0);
}

export async function finalizeDispatch({
  shipmentId,
}: {
  shipmentId: string;
}) {
  const profile = await assertProfile();
  const shipment = await fetchShipment(shipmentId, profile.tenant_id);
  assertShipmentMutable(shipment.status);

  const supabase = await createServerSupabaseClient();
  const picks = await getShipmentPickTotals(supabase, profile.tenant_id, shipment.id);
  const totalUnits = picks.reduce(
    (sum, row) => sum + Number(row.picked_units ?? 0),
    0,
  );

  if (totalUnits <= 0) {
    throw new Error("Shipment has no picked units to dispatch.");
  }

  const dispatchedAt = new Date().toISOString();

  const { error } = await supabase
    .from("shipments")
    .update({ status: "dispatched", dispatched_at: dispatchedAt })
    .eq("tenant_id", profile.tenant_id)
    .eq("id", shipment.id);

  if (error) {
    throw new Error(error.message);
  }

  for (const pick of picks) {
    const quantityUnits = Number(pick.picked_units ?? 0);
    if (quantityUnits <= 0) continue;
    await logEvent(supabase, {
      aggregateType: "pallet",
      aggregateId: pick.pallet_id,
      eventType: "PACK_PALLET_RESERVATION_RELEASED",
      payload: {
        palletId: pick.pallet_id,
        quantityUnits,
      },
    });
  }

  await logEvent(supabase, {
    aggregateType: "shipment",
    aggregateId: shipment.id,
    eventType: "SHIPMENT_DISPATCHED",
    payload: {
      shipmentId: shipment.id,
      totalUnits,
      dispatchedAt,
    },
  });
}

export async function cancelShipment({
  shipmentId,
  reason,
}: {
  shipmentId: string;
  reason?: string | null;
}) {
  const profile = await assertProfile();
  const shipment = await fetchShipment(shipmentId, profile.tenant_id);
  if (shipment.status === "dispatched") {
    throw new Error("Cannot cancel a dispatched shipment.");
  }
  if (shipment.status === "cancelled") {
    return;
  }

  const supabase = await createServerSupabaseClient();
  const picks = await getShipmentPickTotals(supabase, profile.tenant_id, shipment.id);

  const { error } = await supabase
    .from("shipments")
    .update({ status: "cancelled" })
    .eq("tenant_id", profile.tenant_id)
    .eq("id", shipment.id);

  if (error) {
    throw new Error(error.message);
  }

  for (const pick of picks) {
    const quantityUnits = Number(pick.picked_units ?? 0);
    if (quantityUnits <= 0) continue;
    await logEvent(supabase, {
      aggregateType: "pallet",
      aggregateId: pick.pallet_id,
      eventType: "PACK_PALLET_RESERVATION_RELEASED",
      payload: {
        palletId: pick.pallet_id,
        quantityUnits,
      },
    });
  }

  await logEvent(supabase, {
    aggregateType: "shipment",
    aggregateId: shipment.id,
    eventType: "SHIPMENT_CANCELLED",
    payload: {
      shipmentId: shipment.id,
      reason: reason?.trim() || null,
    },
  });
}
