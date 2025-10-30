"use server";

import {
  dailyThroughputToCsv,
  leadTimesToCsv,
  wipSummaryToCsv,
} from "@/lib/reports";
import {
  getDailyThroughput,
  getOrderDispatchLeadTimes,
  getWipSummary,
} from "@/lib/reports.server";

type CsvResult =
  | { success: true; filename: string; csv: string }
  | { success: false; error: string };

function normalizeRange(input: { from?: string | null; to?: string | null }) {
  const from = input.from?.trim() || undefined;
  const to = input.to?.trim() || undefined;
  return { from, to };

}

export async function exportThroughputCsvAction(input: {
  from?: string | null;
  to?: string | null;
}): Promise<CsvResult> {
  try {
    const range = normalizeRange(input ?? {});
    const rows = await getDailyThroughput(range);
    const csv = dailyThroughputToCsv(rows);
    const filename = `throughput-${range.from ?? "all"}-${range.to ?? "latest"}.csv`;
    return { success: true, filename, csv };
  } catch (error) {
    console.error("reports.exportThroughput", error);
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to generate throughput CSV.",
    };
  }
}

export async function exportWipCsvAction(): Promise<CsvResult> {
  try {
    const rows = await getWipSummary();
    const csv = wipSummaryToCsv(rows);
    return { success: true, filename: "wip-summary.csv", csv };
  } catch (error) {
    console.error("reports.exportWip", error);
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to generate WIP CSV.",
    };
  }
}

export async function exportLeadTimesCsvAction(input: {
  from?: string | null;
  to?: string | null;
}): Promise<CsvResult> {
  try {
    const range = normalizeRange(input ?? {});
    const rows = await getOrderDispatchLeadTimes(range);
    const csv = leadTimesToCsv(rows);
    const filename = `lead-times-${range.from ?? "all"}-${range.to ?? "latest"}.csv`;
    return { success: true, filename, csv };
  } catch (error) {
    console.error("reports.exportLeadTimes", error);
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to generate lead time CSV.",
    };
  }
}
