"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  addInput,
  cancelBatch,
  completeBatch,
  createBatch,
  pauseBatch,
  recordFuelUsage,
  recordOutput,
  recordZoneTemp,
  resumeBatch,
  startBatch,
} from "@/lib/kiln";

const idSchema = z.string().uuid("Invalid identifier");

function toNumber(value: unknown) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error("Invalid numeric value.");
  }
  return num;
}

function success() {
  revalidatePath("/kiln");
  return { ok: true as const };
}

function failure(error: unknown, fallback: string) {
  return {
    ok: false as const,
    error: error instanceof Error ? error.message : fallback,
  };
}

export async function createBatchAction(raw: unknown) {
  try {
    const schema = z.object({
      code: z.string().min(1, "Batch code is required"),
      kilnCode: z.string().trim().optional(),
      firingCurveCode: z.string().trim().optional(),
      targetUnits: z
        .union([z.number(), z.string(), z.null(), z.undefined()])
        .transform((value) => {
          if (value === null || value === undefined) return undefined;
          const trimmed = typeof value === "string" ? value.trim() : value;
          if (trimmed === "") return undefined;
          const num = Number(trimmed);
          return Number.isFinite(num) ? num : undefined;
        })
        .optional(),
    });
    const input = schema.parse(raw);
    await createBatch({
      code: input.code,
      kilnCode: input.kilnCode ?? null,
      firingCurveCode: input.firingCurveCode ?? null,
      targetUnits: input.targetUnits ?? null,
    });
    return success();
  } catch (error) {
    return failure(error, "Unable to create batch");
  }
}

export async function addInputAction(raw: unknown) {
  try {
    const schema = z.object({
      batchId: idSchema,
      dryLoadId: idSchema,
      quantityUnits: z
        .union([z.number(), z.string()])
        .transform((value) => toNumber(value))
        .refine((value) => value > 0, "Quantity must be greater than zero"),
      reference: z.string().trim().optional(),
    });
    const input = schema.parse(raw);
    await addInput({
      batchId: input.batchId,
      dryLoadId: input.dryLoadId,
      quantityUnits: input.quantityUnits,
      reference: input.reference ?? null,
    });
    return success();
  } catch (error) {
    return failure(error, "Unable to add input");
  }
}

export async function startBatchAction(raw: unknown) {
  try {
    const { batchId } = z.object({ batchId: idSchema }).parse(raw);
    await startBatch({ batchId });
    return success();
  } catch (error) {
    return failure(error, "Unable to start batch");
  }
}

export async function pauseBatchAction(raw: unknown) {
  try {
    const schema = z.object({
      batchId: idSchema,
      minutes: z
        .union([z.number(), z.string()])
        .transform((value) => toNumber(value))
        .refine((value) => value > 0, "Minutes must be greater than zero"),
      reason: z.string().min(1, "Reason is required"),
    });
    const input = schema.parse(raw);
    await pauseBatch({
      batchId: input.batchId,
      minutes: input.minutes,
      reason: input.reason,
    });
    return success();
  } catch (error) {
    return failure(error, "Unable to pause batch");
  }
}

export async function resumeBatchAction(raw: unknown) {
  try {
    const { batchId } = z.object({ batchId: idSchema }).parse(raw);
    await resumeBatch({ batchId });
    return success();
  } catch (error) {
    return failure(error, "Unable to resume batch");
  }
}

export async function recordZoneTempAction(raw: unknown) {
  try {
    const schema = z.object({
      batchId: idSchema,
      zone: z.string().min(1, "Zone is required"),
      temperatureC: z
        .union([z.number(), z.string()])
        .transform((value) => toNumber(value))
        .refine((value) => value > 0, "Temperature must be greater than zero"),
    });
    const input = schema.parse(raw);
    await recordZoneTemp({
      batchId: input.batchId,
      zone: input.zone,
      temperatureC: input.temperatureC,
    });
    return success();
  } catch (error) {
    return failure(error, "Unable to record temperature");
  }
}

export async function recordFuelUsageAction(raw: unknown) {
  try {
    const schema = z.object({
      batchId: idSchema,
      fuelType: z.string().min(1, "Fuel type is required"),
      amount: z
        .union([z.number(), z.string()])
        .transform((value) => toNumber(value))
        .refine((value) => value > 0, "Amount must be greater than zero"),
      unit: z.string().min(1, "Unit is required"),
    });
    const input = schema.parse(raw);
    await recordFuelUsage({
      batchId: input.batchId,
      fuelType: input.fuelType,
      amount: input.amount,
      unit: input.unit,
    });
    return success();
  } catch (error) {
    return failure(error, "Unable to record fuel usage");
  }
}

export async function recordOutputAction(raw: unknown) {
  try {
    const schema = z.object({
      batchId: idSchema,
      firedUnits: z
        .union([z.number(), z.string()])
        .transform((value) => toNumber(value))
        .refine((value) => value >= 0, "Fired units cannot be negative"),
      shrinkagePct: z
        .union([z.number(), z.string(), z.null(), z.undefined()])
        .transform((value) => {
          if (value === null || value === undefined) return undefined;
          const trimmed = typeof value === "string" ? value.trim() : value;
          if (trimmed === "") return undefined;
          const num = Number(trimmed);
          if (!Number.isFinite(num)) {
            throw new Error("Invalid shrinkage percent");
          }
          return num;
        })
        .optional(),
    });
    const input = schema.parse(raw);
    await recordOutput({
      batchId: input.batchId,
      firedUnits: input.firedUnits,
      shrinkagePct: input.shrinkagePct ?? null,
    });
    return success();
  } catch (error) {
    return failure(error, "Unable to record output");
  }
}

export async function completeBatchAction(raw: unknown) {
  try {
    const { batchId } = z.object({ batchId: idSchema }).parse(raw);
    await completeBatch({ batchId });
    return success();
  } catch (error) {
    return failure(error, "Unable to complete batch");
  }
}

export async function cancelBatchAction(raw: unknown) {
  try {
    const schema = z.object({
      batchId: idSchema,
      reason: z.string().trim().optional(),
    });
    const input = schema.parse(raw);
    await cancelBatch({
      batchId: input.batchId,
      reason: input.reason ?? null,
    });
    return success();
  } catch (error) {
    return failure(error, "Unable to cancel batch");
  }
}
