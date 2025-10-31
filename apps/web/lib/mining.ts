import { randomUUID } from "node:crypto";

import { logEvent } from "@/lib/events";
import { getUserProfile } from "@/lib/rbac";
import { createServerSupabaseClient } from "@/utils/supabase/server";

const VIEW_MISSING_CODE = "42P01";

type VehicleRow = {
  id: string;
  tenant_id: string;
  code: string;
  type: string | null;
  capacity_tonnes: number | null;
  status: string;
};

type ShiftRow = {
  id: string;
  tenant_id: string;
  vehicle_id: string;
  operator_id: string | null;
  status: string;
  started_at: string;
  ended_at: string | null;
};

type StockpileRow = {
  id: string;
  code: string;
};

async function requireProfile() {
  const { profile } = await getUserProfile();
  if (!profile) {
    throw new Error("A profile is required to perform mining operations.");
  }
  if (!profile.tenant_id) {
    throw new Error("Tenant context is required.");
  }
  return profile;
}

async function fetchVehicle(vehicleId: string, tenantId: string) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("mining_vehicles")
    .select("id, tenant_id, code, type, capacity_tonnes, status")
    .eq("id", vehicleId)
    .eq("tenant_id", tenantId)
    .maybeSingle<VehicleRow>();

  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    throw new Error("Vehicle not found.");
  }
  return data;
}

async function fetchShift(shiftId: string, tenantId: string) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("haul_shifts")
    .select("id, tenant_id, vehicle_id, operator_id, status, started_at, ended_at")
    .eq("id", shiftId)
    .eq("tenant_id", tenantId)
    .maybeSingle<ShiftRow>();

  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    throw new Error("Shift not found.");
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
    .maybeSingle<StockpileRow>();

  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    throw new Error("Stockpile not found.");
  }
  return data;
}

async function ensureVehicleAvailable(vehicleId: string, tenantId: string) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("haul_shifts")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("vehicle_id", vehicleId)
    .eq("status", "active")
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    throw new Error(error.message);
  }

  if (data) {
    throw new Error("Vehicle already has an active shift.");
  }
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
    .maybeSingle<{ available_tonnes: number | null }>();

  if (error) {
    if (error.code === VIEW_MISSING_CODE) {
      return;
    }
    throw new Error(error.message);
  }

  const available = data?.available_tonnes ?? 0;
  if (!Number.isFinite(available)) {
    return;
  }

  if (available < 0 && Math.abs(available) < quantityTonnes) {
    throw new Error(
      "Stockpile inventory appears inconsistent. Please reconcile before logging more loads.",
    );
  }
}

function ensurePositiveNumber(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be greater than zero.`);
  }
}

export async function createVehicle({
  code,
  type,
  capacityTonnes,
}: {
  code: string;
  type?: string | null;
  capacityTonnes?: number | null;
}) {
  const safeCode = code.trim();
  if (!safeCode) {
    throw new Error("Vehicle code is required.");
  }

  const profile = await requireProfile();
  const supabase = await createServerSupabaseClient();

  const payload: Record<string, unknown> = {
    tenant_id: profile.tenant_id,
    code: safeCode,
    status: "active",
  };

  if (type && type.trim()) {
    payload.type = type.trim();
  }

  if (capacityTonnes !== undefined && capacityTonnes !== null) {
    const numeric = Number(capacityTonnes);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      throw new Error("Capacity must be a positive number.");
    }
    payload.capacity_tonnes = numeric;
  }

  const { data, error } = await supabase
    .from("mining_vehicles")
    .upsert(payload, { onConflict: "tenant_id,code" })
    .select("id, code")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    throw new Error("Failed to register vehicle.");
  }

  await logEvent(supabase, {
    aggregateType: "mining_vehicle",
    aggregateId: data.id,
    eventType: "MINING_VEHICLE_REGISTERED",
    payload: {
      vehicleId: data.id,
      code: safeCode,
      type: type?.trim() ?? null,
      capacityTonnes: capacityTonnes ?? null,
    },
  });

  return data;
}

export async function startShift({ vehicleId }: { vehicleId: string }) {
  const profile = await requireProfile();
  const vehicle = await fetchVehicle(vehicleId, profile.tenant_id);
  await ensureVehicleAvailable(vehicle.id, profile.tenant_id);

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("haul_shifts")
    .insert({
      tenant_id: profile.tenant_id,
      vehicle_id: vehicle.id,
      operator_id: profile.id,
      status: "active",
    })
    .select("id, started_at")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    throw new Error("Failed to create shift.");
  }

  await logEvent(supabase, {
    aggregateType: "mining_shift",
    aggregateId: data.id,
    eventType: "MINING_SHIFT_STARTED",
    payload: {
      shiftId: data.id,
      vehicleId: vehicle.id,
      vehicleCode: vehicle.code,
      operatorId: profile.id,
      startedAt: data.started_at,
    },
  });

  return { ...data, vehicleCode: vehicle.code };
}

export async function logLoad({
  shiftId,
  materialType,
  quantityTonnes,
  stockpileId,
}: {
  shiftId: string;
  materialType: string;
  quantityTonnes: number;
  stockpileId: string;
}) {
  const profile = await requireProfile();
  const shift = await fetchShift(shiftId, profile.tenant_id);

  if (shift.status !== "active") {
    throw new Error("Only active shifts can record loads.");
  }

  const material = materialType.trim();
  if (!material) {
    throw new Error("Material type is required.");
  }

  const quantity = Number(quantityTonnes);
  ensurePositiveNumber(quantity, "Quantity");

  const vehicle = await fetchVehicle(shift.vehicle_id, profile.tenant_id);
  const stockpile = await fetchStockpile(stockpileId, profile.tenant_id);
  await verifyStockpileAvailability(stockpile.id, profile.tenant_id, quantity);

  const supabase = await createServerSupabaseClient();
  const correlationId = randomUUID();

  await logEvent(supabase, {
    aggregateType: "mining_shift",
    aggregateId: shift.id,
    eventType: "HAUL_LOAD_PICKED",
    payload: {
      shiftId: shift.id,
      vehicleId: vehicle.id,
      vehicleCode: vehicle.code,
      materialType: material,
      quantityTonnes: quantity,
      stockpileId: stockpile.id,
      stockpileCode: stockpile.code,
    },
    correlationId,
  });

  await logEvent(supabase, {
    aggregateType: "stockpile",
    aggregateId: stockpile.id,
    eventType: "STOCKPILE_RECEIPT_RECORDED",
    payload: {
      stockpileId: stockpile.id,
      stockpileCode: stockpile.code,
      shiftId: shift.id,
      vehicleId: vehicle.id,
      vehicleCode: vehicle.code,
      materialType: material,
      quantityTonnes: quantity,
    },
    correlationId,
  });
}

export async function endShift({ shiftId }: { shiftId: string }) {
  const profile = await requireProfile();
  const shift = await fetchShift(shiftId, profile.tenant_id);

  if (shift.status !== "active") {
    throw new Error("Shift is already closed.");
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("haul_shifts")
    .update({
      status: "closed",
      ended_at: new Date().toISOString(),
    })
    .eq("id", shift.id)
    .eq("tenant_id", profile.tenant_id)
    .select("id, ended_at")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    throw new Error("Failed to close shift.");
  }

  await logEvent(supabase, {
    aggregateType: "mining_shift",
    aggregateId: shift.id,
    eventType: "MINING_SHIFT_ENDED",
    payload: {
      shiftId: shift.id,
      vehicleId: shift.vehicle_id,
      operatorId: shift.operator_id,
      endedAt: data.ended_at,
    },
  });

  return data;
}

