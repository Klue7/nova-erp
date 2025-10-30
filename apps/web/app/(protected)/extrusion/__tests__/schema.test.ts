import { describe, expect, it } from "vitest";

import {
  addInputSchema,
  outputSchema,
} from "../components/extrusion-actions";

describe("Extrusion action schemas", () => {
  it("rejects negative crushed input quantities", () => {
    expect(() =>
      addInputSchema.parse({
        crushRunId: "00000000-0000-0000-0000-000000000000",
        quantityTonnes: -2,
      }),
    ).toThrow();

    expect(() =>
      addInputSchema.parse({
        crushRunId: "00000000-0000-0000-0000-000000000000",
        quantityTonnes: 2.5,
      }),
    ).not.toThrow();
  });

  it("allows zero output units but rejects negatives", () => {
    expect(() =>
      outputSchema.parse({
        outputUnits: -1,
      }),
    ).toThrow();

    expect(() =>
      outputSchema.parse({
        outputUnits: 0,
      }),
    ).not.toThrow();
  });
});
