"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { endShift, recordLoad, startShift } from "@/lib/mining";

const startShiftSchema = z.object({
  vehicleId: z.string().uuid("Select a vehicle."),
});

const endShiftSchema = z.object({
  shiftId: z.string().uuid("Missing shift id."),
});

const moistureSchema = z.preprocess(
  (value) => {
    if (value === "" || value === null || value === undefined) {
      return undefined;
    }
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : value;
  },
  z.union([
    z
      .number({ invalid_type_error: "Moisture must be a number." })
      .min(0, "Moisture must be between 0 and 100%.")
      .max(100, "Moisture must be between 0 and 100%."),
    z.undefined(),
  ]),
);

const recordLoadSchema = z.object({
  shiftId: z.string().uuid("Missing shift id."),
  stockpileId: z.string().uuid("Select a stockpile."),
  tonnage: z.coerce
    .number({ invalid_type_error: "Enter a tonnage." })
    .positive("Tonnage must be greater than zero."),
  moisturePct: moistureSchema.optional(),
  notes: z
    .string()
    .trim()
    .max(500, "Notes should be shorter than 500 characters.")
    .optional(),
});

export async function startShiftAction(raw: unknown) {
  const input = startShiftSchema.parse(raw);
  await startShift({ vehicleId: input.vehicleId });
  revalidatePath("/mining");
  return { ok: true };
}

export async function endShiftAction(raw: unknown) {
  const input = endShiftSchema.parse(raw);
  await endShift({ shiftId: input.shiftId });
  revalidatePath("/mining");
  return { ok: true };
}

export async function recordLoadAction(raw: unknown) {
  const input = recordLoadSchema.parse(raw);
  await recordLoad({
    shiftId: input.shiftId,
    stockpileId: input.stockpileId,
    tonnage: input.tonnage,
    moisturePct: input.moisturePct ?? null,
    notes: input.notes ?? null,
  });
  revalidatePath("/mining");
  return { ok: true };
}
