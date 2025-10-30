"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  addLine,
  cancelOrder,
  confirmOrder,
  createCustomer,
  createOrder,
  createProduct,
  removeLine,
  releaseReservation,
  reserveFromPallet,
  setPrice,
  computeFulfillment,
} from "@/lib/sales";

type ActionResult<T = undefined> =
  | { ok: true; data: T | undefined }
  | { ok: false; error: string };

function success<T>(options?: { data?: T; revalidate?: boolean }): ActionResult<T> {
  if (options?.revalidate !== false) {
    revalidatePath("/sales");
  }
  return { ok: true as const, data: options?.data };
}

function failure(error: unknown): ActionResult<undefined> {
  return {
    ok: false,
    error: error instanceof Error ? error.message : "Unexpected error. Please try again.",
  };
}

const uuidSchema = z.string().uuid("Invalid identifier");

const positiveNumberSchema = z
  .union([z.number(), z.string()])
  .transform((value) => {
    const numberValue = typeof value === "string" ? Number(value) : value;
    return Number.isFinite(numberValue) ? numberValue : Number.NaN;
  })
  .refine((value) => Number.isFinite(value) && value > 0, {
    message: "Value must be greater than zero",
  });

const nonNegativeNumberSchema = z
  .union([z.number(), z.string(), z.null(), z.undefined()])
  .transform((value) => {
    if (value === null || value === undefined || value === "") {
      return null;
    }
    const numberValue = typeof value === "string" ? Number(value) : value;
    return Number.isFinite(numberValue) ? numberValue : Number.NaN;
  })
  .refine((value) => value === null || (Number.isFinite(value) && value >= 0), {
    message: "Value must be zero or greater",
  });

export async function createCustomerAction(raw: unknown) {
  try {
    const schema = z.object({
      code: z.string().min(1, "Customer code is required"),
      name: z.string().min(1, "Customer name is required"),
      creditLimit: nonNegativeNumberSchema.optional(),
      status: z.string().trim().optional(),
    });
    const input = schema.parse(raw);
    await createCustomer({
      code: input.code,
      name: input.name,
      creditLimit: input.creditLimit ?? null,
      status: input.status ?? "active",
    });
    return success();
  } catch (error) {
    return failure(error);
  }
}

export async function createProductAction(raw: unknown) {
  try {
    const schema = z.object({
      sku: z.string().min(1, "SKU is required"),
      name: z.string().trim().optional(),
      uom: z.string().trim().optional(),
      status: z.string().trim().optional(),
    });
    const input = schema.parse(raw);
    await createProduct({
      sku: input.sku,
      name: input.name ?? null,
      uom: input.uom ?? null,
      status: input.status ?? "active",
    });
    return success();
  } catch (error) {
    return failure(error);
  }
}

export async function setPriceAction(raw: unknown) {
  try {
    const schema = z.object({
      productId: uuidSchema,
      unitPrice: positiveNumberSchema,
      currency: z.string().trim().optional(),
      effectiveFrom: z
        .union([z.string().trim(), z.date(), z.null(), z.undefined()])
        .optional(),
    });
    const input = schema.parse(raw);
    await setPrice({
      productId: input.productId,
      unitPrice: input.unitPrice,
      currency: input.currency ?? "ZAR",
      effectiveFrom: input.effectiveFrom ?? undefined,
    });
    return success();
  } catch (error) {
    return failure(error);
  }
}

export async function createOrderAction(raw: unknown) {
  try {
    const schema = z.object({
      code: z.string().min(1, "Order code is required"),
      customerId: uuidSchema,
    });
    const input = schema.parse(raw);
    await createOrder({
      code: input.code,
      customerId: input.customerId,
    });
    return success();
  } catch (error) {
    return failure(error);
  }
}

export async function addLineAction(raw: unknown) {
  try {
    const schema = z.object({
      orderId: uuidSchema,
      productId: uuidSchema,
      sku: z.string().min(1, "SKU is required"),
      quantityUnits: positiveNumberSchema,
    });
    const input = schema.parse(raw);
    const totals = await addLine({
      orderId: input.orderId,
      productId: input.productId,
      sku: input.sku,
      quantityUnits: input.quantityUnits,
    });
    return success({ data: totals });
  } catch (error) {
    return failure(error);
  }
}

export async function removeLineAction(raw: unknown) {
  try {
    const schema = z.object({
      orderId: uuidSchema,
      productId: uuidSchema,
      sku: z.string().min(1, "SKU is required"),
      quantityUnits: positiveNumberSchema,
    });
    const input = schema.parse(raw);
    const totals = await removeLine({
      orderId: input.orderId,
      productId: input.productId,
      sku: input.sku,
      quantityUnits: input.quantityUnits,
    });
    return success({ data: totals });
  } catch (error) {
    return failure(error);
  }
}

export async function confirmOrderAction(raw: unknown) {
  try {
    const input = z.object({ orderId: uuidSchema }).parse(raw);
    await confirmOrder({ orderId: input.orderId });
    return success();
  } catch (error) {
    return failure(error);
  }
}

export async function reserveFromPalletAction(raw: unknown) {
  try {
    const schema = z.object({
      orderId: uuidSchema,
      palletId: uuidSchema,
      quantityUnits: positiveNumberSchema,
      productSku: z.string().trim().optional(),
      grade: z.string().trim().optional(),
    });
    const input = schema.parse(raw);
    await reserveFromPallet({
      orderId: input.orderId,
      palletId: input.palletId,
      quantityUnits: input.quantityUnits,
      productSku: input.productSku ?? null,
      grade: input.grade ?? null,
    });
    return success();
  } catch (error) {
    return failure(error);
  }
}

export async function releaseReservationAction(raw: unknown) {
  try {
    const schema = z.object({
      orderId: uuidSchema,
      palletId: uuidSchema,
      quantityUnits: positiveNumberSchema,
    });
    const input = schema.parse(raw);
    await releaseReservation({
      orderId: input.orderId,
      palletId: input.palletId,
      quantityUnits: input.quantityUnits,
    });
    return success();
  } catch (error) {
    return failure(error);
  }
}

export async function cancelOrderAction(raw: unknown) {
  try {
    const schema = z.object({
      orderId: uuidSchema,
      reason: z.string().trim().optional(),
    });
    const input = schema.parse(raw);
    await cancelOrder({
      orderId: input.orderId,
      reason: input.reason ?? null,
    });
    return success();
  } catch (error) {
    return failure(error);
  }
}

export async function computeFulfillmentAction(raw: unknown) {
  try {
    const input = z.object({ orderId: uuidSchema }).parse(raw);
    const result = await computeFulfillment({ orderId: input.orderId });
    return success({ data: result, revalidate: false });
  } catch (error) {
    return failure(error);
  }
}
