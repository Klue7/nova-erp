"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  addInput,
  cancelLoad,
  completeLoad,
  createLoad,
  createRack,
  moveLoad,
  recordMoisture,
  recordScrap,
  startLoad,
} from "@/lib/dry";

const idSchema = z.string().uuid("Invalid identifier");

function toNumber(value: unknown) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error("Invalid numeric value.");
  }
  return num;
}

function success() {
  revalidatePath("/dry-yard");
  return { ok: true as const };
}

function failure(error: unknown, fallback: string) {
  return {
    ok: false as const,
    error: error instanceof Error ? error.message : fallback,
  };
}

export async function createRackAction(raw: unknown) {
  try {
    const schema = z.object({
      code: z.string().min(1, "Rack code is required"),
      bay: z.string().trim().optional(),
      capacityUnits: z
        .union([z.number(), z.string()])
        .transform((value) => toNumber(value))
        .refine((value) => value > 0, "Capacity must be greater than zero"),
      status: z.string().trim().optional(),
    });
    const input = schema.parse(raw);
    await createRack({
      code: input.code,
      bay: input.bay ?? null,
      capacityUnits: input.capacityUnits,
      status: input.status ?? "active",
    });
    return success();
  } catch (error) {
    return failure(error, "Unable to create rack");
  }
}

export async function createLoadAction(raw: unknown) {
  try {
    const schema = z.object({
      code: z.string().min(1, "Load code is required"),
      rackId: idSchema,
      targetMoisturePct: z
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
    await createLoad({
      code: input.code,
      rackId: input.rackId,
      targetMoisturePct: input.targetMoisturePct ?? null,
    });
    return success();
  } catch (error) {
    return failure(error, "Unable to create load");
  }
}

export async function addInputAction(raw: unknown) {
  try {
    const schema = z.object({
      loadId: idSchema,
      extrusionRunId: idSchema,
      quantityUnits: z
        .union([z.number(), z.string()])
        .transform((value) => toNumber(value))
        .refine((value) => value > 0, "Quantity must be greater than zero"),
      reference: z.string().trim().optional(),
    });
    const input = schema.parse(raw);
    await addInput({
      loadId: input.loadId,
      extrusionRunId: input.extrusionRunId,
      quantityUnits: input.quantityUnits,
      reference: input.reference ?? null,
    });
    return success();
  } catch (error) {
    return failure(error, "Unable to add input");
  }
}

export async function startLoadAction(raw: unknown) {
  try {
    const { loadId } = z.object({ loadId: idSchema }).parse(raw);
    await startLoad({ loadId });
    return success();
  } catch (error) {
    return failure(error, "Unable to start load");
  }
}

export async function recordMoistureAction(raw: unknown) {
  try {
    const schema = z.object({
      loadId: idSchema,
      moisturePct: z
        .union([z.number(), z.string()])
        .transform((value) => toNumber(value))
        .refine(
          (value) => value >= 0 && value <= 100,
          "Moisture must be between 0 and 100",
        ),
      method: z.string().trim().optional(),
    });
    const input = schema.parse(raw);
    await recordMoisture({
      loadId: input.loadId,
      moisturePct: input.moisturePct,
      method: input.method ?? null,
    });
    return success();
  } catch (error) {
    return failure(error, "Unable to record moisture");
  }
}

export async function moveLoadAction(raw: unknown) {
  try {
    const { loadId, toRackId } = z
      .object({
        loadId: idSchema,
        toRackId: idSchema,
      })
      .parse(raw);
    await moveLoad({ loadId, toRackId });
    return success();
  } catch (error) {
    return failure(error, "Unable to move load");
  }
}

export async function recordScrapAction(raw: unknown) {
  try {
    const schema = z.object({
      loadId: idSchema,
      scrapUnits: z
        .union([z.number(), z.string()])
        .transform((value) => toNumber(value))
        .refine((value) => value > 0, "Scrap must be greater than zero"),
      reason: z.string().trim().optional(),
    });
    const input = schema.parse(raw);
    await recordScrap({
      loadId: input.loadId,
      scrapUnits: input.scrapUnits,
      reason: input.reason ?? null,
    });
    return success();
  } catch (error) {
    return failure(error, "Unable to record scrap");
  }
}

export async function completeLoadAction(raw: unknown) {
  try {
    const { loadId } = z.object({ loadId: idSchema }).parse(raw);
    await completeLoad({ loadId });
    return success();
  } catch (error) {
    return failure(error, "Unable to complete load");
  }
}

export async function cancelLoadAction(raw: unknown) {
  try {
    const schema = z.object({
      loadId: idSchema,
      reason: z.string().trim().optional(),
    });
    const input = schema.parse(raw);
    await cancelLoad({
      loadId: input.loadId,
      reason: input.reason ?? null,
    });
    return success();
  } catch (error) {
    return failure(error, "Unable to cancel load");
  }
}
