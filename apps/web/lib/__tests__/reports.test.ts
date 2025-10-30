import { describe, expect, it } from "vitest";

import {
  calculatePercentiles,
  dailyThroughputToCsv,
  isDateWithinRange,
  leadTimesToCsv,
} from "@/lib/reports";

describe("reports helpers", () => {
  it("filters dates within range", () => {
    const rows = [
      { d: "2024-01-01" },
      { d: "2024-01-10" },
      { d: "2024-02-05" },
    ];
    const filtered = rows.filter((row) =>
      isDateWithinRange(row.d, "2024-01-05", "2024-01-31"),
    );
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.d).toBe("2024-01-10");
  });

  it("computes p50 and p90 percentiles", () => {
    const { p50, p90 } = calculatePercentiles([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(p50).toBe(5);
    expect(p90).toBeCloseTo(8.2, 1);
  });

  it("exports CSV data with headers", () => {
    const csv = dailyThroughputToCsv([
      {
        tenant_id: "t",
        d: "2024-06-01",
        mix_input_tonnes: 10,
        crush_output_tonnes: 9,
        extrusion_output_units: 800,
        packed_units: 750,
        units_dispatched: 700,
      },
    ]);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe(
      "date,mix_input_tonnes,crush_output_tonnes,extrusion_output_units,packed_units,units_dispatched",
    );
    expect(lines[1]).toBe("2024-06-01,10,9,800,750,700");
  });

  it("exports lead time CSV with numeric days", () => {
    const csv = leadTimesToCsv([
      {
        tenant_id: "t",
        order_id: "o1",
        order_code: "SO-01",
        order_date: "2024-05-01",
        first_dispatch_date: "2024-05-05",
        days_order_to_dispatch: 4,
      },
    ]);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe(
      "order_code,order_date,first_dispatch_date,days_order_to_dispatch",
    );
    expect(lines[1]).toBe("SO-01,2024-05-01,2024-05-05,4");
  });
});
