"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  addComponent,
  cancelBatch,
  completeBatch,
  createBatch,
  removeComponent,
  startBatch,
} from "@/lib/mixing";

function success() {
  revalidatePath("/mixing");
  return { ok: true as const };
}

function failure(message: string) {
  return { ok: false as const, error: message };
}

const idSchema = z.string().uuid("Invalid identifier");

export async function createBatchAction(raw: unknown) {
  try {
    const schema = z.object({
      code: z.string().min(1, "Code is required"),
      targetOutputTonnes: z
        .union([z.number(), z.string(), z.null(), z.undefined()])
        .transform((value) => {
          if (typeof value === "string" && value.trim() === "") {
            return undefined;
          }
          const num = Number(value);
          return Number.isFinite(num) ? num : undefined;
        })
        .optional(),
    });
    const input = schema.parse(raw);
    await createBatch({
      code: input.code,
      targetOutputTonnes: input.targetOutputTonnes ?? null,
    });
    return success();
  } catch (error) {
    return failure(error instanceof Error ? error.message : "Unable to create batch");
  }
}

export async function addComponentAction(raw: unknown) {
  try {
    const schema = z.object({
      batchId: idSchema,
      stockpileId: idSchema,
      quantityTonnes: z
        .union([z.number(), z.string()])
        .transform((value) => Number(value))
        .refine((value) => Number.isFinite(value) && value > 0, {
          message: "Quantity must be greater than zero",
        }),
      materialType: z.string().min(1, "Material type is required"),
      reference: z.string().trim().optional(),
    });
    const input = schema.parse(raw);
    await addComponent({
      batchId: input.batchId,
      stockpileId: input.stockpileId,
      quantityTonnes: input.quantityTonnes,
      materialType: input.materialType,
      reference: input.reference ?? null,
    });
    return success();
  } catch (error) {
    return failure(error instanceof Error ? error.message : "Unable to add component");
  }
}

export async function removeComponentAction(raw: unknown) {
  try {
    const schema = z.object({
      batchId: idSchema,
      stockpileId: idSchema,
      quantityTonnes: z
        .union([z.number(), z.string()])
        .transform((value) => Number(value))
        .refine((value) => Number.isFinite(value) && value > 0, {
          message: "Quantity must be greater than zero",
        }),
      reference: z.string().trim().optional(),
    });
    const input = schema.parse(raw);
    await removeComponent({
      batchId: input.batchId,
      stockpileId: input.stockpileId,
      quantityTonnes: input.quantityTonnes,
      reference: input.reference ?? null,
    });
    return success();
  } catch (error) {
    return failure(error instanceof Error ? error.message : "Unable to remove component");
  }
}

export async function startBatchAction(raw: unknown) {
  try {
    const input = z.object({ batchId: idSchema }).parse(raw);
    await startBatch({ batchId: input.batchId });
    return success();
  } catch (error) {
    return failure(error instanceof Error ? error.message : "Unable to start batch");
  }
}

export async function completeBatchAction(raw: unknown) {
  try {
    const schema = z.object({
      batchId: idSchema,
      outputTonnes: z
        .union([z.number(), z.string(), z.null(), z.undefined()])
        .transform((value) => {
          if (value === null || value === undefined) return undefined;
          const num = Number(value);
          return Number.isFinite(num) ? num : undefined;
        })
        .optional(),
      moisturePct: z
        .union([z.number(), z.string(), z.null(), z.undefined()])
        .transform((value) => {
          if (value === null || value === undefined) return undefined;
          const num = Number(value);
          return Number.isFinite(num) ? num : undefined;
        })
        .optional(),
    });
    const input = schema.parse(raw);
    await completeBatch({
      batchId: input.batchId,
      outputTonnes: input.outputTonnes ?? null,
      moisturePct: input.moisturePct ?? null,
    });
    return success();
  } catch (error) {
    return failure(error instanceof Error ? error.message : "Unable to complete batch");
  }
}

export async function cancelBatchAction(raw: unknown) {
  try {
    const input = z
      .object({
        batchId: idSchema,
        reason: z.string().trim().optional(),
      })
      .parse(raw);
    await cancelBatch({ batchId: input.batchId, reason: input.reason ?? null });
    return success();
  } catch (error) {
    return failure(error instanceof Error ? error.message : "Unable to cancel batch");
  }
}
