"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createVehicle, endShift, logLoad, recordLoad, startShift } from "@/lib/mining";

type ActionResult =
  | { ok: true }
  | { ok: false; error: string };

const uuidSchema = z.string().uuid("Invalid identifier");

function success(): ActionResult {
  revalidatePath("/mining");
  return { ok: true };
}

function failure(error: unknown, fallback: string): ActionResult {
  return {
    ok: false,
    error: error instanceof Error ? error.message : fallback,
  };
}

export async function createVehicleAction(raw: unknown): Promise<ActionResult> {
  try {
    const input = z
      .object({
        code: z.string().min(1, "Vehicle code is required"),
        type: z.string().trim().optional(),
        capacityTonnes: z
          .union([z.number(), z.string(), z.null(), z.undefined()])
          .transform((value) => {
            if (value === null || value === undefined || value === "") {
              return undefined;
            }
            const numeric = Number(value);
            return Number.isFinite(numeric) ? numeric : undefined;
          })
          .optional(),
      })
      .parse(raw);

    await createVehicle({
      code: input.code,
      type: input.type ?? null,
      capacityTonnes: input.capacityTonnes ?? null,
    });

    return success();
  } catch (error) {
    return failure(error, "Unable to register vehicle.");
  }
}

export async function startShiftAction(raw: unknown): Promise<ActionResult> {
  try {
    const input = z.object({ vehicleId: uuidSchema }).parse(raw);
    await startShift({ vehicleId: input.vehicleId });
    return success();
  } catch (error) {
    return failure(error, "Unable to start shift.");
  }
}

export async function logLoadAction(raw: unknown): Promise<ActionResult> {
  try {
    const input = z
      .object({
        shiftId: uuidSchema,
        stockpileId: uuidSchema,
        materialType: z.string().min(1, "Material type is required"),
        quantityTonnes: z
          .union([z.number(), z.string()])
          .transform((value) => Number(value))
          .refine((value) => Number.isFinite(value) && value > 0, {
            message: "Quantity must be greater than zero",
          }),
      })
      .parse(raw);

    await logLoad({
      shiftId: input.shiftId,
      stockpileId: input.stockpileId,
      materialType: input.materialType,
      quantityTonnes: input.quantityTonnes,
    });

    return success();
  } catch (error) {
    return failure(error, "Unable to log load.");
  }
}

export async function recordLoadAction(raw: unknown): Promise<ActionResult> {
  try {
    const input = z
      .object({
        shiftId: uuidSchema,
        stockpileId: uuidSchema,
        tonnage: z
          .union([z.number(), z.string()])
          .transform((value) => Number(value))
          .refine((value) => Number.isFinite(value) && value > 0, {
            message: "Tonnage must be greater than zero.",
          }),
        moisturePct: z
          .union([z.number(), z.string(), z.null(), z.undefined()])
          .transform((value) => {
            if (value === null || value === undefined || value === "") {
              return undefined;
            }
            if (typeof value === "number") {
              return value;
            }
            const numeric = Number(value);
            return Number.isFinite(numeric) ? numeric : Number.NaN;
          })
          .refine(
            (value) =>
              value === undefined ||
              (Number.isFinite(value) && value >= 0 && value <= 100),
            {
              message: "Moisture must be between 0 and 100%.",
            },
          )
          .optional(),
        notes: z
          .union([z.string(), z.null(), z.undefined()])
          .transform((value) => {
            if (typeof value !== "string") {
              return undefined;
            }
            const trimmed = value.trim();
            return trimmed.length > 0 ? trimmed : undefined;
          })
          .refine(
            (value) => value === undefined || value.length <= 500,
            {
              message: "Notes should be shorter than 500 characters.",
            },
          )
          .optional(),
      })
      .parse(raw);

    await recordLoad({
      shiftId: input.shiftId,
      stockpileId: input.stockpileId,
      tonnage: input.tonnage,
      moisturePct:
        input.moisturePct !== undefined ? Number(input.moisturePct) : undefined,
      notes: input.notes,
    });

    return success();
  } catch (error) {
    return failure(error, "Unable to record load.");
  }
}

export async function endShiftAction(raw: unknown): Promise<ActionResult> {
  try {
    const input = z.object({ shiftId: uuidSchema }).parse(raw);
    await endShift({ shiftId: input.shiftId });
    return success();
  } catch (error) {
    return failure(error, "Unable to end shift.");
  }
}
