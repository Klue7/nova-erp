import type {
  DailyThroughputRow,
  ExecTodayRow,
  OrderDispatchLeadTimeRow,
  QualityTodayRow,
  WipSummaryRow,
} from "@/lib/reports";
import { getUserProfile } from "@/lib/rbac";
import { createServerSupabaseClient } from "@/utils/supabase/server";

const VIEW_MISSING_CODE = "42P01";

function isViewMissing(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === VIEW_MISSING_CODE
  );
}

export async function getExecToday() {
  const { profile } = await getUserProfile();
  if (!profile) {
    throw new Error("Profile is required for reports.");
  }
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("rpt_exec_today_v")
    .select(
      "tenant_id, units_dispatched_today, units_packed_today, open_orders, units_reserved, invoices_issued_today, payments_received_today, open_ar_total",
    )
    .eq("tenant_id", profile.tenant_id)
    .maybeSingle();

  if (error) {
    if (isViewMissing(error)) {
      return null;
    }
    throw error;
  }

  return (data as ExecTodayRow | null) ?? null;
}

export async function getDailyThroughput({
  from,
  to,
}: {
  from?: string | null;
  to?: string | null;
} = {}) {
  const { profile } = await getUserProfile();
  if (!profile) {
    throw new Error("Profile is required for reports.");
  }
  const supabase = await createServerSupabaseClient();
  let query = supabase
    .from("rpt_daily_throughput_v")
    .select(
      "tenant_id, d, mix_input_tonnes, crush_output_tonnes, extrusion_output_units, packed_units, units_dispatched",
    )
    .eq("tenant_id", profile.tenant_id)
    .order("d", { ascending: true });

  if (from) {
    query = query.gte("d", from);
  }
  if (to) {
    query = query.lte("d", to);
  }

  const { data, error } = await query;

  if (error) {
    if (isViewMissing(error)) {
      return [];
    }
    throw error;
  }

  return (data as DailyThroughputRow[] | null) ?? [];
}

export async function getWipSummary() {
  const { profile } = await getUserProfile();
  if (!profile) {
    throw new Error("Profile is required for reports.");
  }
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("rpt_wip_summary_v")
    .select("tenant_id, stage, planned, active")
    .eq("tenant_id", profile.tenant_id)
    .order("stage", { ascending: true });

  if (error) {
    if (isViewMissing(error)) {
      return [];
    }
    throw error;
  }

  return (data as WipSummaryRow[] | null) ?? [];
}

export async function getQualityToday() {
  const { profile } = await getUserProfile();
  if (!profile) {
    throw new Error("Profile is required for reports.");
  }
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("rpt_quality_today_v")
    .select(
      "tenant_id, extrusion_scrap_today, dry_scrap_today, kiln_yield_pct_active_avg",
    )
    .eq("tenant_id", profile.tenant_id)
    .maybeSingle();

  if (error) {
    if (isViewMissing(error)) {
      return null;
    }
    throw error;
  }

  return (data as QualityTodayRow | null) ?? null;
}

export async function getOrderDispatchLeadTimes({
  from,
  to,
}: {
  from?: string | null;
  to?: string | null;
} = {}) {
  const { profile } = await getUserProfile();
  if (!profile) {
    throw new Error("Profile is required for reports.");
  }
  const supabase = await createServerSupabaseClient();
  let query = supabase
    .from("rpt_order_dispatch_leadtime_v")
    .select(
      "tenant_id, order_id, order_code, order_date, first_dispatch_date, days_order_to_dispatch",
    )
    .eq("tenant_id", profile.tenant_id)
    .order("order_date", { ascending: true });

  if (from) {
    query = query.gte("order_date", from);
  }
  if (to) {
    query = query.lte("order_date", to);
  }

  const { data, error } = await query;

  if (error) {
    if (isViewMissing(error)) {
      return [];
    }
    throw error;
  }

  const rows = (data as OrderDispatchLeadTimeRow[] | null) ?? [];

  return rows.map((row) => ({
    ...row,
    days_order_to_dispatch:
      row.days_order_to_dispatch === null
        ? null
        : Number(row.days_order_to_dispatch),
  }));
}
