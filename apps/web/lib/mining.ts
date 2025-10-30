import { randomUUID } from "node:crypto";

import { logEvent } from "@/lib/events";
import { getUserProfile } from "@/lib/rbac";
import { recordReceipt } from "@/lib/stockpile";
import { createServerSupabaseClient } from "@/utils/supabase/server";

function assertMiningProfile(
  profile: Awaited<ReturnType<typeof getUserProfile>>["profile"],
) {
  if (!profile) {
    throw new Error("A profile is required to perform mining operations.");
  }

  if (
    !profile.is_platform_admin &&
    profile.role !== "mining_operator" &&
    profile.role !== "admin"
  ) {
    throw new Error(
      "Only mining operators or administrators can manage mining shifts.",
    );
  }

  return profile;
}

async function fetchVehicle(vehicleId: string, tenantId: string) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("mining_vehicles")
    .select("id, tenant_id, code, status")
    .eq("id", vehicleId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    throw new Error("Vehicle not found.");
  }
  return data;
}

async function ensureVehicleAvailable(vehicleId: string, tenantId: string) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("mining_shifts")
    .select("id, operator_name")
    .eq("tenant_id", tenantId)
    .eq("vehicle_id", vehicleId)
    .eq("status", "active")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (data) {
    throw new Error(
      `Vehicle currently assigned to ${data.operator_name ?? "another operator"}.`,
    );
  }
}

async function fetchActiveShift(
  shiftId: string,
  tenantId: string,
  operatorId: string,
) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("mining_shifts")
    .select(
      "id, tenant_id, vehicle_id, operator_id, operator_name, operator_role, status, started_at",
    )
    .eq("id", shiftId)
    .eq("tenant_id", tenantId)
    .eq("operator_id", operatorId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    throw new Error("Shift not found.");
  }

  if (data.status !== "active") {
    throw new Error("Shift is not active.");
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

export async function startShift({
  vehicleId,
}: {
  vehicleId: string;
}) {
  const { profile } = await getUserProfile();
  const currentProfile = assertMiningProfile(profile);
  const supabase = await createServerSupabaseClient();

  const vehicle = await fetchVehicle(vehicleId, currentProfile.tenant_id);

  if (vehicle.status !== "active") {
    throw new Error("Vehicle is not available for assignment.");
  }

  const { data: existing, error: existingError } = await supabase
    .from("mining_shifts")
    .select("id")
    .eq("tenant_id", currentProfile.tenant_id)
    .eq("operator_id", currentProfile.id)
    .eq("status", "active")
    .maybeSingle();

  if (existingError) {
    throw new Error(existingError.message);
  }

  if (existing) {
    throw new Error("You already have an active shift.");
  }

  await ensureVehicleAvailable(vehicle.id, currentProfile.tenant_id);

  const { data: inserted, error: insertError } = await supabase
    .from("mining_shifts")
    .insert({
      tenant_id: currentProfile.tenant_id,
      vehicle_id: vehicle.id,
      operator_id: currentProfile.id,
      operator_name: currentProfile.full_name,
      operator_role: currentProfile.role,
      status: "active",
    })
    .select("id, started_at")
    .maybeSingle();

  if (insertError) {
    throw new Error(insertError.message);
  }

  if (!inserted) {
    throw new Error("Unable to start shift.");
  }

  const correlationId = randomUUID();

  await logEvent(supabase, {
    aggregateType: "mining.shift",
    aggregateId: inserted.id,
    eventType: "MINING_SHIFT_STARTED",
    payload: {
      shiftId: inserted.id,
      vehicleId: vehicle.id,
      vehicleCode: vehicle.code,
      operatorId: currentProfile.id,
      operatorName: currentProfile.full_name,
      operatorRole: currentProfile.role,
      startedAt: inserted.started_at,
    },
    correlationId,
    actorRole: currentProfile.role,
  });

  return { shiftId: inserted.id };
}

export async function endShift({
  shiftId,
}: {
  shiftId: string;
}) {
  const { profile } = await getUserProfile();
  const currentProfile = assertMiningProfile(profile);
  const supabase = await createServerSupabaseClient();

  const shift = await fetchActiveShift(
    shiftId,
    currentProfile.tenant_id,
    currentProfile.id,
  );

  const endedAt = new Date().toISOString();

  const { error: updateError } = await supabase
    .from("mining_shifts")
    .update({ status: "completed", ended_at: endedAt })
    .eq("id", shift.id)
    .eq("tenant_id", currentProfile.tenant_id)
    .eq("operator_id", currentProfile.id);

  if (updateError) {
    throw new Error(updateError.message);
  }

  await logEvent(supabase, {
    aggregateType: "mining.shift",
    aggregateId: shift.id,
    eventType: "MINING_SHIFT_COMPLETED",
    payload: {
      shiftId: shift.id,
      vehicleId: shift.vehicle_id,
      operatorId: shift.operator_id,
      operatorName: shift.operator_name,
      completedAt: endedAt,
    },
    actorRole: currentProfile.role,
  });

  return { shiftId: shift.id, endedAt };
}

export async function recordLoad({
  shiftId,
  stockpileId,
  tonnage,
  moisturePct,
  notes,
}: {
  shiftId: string;
  stockpileId: string;
  tonnage: number;
  moisturePct?: number | null;
  notes?: string | null;
}) {
  if (!Number.isFinite(tonnage) || tonnage <= 0) {
    throw new Error("Tonnage must be greater than zero.");
  }

  const { profile } = await getUserProfile();
  const currentProfile = assertMiningProfile(profile);
  const supabase = await createServerSupabaseClient();

  const shift = await fetchActiveShift(
    shiftId,
    currentProfile.tenant_id,
    currentProfile.id,
  );

  const stockpile = await fetchStockpile(
    stockpileId,
    currentProfile.tenant_id,
  );

  const vehicle = await fetchVehicle(shift.vehicle_id, currentProfile.tenant_id);

  const loadId = randomUUID();
  const correlationId = randomUUID();
  const occurredAt = new Date().toISOString();

  await logEvent(supabase, {
    aggregateType: "mining.load",
    aggregateId: loadId,
    eventType: "MINING_LOAD_RECORDED",
    payload: {
      loadId,
      shiftId: shift.id,
      vehicleId: vehicle.id,
      vehicleCode: vehicle.code,
      stockpileId: stockpile.id,
      stockpileCode: stockpile.code,
      tonnage,
      moisturePct: moisturePct ?? null,
      notes: notes ?? null,
      operatorId: currentProfile.id,
      operatorName: currentProfile.full_name,
      recordedAt: occurredAt,
    },
    correlationId,
    occurredAt,
    actorRole: currentProfile.role,
  });

  await recordReceipt({
    stockpileId: stockpile.id,
    quantityTonnes: tonnage,
    reference: vehicle.code,
    notes: notes ?? null,
    correlationId,
    occurredAt,
  });

  return { loadId };
}
