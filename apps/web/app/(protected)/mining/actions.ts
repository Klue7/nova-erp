"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createVehicle, endShift, logLoad, startShift } from "@/lib/mining";

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

export async function endShiftAction(raw: unknown): Promise<ActionResult> {
  try {
    const input = z.object({ shiftId: uuidSchema }).parse(raw);
    await endShift({ shiftId: input.shiftId });
    return success();
  } catch (error) {
    return failure(error, "Unable to end shift.");
  }
}

