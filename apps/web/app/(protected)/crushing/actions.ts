"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  addInput,
  cancelRun,
  completeRun,
  createRun,
  logDowntime,
  recordOutput,
  startRun,
} from "@/lib/crushing";

const idSchema = z.string().uuid("Invalid id");

function toNumber(value: unknown) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error("Invalid numeric value.");
  }
  return num;
}

function success() {
  revalidatePath("/crushing");
  return { ok: true as const };
}

function failure(error: unknown, fallback: string) {
  return {
    ok: false as const,
    error: error instanceof Error ? error.message : fallback,
  };
}

export async function createRunAction(raw: unknown) {
  try {
    const schema = z.object({
      code: z.string().min(1, "Run code is required"),
      targetTPH: z
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
    await createRun({
      code: input.code,
      targetTPH: input.targetTPH ?? null,
    });
    return success();
  } catch (error) {
    return failure(error, "Unable to create run");
  }
}

export async function addInputAction(raw: unknown) {
  try {
    const schema = z.object({
      runId: idSchema,
      mixBatchId: idSchema,
      quantityTonnes: z
        .union([z.number(), z.string()])
        .transform((value) => toNumber(value))
        .refine((value) => value > 0, "Quantity must be greater than zero"),
      reference: z.string().trim().optional(),
    });
    const input = schema.parse(raw);
    await addInput({
      runId: input.runId,
      mixBatchId: input.mixBatchId,
      quantityTonnes: input.quantityTonnes,
      reference: input.reference ?? null,
    });
    return success();
  } catch (error) {
    return failure(error, "Unable to add input");
  }
}

export async function startRunAction(raw: unknown) {
  try {
    const { runId } = z.object({ runId: idSchema }).parse(raw);
    await startRun({ runId });
    return success();
  } catch (error) {
    return failure(error, "Unable to start run");
  }
}

export async function logDowntimeAction(raw: unknown) {
  try {
    const schema = z.object({
      runId: idSchema,
      minutes: z
        .union([z.number(), z.string()])
        .transform((value) => toNumber(value))
        .refine((value) => value > 0, "Minutes must be greater than zero"),
      reason: z.string().min(1, "Reason is required"),
    });
    const input = schema.parse(raw);
    await logDowntime({
      runId: input.runId,
      minutes: input.minutes,
      reason: input.reason,
    });
    return success();
  } catch (error) {
    return failure(error, "Unable to log downtime");
  }
}

export async function recordOutputAction(raw: unknown) {
  try {
    const schema = z.object({
      runId: idSchema,
      outputTonnes: z
        .union([z.number(), z.string()])
        .transform((value) => toNumber(value))
        .refine((value) => value >= 0, "Output cannot be negative"),
      finesPct: z
        .union([z.number(), z.string(), z.null(), z.undefined()])
        .transform((value) => {
          if (value === null || value === undefined) return undefined;
          const trimmed = typeof value === "string" ? value.trim() : value;
          if (trimmed === "") return undefined;
          const num = Number(trimmed);
          if (!Number.isFinite(num)) {
            throw new Error("Invalid fines percent");
          }
          return num;
        })
        .optional(),
    });
    const input = schema.parse(raw);
    await recordOutput({
      runId: input.runId,
      outputTonnes: input.outputTonnes,
      finesPct: input.finesPct ?? null,
    });
    return success();
  } catch (error) {
    return failure(error, "Unable to record output");
  }
}

export async function completeRunAction(raw: unknown) {
  try {
    const { runId } = z.object({ runId: idSchema }).parse(raw);
    await completeRun({ runId });
    return success();
  } catch (error) {
    return failure(error, "Unable to complete run");
  }
}

export async function cancelRunAction(raw: unknown) {
  try {
    const schema = z.object({
      runId: idSchema,
      reason: z.string().trim().optional(),
    });
    const input = schema.parse(raw);
    await cancelRun({
      runId: input.runId,
      reason: input.reason ?? null,
    });
    return success();
  } catch (error) {
    return failure(error, "Unable to cancel run");
  }
}
