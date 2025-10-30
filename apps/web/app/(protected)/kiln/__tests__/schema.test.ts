import { describe, expect, it } from "vitest";

import {
  addInputSchema,
  fuelSchema,
  outputSchema,
  pauseSchema,
  zoneTempSchema,
} from "../components/kiln-actions";

describe("Kiln action schemas", () => {
  it("rejects non-positive input quantity", () => {
    expect(() =>
      addInputSchema.parse({
        dryLoadId: "00000000-0000-0000-0000-000000000000",
        quantityUnits: 0,
      }),
    ).toThrow();

    expect(() =>
      addInputSchema.parse({
        dryLoadId: "00000000-0000-0000-0000-000000000000",
        quantityUnits: 10,
      }),
    ).not.toThrow();
  });

  it("enforces positive pause minutes", () => {
    expect(() =>
      pauseSchema.parse({ minutes: -5, reason: "" }),
    ).toThrow();

    expect(() =>
      pauseSchema.parse({ minutes: 15, reason: "Maintenance" }),
    ).not.toThrow();
  });

  it("validates temperature and fuel amounts", () => {
    expect(() =>
      zoneTempSchema.parse({ zone: "A1", temperatureC: 0 }),
    ).toThrow();

    expect(() =>
      zoneTempSchema.parse({ zone: "A1", temperatureC: 950 }),
    ).not.toThrow();

    expect(() =>
      fuelSchema.parse({ fuelType: "Gas", amount: -1, unit: "m3" }),
    ).toThrow();

    expect(() =>
      fuelSchema.parse({ fuelType: "Gas", amount: 12.5, unit: "m3" }),
    ).not.toThrow();
  });

  it("allows zero fired units but not negative", () => {
    expect(() =>
      outputSchema.parse({ firedUnits: -1 }),
    ).toThrow();

    expect(() =>
      outputSchema.parse({ firedUnits: 0 }),
    ).not.toThrow();
  });
});
