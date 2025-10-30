"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  addInput,
  cancelPallet,
  closePallet,
  createLocation,
  createPallet,
  gradePallet,
  movePallet,
  printLabel,
  releaseReservation,
  reserveUnits,
  scrapUnits,
} from "@/lib/packing";

function success() {
  revalidatePath("/packing");
  return { ok: true as const };
}

function failure(message: string) {
  return { ok: false as const, error: message };
}

const idSchema = z.string().uuid("Invalid identifier");

const numericTransform = z
  .union([z.number(), z.string()])
  .transform((value) => {
    const num = typeof value === "string" ? Number(value) : value;
    return Number.isFinite(num) ? num : Number.NaN;
  });

const optionalNumeric = z
  .union([z.number(), z.string(), z.null(), z.undefined()])
  .transform((value) => {
    if (value === null || value === undefined) {
      return undefined;
    }
    if (typeof value === "string" && value.trim() === "") {
      return undefined;
    }
    const num = Number(value);
    return Number.isFinite(num) ? num : undefined;
  })
  .optional();

export async function createLocationAction(raw: unknown) {
  try {
    const schema = z.object({
      code: z.string().min(1, "Code is required"),
      type: z.string().trim().optional(),
      capacityPallets: optionalNumeric,
      status: z.string().trim().optional(),
    });
    const input = schema.parse(raw);
    await createLocation({
      code: input.code,
      type: input.type ?? null,
      capacityPallets: input.capacityPallets ?? null,
      status: input.status ?? "active",
    });
    return success();
  } catch (error) {
    return failure(
      error instanceof Error ? error.message : "Unable to create location",
    );
  }
}

export async function createPalletAction(raw: unknown) {
  try {
    const schema = z.object({
      code: z.string().min(1, "Code is required"),
      productSku: z.string().min(1, "Product SKU is required"),
      grade: z.string().min(1, "Grade is required"),
      capacityUnits: optionalNumeric,
      locationId: z
        .union([z.string().uuid(), z.literal(""), z.null(), z.undefined()])
        .transform((value) => {
          if (!value) return undefined;
          if (value === "") return undefined;
          return value;
        })
        .optional(),
    });
    const input = schema.parse(raw);
    await createPallet({
      code: input.code,
      productSku: input.productSku,
      grade: input.grade,
      capacityUnits: input.capacityUnits ?? null,
      locationId: input.locationId ?? null,
    });
    return success();
  } catch (error) {
    return failure(
      error instanceof Error ? error.message : "Unable to create pallet",
    );
  }
}

export async function addInputAction(raw: unknown) {
  try {
    const schema = z.object({
      palletId: idSchema,
      kilnBatchId: idSchema,
      quantityUnits: numericTransform.refine(
        (value) => Number.isFinite(value) && value > 0,
        { message: "Quantity must be greater than zero" },
      ),
      reference: z.string().trim().optional(),
    });
    const input = schema.parse(raw);
    await addInput({
      palletId: input.palletId,
      kilnBatchId: input.kilnBatchId,
      quantityUnits: input.quantityUnits,
      reference: input.reference ?? null,
    });
    return success();
  } catch (error) {
    return failure(
      error instanceof Error ? error.message : "Unable to add input",
    );
  }
}

export async function gradePalletAction(raw: unknown) {
  try {
    const input = z
      .object({
        palletId: idSchema,
        grade: z.string().min(1, "Grade is required"),
      })
      .parse(raw);
    await gradePallet({ palletId: input.palletId, grade: input.grade });
    return success();
  } catch (error) {
    return failure(
      error instanceof Error ? error.message : "Unable to grade pallet",
    );
  }
}

export async function movePalletAction(raw: unknown) {
  try {
    const input = z
      .object({
        palletId: idSchema,
        toLocationId: idSchema,
      })
      .parse(raw);
    await movePallet({
      palletId: input.palletId,
      toLocationId: input.toLocationId,
    });
    return success();
  } catch (error) {
    return failure(
      error instanceof Error ? error.message : "Unable to move pallet",
    );
  }
}

export async function printLabelAction(raw: unknown) {
  try {
    const input = z
      .object({
        palletId: idSchema,
        labelType: z.string().trim().optional(),
      })
      .parse(raw);
    await printLabel({
      palletId: input.palletId,
      labelType: input.labelType ?? null,
    });
    return success();
  } catch (error) {
    return failure(
      error instanceof Error ? error.message : "Unable to log label print",
    );
  }
}

export async function reserveUnitsAction(raw: unknown) {
  try {
    const schema = z.object({
      palletId: idSchema,
      orderId: z.string().min(1, "Order reference is required"),
      quantityUnits: numericTransform.refine(
        (value) => Number.isFinite(value) && value > 0,
        { message: "Quantity must be greater than zero" },
      ),
    });
    const input = schema.parse(raw);
    await reserveUnits({
      palletId: input.palletId,
      orderId: input.orderId,
      quantityUnits: input.quantityUnits,
    });
    return success();
  } catch (error) {
    return failure(
      error instanceof Error ? error.message : "Unable to reserve units",
    );
  }
}

export async function releaseReservationAction(raw: unknown) {
  try {
    const schema = z.object({
      palletId: idSchema,
      orderId: z.string().min(1, "Order reference is required"),
      quantityUnits: numericTransform.refine(
        (value) => Number.isFinite(value) && value > 0,
        { message: "Quantity must be greater than zero" },
      ),
    });
    const input = schema.parse(raw);
    await releaseReservation({
      palletId: input.palletId,
      orderId: input.orderId,
      quantityUnits: input.quantityUnits,
    });
    return success();
  } catch (error) {
    return failure(
      error instanceof Error
        ? error.message
        : "Unable to release reservation",
    );
  }
}

export async function scrapUnitsAction(raw: unknown) {
  try {
    const schema = z.object({
      palletId: idSchema,
      scrapUnits: numericTransform.refine(
        (value) => Number.isFinite(value) && value > 0,
        { message: "Scrap must be greater than zero" },
      ),
      reason: z.string().trim().optional(),
    });
    const input = schema.parse(raw);
    await scrapUnits({
      palletId: input.palletId,
      scrapUnits: input.scrapUnits,
      reason: input.reason ?? null,
    });
    return success();
  } catch (error) {
    return failure(
      error instanceof Error ? error.message : "Unable to record scrap",
    );
  }
}

export async function closePalletAction(raw: unknown) {
  try {
    const input = z.object({ palletId: idSchema }).parse(raw);
    await closePallet({ palletId: input.palletId });
    return success();
  } catch (error) {
    return failure(
      error instanceof Error ? error.message : "Unable to close pallet",
    );
  }
}

export async function cancelPalletAction(raw: unknown) {
  try {
    const input = z
      .object({
        palletId: idSchema,
        reason: z.string().trim().optional(),
      })
      .parse(raw);
    await cancelPallet({
      palletId: input.palletId,
      reason: input.reason ?? null,
    });
    return success();
  } catch (error) {
    return failure(
      error instanceof Error ? error.message : "Unable to cancel pallet",
    );
  }
}
