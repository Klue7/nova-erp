import { createServerSupabaseClient } from "@/utils/supabase/server";
import { getUserProfile } from "@/lib/rbac";

const VIEW_MISSING_CODE = "42P01";

type PostgrestErrorLike = { code?: string; message: string };

function isViewMissing(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as PostgrestErrorLike).code === VIEW_MISSING_CODE
  );
}

function numberOrZero(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

async function requireProfile() {
  const { profile } = await getUserProfile();
  if (!profile) {
    throw new Error("Profile required to query upstream availability.");
  }
  if (!profile.tenant_id) {
    throw new Error("Active tenant context is required.");
  }
  return profile;
}

export type MixingSourceOption = {
  id: string;
  code: string;
  availableTonnes: number;
};

export async function listAvailableForMixing(): Promise<MixingSourceOption[]> {
  const profile = await requireProfile();
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("stockpile_balances_v")
    .select("stockpile_id, code, available_tonnes")
    .eq("tenant_id", profile.tenant_id)
    .gt("available_tonnes", 0)
    .order("code", { ascending: true });

  if (error) {
    if (isViewMissing(error)) {
      return [];
    }
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => ({
    id: row.stockpile_id,
    code: row.code ?? "Stockpile",
    availableTonnes: numberOrZero(row.available_tonnes),
  }));
}

export type CrushingSourceOption = {
  id: string;
  code: string;
  availableTonnes: number;
  completedAt: string | null;
};

export async function listAvailableForCrushing(): Promise<CrushingSourceOption[]> {
  const profile = await requireProfile();
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("mix_available_for_crushing_v")
    .select("batch_id, available_tonnes")
    .eq("tenant_id", profile.tenant_id)
    .gt("available_tonnes", 0);

  if (error) {
    if (isViewMissing(error)) {
      return [];
    }
    throw new Error(error.message);
  }

  const batches = data ?? [];
  if (batches.length === 0) {
    return [];
  }

  const ids = batches.map((row) => row.batch_id);
  const { data: batchData, error: batchError } = await supabase
    .from("mix_batches")
    .select("id, code, completed_at")
    .eq("tenant_id", profile.tenant_id)
    .in("id", ids);

  if (batchError) {
    throw new Error(batchError.message);
  }

  const codeMap = new Map<string, { code: string; completedAt: string | null }>();
  (batchData ?? []).forEach((row) => {
    codeMap.set(row.id, { code: row.code ?? "Batch", completedAt: row.completed_at ?? null });
  });

  return batches
    .map((row) => {
      const info = codeMap.get(row.batch_id) ?? { code: "Batch", completedAt: null };
      return {
        id: row.batch_id,
        code: info.code,
        completedAt: info.completedAt,
        availableTonnes: numberOrZero(row.available_tonnes),
      };
    })
    .filter((option) => option.availableTonnes > 0)
    .sort((a, b) => a.code.localeCompare(b.code));
}

export type ExtrusionSourceOption = {
  id: string;
  code: string;
  availableTonnes: number;
  completedAt: string | null;
};

export async function listAvailableForExtrusion(): Promise<ExtrusionSourceOption[]> {
  const profile = await requireProfile();
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("crush_available_for_extrusion_v")
    .select("crush_run_id, available_tonnes")
    .eq("tenant_id", profile.tenant_id)
    .gt("available_tonnes", 0);

  if (error) {
    if (isViewMissing(error)) {
      return [];
    }
    throw new Error(error.message);
  }

  const runs = data ?? [];
  if (runs.length === 0) {
    return [];
  }

  const ids = runs.map((row) => row.crush_run_id);
  const { data: runData, error: runError } = await supabase
    .from("crush_runs")
    .select("id, code, completed_at")
    .eq("tenant_id", profile.tenant_id)
    .in("id", ids);

  if (runError) {
    throw new Error(runError.message);
  }

  const codeMap = new Map<string, { code: string; completedAt: string | null }>();
  (runData ?? []).forEach((row) => {
    codeMap.set(row.id, { code: row.code ?? "Run", completedAt: row.completed_at ?? null });
  });

  return runs
    .map((row) => {
      const info = codeMap.get(row.crush_run_id) ?? { code: "Run", completedAt: null };
      return {
        id: row.crush_run_id,
        code: info.code,
        completedAt: info.completedAt,
        availableTonnes: numberOrZero(row.available_tonnes),
      };
    })
    .filter((option) => option.availableTonnes > 0)
    .sort((a, b) => a.code.localeCompare(b.code));
}

export type DrySourceOption = {
  id: string;
  code: string;
  availableUnits: number;
  completedAt: string | null;
};

export async function listAvailableForDry(): Promise<DrySourceOption[]> {
  const profile = await requireProfile();
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("extrusion_available_for_drying_v")
    .select("extrusion_run_id, available_units")
    .eq("tenant_id", profile.tenant_id)
    .gt("available_units", 0);

  if (error) {
    if (isViewMissing(error)) {
      return [];
    }
    throw new Error(error.message);
  }

  const runs = data ?? [];
  if (runs.length === 0) {
    return [];
  }

  const ids = runs.map((row) => row.extrusion_run_id);
  const { data: extrusionRuns, error: extrusionError } = await supabase
    .from("extrusion_runs")
    .select("id, code, completed_at")
    .eq("tenant_id", profile.tenant_id)
    .in("id", ids);

  if (extrusionError) {
    throw new Error(extrusionError.message);
  }

  const codeMap = new Map<string, { code: string; completedAt: string | null }>();
  (extrusionRuns ?? []).forEach((row) => {
    codeMap.set(row.id, { code: row.code ?? "Run", completedAt: row.completed_at ?? null });
  });

  return runs
    .map((row) => {
      const info = codeMap.get(row.extrusion_run_id) ?? { code: "Run", completedAt: null };
      return {
        id: row.extrusion_run_id,
        code: info.code,
        completedAt: info.completedAt,
        availableUnits: numberOrZero(row.available_units),
      };
    })
    .filter((option) => option.availableUnits > 0)
    .sort((a, b) => a.code.localeCompare(b.code));
}

export type KilnSourceOption = {
  id: string;
  code: string;
  availableUnits: number;
  completedAt: string | null;
};

export async function listAvailableForKiln(): Promise<KilnSourceOption[]> {
  const profile = await requireProfile();
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("dry_available_for_kiln_v")
    .select("load_id, available_units")
    .eq("tenant_id", profile.tenant_id)
    .gt("available_units", 0);

  if (error) {
    if (isViewMissing(error)) {
      return [];
    }
    throw new Error(error.message);
  }

  const loads = data ?? [];
  if (loads.length === 0) {
    return [];
  }

  const ids = loads.map((row) => row.load_id);
  const { data: dryLoads, error: loadError } = await supabase
    .from("dry_loads")
    .select("id, code, completed_at")
    .eq("tenant_id", profile.tenant_id)
    .in("id", ids);

  if (loadError) {
    throw new Error(loadError.message);
  }

  const codeMap = new Map<string, { code: string; completedAt: string | null }>();
  (dryLoads ?? []).forEach((row) => {
    codeMap.set(row.id, { code: row.code ?? "Dry load", completedAt: row.completed_at ?? null });
  });

  return loads
    .map((row) => {
      const info = codeMap.get(row.load_id) ?? { code: "Dry load", completedAt: null };
      return {
        id: row.load_id,
        code: info.code,
        completedAt: info.completedAt,
        availableUnits: numberOrZero(row.available_units),
      };
    })
    .filter((option) => option.availableUnits > 0)
    .sort((a, b) => a.code.localeCompare(b.code));
}

export type PackingSourceOption = {
  id: string;
  code: string;
  availableUnits: number;
  completedAt: string | null;
};

export async function listAvailableForPacking(): Promise<PackingSourceOption[]> {
  const profile = await requireProfile();
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("kiln_available_for_packing_v")
    .select("kiln_batch_id, available_units")
    .eq("tenant_id", profile.tenant_id)
    .gt("available_units", 0);

  if (error) {
    if (isViewMissing(error)) {
      return [];
    }
    throw new Error(error.message);
  }

  const batches = data ?? [];
  if (batches.length === 0) {
    return [];
  }

  const ids = batches.map((row) => row.kiln_batch_id);
  const { data: kilnBatches, error: kilnError } = await supabase
    .from("kiln_batches")
    .select("id, code, completed_at")
    .eq("tenant_id", profile.tenant_id)
    .in("id", ids);

  if (kilnError) {
    throw new Error(kilnError.message);
  }

  const codeMap = new Map<string, { code: string; completedAt: string | null }>();
  (kilnBatches ?? []).forEach((row) => {
    codeMap.set(row.id, { code: row.code ?? "Kiln batch", completedAt: row.completed_at ?? null });
  });

  return batches
    .map((row) => {
      const info = codeMap.get(row.kiln_batch_id) ?? { code: "Kiln batch", completedAt: null };
      return {
        id: row.kiln_batch_id,
        code: info.code,
        completedAt: info.completedAt,
        availableUnits: numberOrZero(row.available_units),
      };
    })
    .filter((option) => option.availableUnits > 0)
    .sort((a, b) => a.code.localeCompare(b.code));
}

export type PalletOption = {
  id: string;
  code: string;
  productSku: string | null;
  grade: string | null;
  locationId: string | null;
  unitsAvailable: number;
};

export async function listAvailablePallets(): Promise<PalletOption[]> {
  const profile = await requireProfile();
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("pallet_inventory_live_v")
    .select("pallet_id, code, product_sku, grade, location_id, units_available")
    .eq("tenant_id", profile.tenant_id)
    .gt("units_available", 0)
    .order("code", { ascending: true });

  if (error) {
    if (isViewMissing(error)) {
      return [];
    }
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => ({
    id: row.pallet_id,
    code: row.code ?? "Pallet",
    productSku: row.product_sku ?? null,
    grade: row.grade ?? null,
    locationId: row.location_id ?? null,
    unitsAvailable: numberOrZero(row.units_available),
  }));
}
