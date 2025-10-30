import { describe, expect, it } from "vitest";

import { pickSchema, weighSchema } from "../components/dispatch-detail";

describe("Dispatch schemas", () => {
  it("enforces positive quantities for picks", () => {
    expect(() =>
      pickSchema.parse({
        shipmentId: crypto.randomUUID(),
        palletId: crypto.randomUUID(),
        quantityUnits: 5,
      }),
    ).not.toThrow();

    expect(() =>
      pickSchema.parse({
        shipmentId: crypto.randomUUID(),
        palletId: crypto.randomUUID(),
        quantityUnits: 0,
      }),
    ).toThrowError(/greater than zero/i);
  });

  it("enforces positive gross weight for weighbridge", () => {
    expect(() =>
      weighSchema.parse({
        shipmentId: crypto.randomUUID(),
        grossKg: 15,
        tareKg: 3,
      }),
    ).not.toThrow();

    expect(() =>
      weighSchema.parse({
        shipmentId: crypto.randomUUID(),
        grossKg: 0,
      }),
    ).toThrowError(/greater than zero/i);
  });
});
