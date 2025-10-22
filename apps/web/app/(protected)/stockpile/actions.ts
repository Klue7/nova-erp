"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  adjust,
  createStockpile,
  ensureStockpileExists,
  recordQuality,
  recordReceipt,
  takeSample,
  transferOut,
} from "@/lib/stockpile";

const stockpileUpsertSchema = z.object({
  code: z.string().min(1, "Code is required."),
  name: z.string().trim().optional(),
  location: z.string().trim().optional(),
  materialType: z.string().trim().optional(),
});

const stockpileTargetSchema = z.object({
  stockpileId: z.string().uuid("Select a stockpile."),
});

const positiveQuantitySchema = z.object({
  stockpileId: z.string().uuid("Select a stockpile."),
  quantityTonnes: z.number().positive("Quantity must be greater than zero."),
  reference: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

const transferSchema = positiveQuantitySchema.extend({
  toStockpileId: z
    .union([z.string().uuid(), z.literal(""), z.null(), z.undefined()])
    .transform((value) => (value ? value : undefined)),
});

const adjustSchema = z.object({
  stockpileId: z.string().uuid("Select a stockpile."),
  quantityTonnes: z.number().positive("Quantity must be greater than zero."),
  direction: z.enum(["increase", "decrease"]),
  reason: z.string().min(2, "Provide a reason for the adjustment."),
});

const qualitySchema = z.object({
  stockpileId: z.string().uuid("Select a stockpile."),
  moisturePct: z
    .number({ invalid_type_error: "Enter a moisture percentage." })
    .min(0, "Moisture must be 0% or higher.")
    .max(100, "Moisture cannot exceed 100%."),
});

export async function ensureStockpileAction(raw: unknown) {
  const input = stockpileUpsertSchema.parse(raw);
  const result = await ensureStockpileExists(input);
  revalidatePath("/stockpile");
  return { ok: true, stockpileId: result.id };
}

export async function createStockpileAction(raw: unknown) {
  const input = stockpileUpsertSchema.parse(raw);
  const result = await createStockpile(input);
  revalidatePath("/stockpile");
  return { ok: true, stockpileId: result.id };
}

export async function recordReceiptAction(raw: unknown) {
  const input = positiveQuantitySchema.parse(raw);
  await recordReceipt(input);
  revalidatePath("/stockpile");
  return { ok: true };
}

export async function transferOutAction(raw: unknown) {
  const input = transferSchema.parse(raw);
  await transferOut({
    stockpileId: input.stockpileId,
    quantityTonnes: input.quantityTonnes,
    toStockpileId: input.toStockpileId ?? null,
    reference: input.reference,
    notes: input.notes,
  });
  revalidatePath("/stockpile");
  return { ok: true };
}

export async function adjustAction(raw: unknown) {
  const input = adjustSchema.parse(raw);
  const signedQuantity =
    input.direction === "increase"
      ? input.quantityTonnes
      : -input.quantityTonnes;

  await adjust({
    stockpileId: input.stockpileId,
    quantityTonnes: signedQuantity,
    reference: undefined,
    notes: undefined,
    reason: input.reason,
  });
  revalidatePath("/stockpile");
  return { ok: true };
}

export async function takeSampleAction(raw: unknown) {
  const input = stockpileTargetSchema.parse(raw);
  await takeSample(input);
  revalidatePath("/stockpile");
  return { ok: true };
}

export async function recordQualityAction(raw: unknown) {
  const input = qualitySchema.parse(raw);
  await recordQuality(input);
  revalidatePath("/stockpile");
  return { ok: true };
}
