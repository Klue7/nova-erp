import { describe, expect, it } from "vitest";

import {
  reserveSchema,
  scrapSchema,
} from "../components/packing-actions";

describe("Packing form schemas", () => {
  it("requires positive quantity for reservations", () => {
    expect(() =>
      reserveSchema.parse({ orderId: "ORD-1", quantityUnits: 5 }),
    ).not.toThrow();

    expect(() =>
      reserveSchema.parse({ orderId: "ORD-1", quantityUnits: 0 }),
    ).toThrowError(/greater than zero/i);
  });

  it("requires scrap units to be positive", () => {
    expect(() => scrapSchema.parse({ scrapUnits: 3 })).not.toThrow();

    expect(() => scrapSchema.parse({ scrapUnits: -1 })).toThrowError(
      /greater than zero/i,
    );
  });
});
