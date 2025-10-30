import { describe, expect, it } from "vitest";

import {
  addInputSchema,
  moistureSchema,
} from "../components/dry-actions";

describe("Dry Yard schemas", () => {
  it("rejects non-positive quantity for inputs", () => {
    expect(() =>
      addInputSchema.parse({
        extrusionRunId: "00000000-0000-0000-0000-000000000000",
        quantityUnits: 0,
      }),
    ).toThrow();

    expect(() =>
      addInputSchema.parse({
        extrusionRunId: "00000000-0000-0000-0000-000000000000",
        quantityUnits: 5,
      }),
    ).not.toThrow();
  });

  it("validates moisture between 0 and 100", () => {
    expect(() =>
      moistureSchema.parse({
        moisturePct: -5,
      }),
    ).toThrow();

    expect(() =>
      moistureSchema.parse({
        moisturePct: 105,
      }),
    ).toThrow();

    expect(() =>
      moistureSchema.parse({
        moisturePct: 45,
      }),
    ).not.toThrow();
  });
});
