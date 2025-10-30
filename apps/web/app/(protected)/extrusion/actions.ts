"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  addInput,
  cancelRun,
  changeDie,
  completeRun,
  createRun,
  pauseRun,
  recordOutput,
  recordScrap,
  resumeRun,
  startRun,
} from "@/lib/extrusion";

const idSchema = z.string().uuid("Invalid id");

function toNumber(value: unknown) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error("Invalid numeric value.");
  }
  return num;
}

function success() {
  revalidatePath("/extrusion");
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
      pressLine: z.string().trim().optional(),
      dieCode: z.string().trim().optional(),
      productSku: z.string().trim().optional(),
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
    await createRun({
      code: input.code,
      pressLine: input.pressLine ?? null,
      dieCode: input.dieCode ?? null,
      productSku: input.productSku ?? null,
      targetUnits: input.targetUnits ?? null,
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
      crushRunId: idSchema,
      quantityTonnes: z
        .union([z.number(), z.string()])
        .transform((value) => toNumber(value))
        .refine((value) => value > 0, "Quantity must be greater than zero"),
      reference: z.string().trim().optional(),
    });
    const input = schema.parse(raw);
    await addInput({
      runId: input.runId,
      crushRunId: input.crushRunId,
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

export async function pauseRunAction(raw: unknown) {
  try {
    const schema = z.object({
      runId: idSchema,
      minutes: z
        .union([z.number(), z.string()])
        .transform((value) => toNumber(value))
        .refine((value) => value > 0, "Minutes must be greater than zero"),
      reason: z.string().min(1, "Provide a reason"),
    });
    const input = schema.parse(raw);
    await pauseRun({
      runId: input.runId,
      minutes: input.minutes,
      reason: input.reason,
    });
    return success();
  } catch (error) {
    return failure(error, "Unable to pause run");
  }
}

export async function resumeRunAction(raw: unknown) {
  try {
    const { runId } = z.object({ runId: idSchema }).parse(raw);
    await resumeRun({ runId });
    return success();
  } catch (error) {
    return failure(error, "Unable to resume run");
  }
}

export async function recordOutputAction(raw: unknown) {
  try {
    const schema = z.object({
      runId: idSchema,
      outputUnits: z
        .union([z.number(), z.string()])
        .transform((value) => toNumber(value))
        .refine((value) => value >= 0, "Output cannot be negative"),
      meters: z
        .union([z.number(), z.string(), z.null(), z.undefined()])
        .transform((value) => {
          if (value === null || value === undefined) return undefined;
          const trimmed = typeof value === "string" ? value.trim() : value;
          if (trimmed === "") return undefined;
          const num = Number(trimmed);
          if (!Number.isFinite(num)) {
            throw new Error("Invalid meters value");
          }
          return num;
        })
        .optional(),
      weightTonnes: z
        .union([z.number(), z.string(), z.null(), z.undefined()])
        .transform((value) => {
          if (value === null || value === undefined) return undefined;
          const trimmed = typeof value === "string" ? value.trim() : value;
          if (trimmed === "") return undefined;
          const num = Number(trimmed);
          if (!Number.isFinite(num)) {
            throw new Error("Invalid weight value");
          }
          return num;
        })
        .optional(),
    });
    const input = schema.parse(raw);
    await recordOutput({
      runId: input.runId,
      outputUnits: input.outputUnits,
      meters: input.meters ?? null,
      weightTonnes: input.weightTonnes ?? null,
    });
    return success();
  } catch (error) {
    return failure(error, "Unable to record output");
  }
}

export async function recordScrapAction(raw: unknown) {
  try {
    const schema = z.object({
      runId: idSchema,
      scrapUnits: z
        .union([z.number(), z.string()])
        .transform((value) => toNumber(value))
        .refine((value) => value > 0, "Scrap must be greater than zero"),
      reason: z.string().trim().optional(),
    });
    const input = schema.parse(raw);
    await recordScrap({
      runId: input.runId,
      scrapUnits: input.scrapUnits,
      reason: input.reason ?? null,
    });
    return success();
  } catch (error) {
    return failure(error, "Unable to record scrap");
  }
}

export async function changeDieAction(raw: unknown) {
  try {
    const schema = z.object({
      runId: idSchema,
      dieCode: z.string().min(1, "Die code is required"),
    });
    const input = schema.parse(raw);
    await changeDie({
      runId: input.runId,
      dieCode: input.dieCode,
    });
    return success();
  } catch (error) {
    return failure(error, "Unable to change die");
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
