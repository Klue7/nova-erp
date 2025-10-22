import { createServerSupabaseClient } from "@/utils/supabase/server";
import { logEvent } from "@/lib/events";
import { getUserProfile } from "@/lib/rbac";

type StockpileUpsertInput = {
  code: string;
  name?: string | null;
  location?: string | null;
  materialType?: string | null;
};

type StockpileEventBase = {
  stockpileId: string;
};

type QuantityEventBase = StockpileEventBase & {
  quantityTonnes: number;
  reference?: string | null;
  notes?: string | null;
};

function assertProfile(profile: Awaited<ReturnType<typeof getUserProfile>>["profile"]) {
  if (!profile) {
    throw new Error("Profile is required to perform this action.");
  }
  return profile;
}

async function fetchStockpileById(
  stockpileId: string,
  tenantId: string,
) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("stockpiles")
    .select("id, code, tenant_id")
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

function buildUpsertPayload(
  tenantId: string,
  input: StockpileUpsertInput,
) {
  const payload: Record<string, unknown> = {
    tenant_id: tenantId,
    code: input.code.trim(),
  };

  if (input.name !== undefined) {
    payload.name = input.name;
  }
  if (input.location !== undefined) {
    payload.location = input.location;
  }
  if (input.materialType !== undefined) {
    payload.material_type = input.materialType;
  }

  return payload;
}

export async function ensureStockpileExists(input: StockpileUpsertInput) {
  const supabase = await createServerSupabaseClient();
  const { profile } = await getUserProfile();
  const currentProfile = assertProfile(profile);

  const payload = buildUpsertPayload(currentProfile.tenant_id, input);

  const { data, error } = await supabase
    .from("stockpiles")
    .upsert(payload, { onConflict: "tenant_id,code" })
    .select("id, code")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (data) {
    return data;
  }

  const { data: existing, error: fetchError } = await supabase
    .from("stockpiles")
    .select("id, code")
    .eq("tenant_id", currentProfile.tenant_id)
    .eq("code", input.code.trim())
    .maybeSingle();

  if (fetchError) {
    throw new Error(fetchError.message);
  }

  if (!existing) {
    throw new Error("Failed to upsert stockpile.");
  }

  return existing;
}

export async function createStockpile(input: StockpileUpsertInput) {
  const supabase = await createServerSupabaseClient();
  const result = await ensureStockpileExists(input);

  await logEvent(supabase, {
    aggregateType: "stockpile",
    aggregateId: result.id,
    eventType: "STOCKPILE_CREATED",
    payload: {
      stockpileId: result.id,
      code: result.code,
      name: input.name ?? null,
      location: input.location ?? null,
      materialType: input.materialType ?? null,
    },
  });

  return result;
}

export async function recordReceipt({
  stockpileId,
  quantityTonnes,
  reference,
  notes,
}: QuantityEventBase) {
  const { profile } = await getUserProfile();
  const currentProfile = assertProfile(profile);
  const stockpile = await fetchStockpileById(
    stockpileId,
    currentProfile.tenant_id,
  );
  const supabase = await createServerSupabaseClient();

  await logEvent(supabase, {
    aggregateType: "stockpile",
    aggregateId: stockpile.id,
    eventType: "STOCKPILE_RECEIPT_RECORDED",
    payload: {
      stockpileId: stockpile.id,
      code: stockpile.code,
      quantityTonnes,
      reference: reference ?? null,
      notes: notes ?? null,
    },
  });
}

export async function transferOut({
  stockpileId,
  quantityTonnes,
  toStockpileId,
  reference,
}: QuantityEventBase & { toStockpileId?: string | null }) {
  const { profile } = await getUserProfile();
  const currentProfile = assertProfile(profile);
  const stockpile = await fetchStockpileById(
    stockpileId,
    currentProfile.tenant_id,
  );
  const supabase = await createServerSupabaseClient();

  await logEvent(supabase, {
    aggregateType: "stockpile",
    aggregateId: stockpile.id,
    eventType: "STOCKPILE_TRANSFERRED_OUT",
    payload: {
      stockpileId: stockpile.id,
      code: stockpile.code,
      quantityTonnes,
      toStockpileId: toStockpileId ?? null,
      reference: reference ?? null,
    },
  });
}

export async function adjust({
  stockpileId,
  quantityTonnes,
  reason,
}: QuantityEventBase & { reason: string }) {
  if (quantityTonnes === 0) {
    return;
  }

  const { profile } = await getUserProfile();
  const currentProfile = assertProfile(profile);
  const stockpile = await fetchStockpileById(
    stockpileId,
    currentProfile.tenant_id,
  );
  const supabase = await createServerSupabaseClient();

  const isIncrease = quantityTonnes > 0;
  await logEvent(supabase, {
    aggregateType: "stockpile",
    aggregateId: stockpile.id,
    eventType: isIncrease
      ? "STOCKPILE_ADJUSTED_IN"
      : "STOCKPILE_ADJUSTED_OUT",
    payload: {
      stockpileId: stockpile.id,
      code: stockpile.code,
      quantityTonnes: Math.abs(quantityTonnes),
      reason,
    },
  });
}

export async function takeSample({ stockpileId }: StockpileEventBase) {
  const { profile } = await getUserProfile();
  const currentProfile = assertProfile(profile);
  const stockpile = await fetchStockpileById(
    stockpileId,
    currentProfile.tenant_id,
  );
  const supabase = await createServerSupabaseClient();

  await logEvent(supabase, {
    aggregateType: "stockpile",
    aggregateId: stockpile.id,
    eventType: "STOCKPILE_SAMPLE_TAKEN",
    payload: {
      stockpileId: stockpile.id,
      code: stockpile.code,
    },
  });
}

export async function recordQuality({
  stockpileId,
  moisturePct,
}: StockpileEventBase & { moisturePct: number }) {
  const { profile } = await getUserProfile();
  const currentProfile = assertProfile(profile);
  const stockpile = await fetchStockpileById(
    stockpileId,
    currentProfile.tenant_id,
  );
  const supabase = await createServerSupabaseClient();

  await logEvent(supabase, {
    aggregateType: "stockpile",
    aggregateId: stockpile.id,
    eventType: "STOCKPILE_QUALITY_RECORDED",
    payload: {
      stockpileId: stockpile.id,
      code: stockpile.code,
      moisturePct,
    },
  });
}
