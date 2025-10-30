import {
  formatISODate,
  isAfterDate,
  isBeforeDate,
  isEqualDate,
  parseISODate,
  subDays,
} from "@/lib/date-utils";

export const DEFAULT_REPORT_LOOKBACK_DAYS = 90;

export type ExecTodayRow = {
  tenant_id: string;
  units_dispatched_today: number | null;
  units_packed_today: number | null;
  open_orders: number | null;
  units_reserved: number | null;
  invoices_issued_today: number | null;
  payments_received_today: number | null;
  open_ar_total: number | null;
};

export type DailyThroughputRow = {
  tenant_id: string;
  d: string;
  mix_input_tonnes: number | null;
  crush_output_tonnes: number | null;
  extrusion_output_units: number | null;
  packed_units: number | null;
  units_dispatched: number | null;
};

export type WipSummaryRow = {
  tenant_id: string;
  stage: string;
  planned: number | null;
  active: number | null;
};

export type QualityTodayRow = {
  tenant_id: string;
  extrusion_scrap_today: number | null;
  dry_scrap_today: number | null;
  kiln_yield_pct_active_avg: number | null;
};

export type OrderDispatchLeadTimeRow = {
  tenant_id: string;
  order_id: string;
  order_code: string;
  order_date: string | null;
  first_dispatch_date: string | null;
  days_order_to_dispatch: number | null;
};

export type CsvExport = {
  filename: string;
  csv: string;
};

export function escapeCsvValue(value: unknown) {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/["\n,]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function buildCsv(headers: string[], rows: Array<Record<string, unknown>>) {
  const lines = [headers.join(",")];
  rows.forEach((row) => {
    const line = headers
      .map((header) => escapeCsvValue(row[header]))
      .join(",");
    lines.push(line);
  });
  return lines.join("\n");
}

function coerceNumber(value: number | string | null | undefined) {
  if (value === null || value === undefined) return 0;
  const next = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(next) ? Number(next) : 0;
}

export function isDateWithinRange(
  dateValue: string | null | undefined,
  from: string,
  to: string,
) {
  if (!dateValue) return false;
  const date = parseISODate(dateValue);
  const fromDate = parseISODate(from);
  const toDate = parseISODate(to);
  if (Number.isNaN(date.getTime())) return false;
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    return true;
  }
  const afterStart = isAfterDate(date, fromDate) || isEqualDate(date, fromDate);
  const beforeEnd = isBeforeDate(date, toDate) || isEqualDate(date, toDate);
  return afterStart && beforeEnd;
}

export function calculatePercentiles(values: number[]) {
  if (values.length === 0) {
    return { p50: 0, p90: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);

  function percentile(p: number) {
    if (sorted.length === 1) return sorted[0];
    const index = (sorted.length - 1) * p;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    if (lower === upper) {
      return sorted[lower];
    }
    const weight = index - lower;
    return sorted[lower] + (sorted[upper] - sorted[lower]) * weight;
  }

  return {
    p50: percentile(0.5),
    p90: percentile(0.9),
  };
}

export function getReportingWindow() {
  const today = new Date();
  const min = subDays(today, DEFAULT_REPORT_LOOKBACK_DAYS - 1);
  return {
    defaultTo: formatISODate(today, { representation: "date" }),
    defaultFrom: formatISODate(subDays(today, 29), { representation: "date" }),
    minAvailable: formatISODate(min, { representation: "date" }),
  };
}

export function dailyThroughputToCsv(rows: DailyThroughputRow[]): string {
  const headers = [
    "date",
    "mix_input_tonnes",
    "crush_output_tonnes",
    "extrusion_output_units",
    "packed_units",
    "units_dispatched",
  ];
  const formatted = rows.map((row) => ({
    date: row.d,
    mix_input_tonnes: coerceNumber(row.mix_input_tonnes),
    crush_output_tonnes: coerceNumber(row.crush_output_tonnes),
    extrusion_output_units: coerceNumber(row.extrusion_output_units),
    packed_units: coerceNumber(row.packed_units),
    units_dispatched: coerceNumber(row.units_dispatched),
  }));
  return buildCsv(headers, formatted);
}

export function wipSummaryToCsv(rows: WipSummaryRow[]): string {
  const headers = ["stage", "planned", "active"];
  const formatted = rows.map((row) => ({
    stage: row.stage,
    planned: coerceNumber(row.planned),
    active: coerceNumber(row.active),
  }));
  return buildCsv(headers, formatted);
}

export function leadTimesToCsv(rows: OrderDispatchLeadTimeRow[]): string {
  const headers = [
    "order_code",
    "order_date",
    "first_dispatch_date",
    "days_order_to_dispatch",
  ];
  const formatted = rows.map((row) => ({
    order_code: row.order_code,
    order_date: row.order_date ?? "",
    first_dispatch_date: row.first_dispatch_date ?? "",
    days_order_to_dispatch: coerceNumber(row.days_order_to_dispatch),
  }));
  return buildCsv(headers, formatted);
}
