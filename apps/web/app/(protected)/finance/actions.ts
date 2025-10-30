"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  addInvoiceLine,
  applyPayment,
  createInvoice,
  getAgingSummary,
  invoiceFromShipment,
  issueInvoice,
  receivePayment,
  removeInvoiceLine,
  reversePayment,
  unapplyPayment,
  voidInvoice,
} from "@/lib/finance";

type ActionResult<T = undefined> =
  | { ok: true; data: T | undefined }
  | { ok: false; error: string };

function success<T = undefined>(options?: { data?: T; revalidate?: boolean }): ActionResult<T> {
  if (options?.revalidate !== false) {
    revalidatePath("/finance");
  }
  return { ok: true as const, data: options?.data };
}

function failure(error: unknown): ActionResult<undefined> {
  return {
    ok: false,
    error: error instanceof Error ? error.message : "Unexpected error occurred.",
  };
}

const uuidSchema = z.string().uuid("Invalid identifier");

const positiveNumberSchema = z
  .union([z.number(), z.string()])
  .transform((value) => {
    const num = typeof value === "string" ? Number(value) : value;
    return Number.isFinite(num) ? num : Number.NaN;
  })
  .refine((value) => Number.isFinite(value) && value > 0, {
    message: "Value must be greater than zero",
  });

const nonNegativeNumberSchema = z
  .union([z.number(), z.string()])
  .transform((value) => {
    const num = typeof value === "string" ? Number(value) : value;
    return Number.isFinite(num) ? num : Number.NaN;
  })
  .refine((value) => Number.isFinite(value) && value >= 0, {
    message: "Value cannot be negative",
  });

export async function createInvoiceAction(raw: unknown) {
  try {
    const schema = z.object({
      code: z.string().min(1, "Invoice code is required"),
      customerId: uuidSchema,
      currency: z.string().trim().optional(),
    });
    const input = schema.parse(raw);
    const data = await createInvoice({
      code: input.code,
      customerId: input.customerId,
      currency: input.currency ?? "ZAR",
    });
    return success({ data });
  } catch (error) {
    return failure(error);
  }
}

export async function addInvoiceLineAction(raw: unknown) {
  try {
    const schema = z.object({
      invoiceId: uuidSchema,
      productId: uuidSchema,
      sku: z.string().min(1, "SKU is required"),
      quantityUnits: positiveNumberSchema,
      unitPrice: nonNegativeNumberSchema,
      taxRate: z
        .union([z.number(), z.string(), z.null(), z.undefined()])
        .transform((value) => {
          if (value === null || value === undefined || value === "") return 0;
          const num = typeof value === "string" ? Number(value) : value;
          return Number.isFinite(num) ? num : Number.NaN;
        })
        .refine((value) => Number.isFinite(value) && value >= 0, {
          message: "Tax rate cannot be negative",
        }),
    });
    const input = schema.parse(raw);
    await addInvoiceLine({
      invoiceId: input.invoiceId,
      productId: input.productId,
      sku: input.sku,
      quantityUnits: input.quantityUnits,
      unitPrice: input.unitPrice,
      taxRate: input.taxRate,
    });
    return success();
  } catch (error) {
    return failure(error);
  }
}

export async function removeInvoiceLineAction(raw: unknown) {
  try {
    const schema = z.object({
      invoiceId: uuidSchema,
      productId: uuidSchema,
      sku: z.string().min(1, "SKU is required"),
      quantityUnits: positiveNumberSchema,
      unitPrice: nonNegativeNumberSchema,
      taxRate: nonNegativeNumberSchema,
    });
    const input = schema.parse(raw);
    await removeInvoiceLine({
      invoiceId: input.invoiceId,
      productId: input.productId,
      sku: input.sku,
      quantityUnits: input.quantityUnits,
      unitPrice: input.unitPrice,
      taxRate: input.taxRate,
    });
    return success();
  } catch (error) {
    return failure(error);
  }
}

export async function issueInvoiceAction(raw: unknown) {
  try {
    const schema = z.object({
      invoiceId: uuidSchema,
      termsDays: z
        .union([z.number(), z.string(), z.null(), z.undefined()])
        .transform((value) => {
          if (value === null || value === undefined || value === "") return 30;
          const num = typeof value === "string" ? Number(value) : value;
          return Number.isFinite(num) ? num : Number.NaN;
        })
        .refine((value) => Number.isFinite(value) && value > 0, {
          message: "Terms must be positive",
        }),
      issueDate: z.string().trim().optional(),
    });
    const input = schema.parse(raw);
    await issueInvoice({
      invoiceId: input.invoiceId,
      termsDays: input.termsDays,
      issueDate: input.issueDate && input.issueDate !== "" ? input.issueDate : undefined,
    });
    return success();
  } catch (error) {
    return failure(error);
  }
}

export async function voidInvoiceAction(raw: unknown) {
  try {
    const schema = z.object({
      invoiceId: uuidSchema,
      reason: z.string().trim().optional(),
    });
    const input = schema.parse(raw);
    await voidInvoice({
      invoiceId: input.invoiceId,
      reason: input.reason ?? null,
    });
    return success();
  } catch (error) {
    return failure(error);
  }
}

export async function receivePaymentAction(raw: unknown) {
  try {
    const schema = z.object({
      code: z.string().min(1, "Payment code is required"),
      customerId: uuidSchema,
      amount: positiveNumberSchema,
      currency: z.string().trim().optional(),
      method: z.string().trim().optional(),
      reference: z.string().trim().optional(),
      receivedAt: z.string().trim().optional(),
    });
    const input = schema.parse(raw);
    const data = await receivePayment({
      code: input.code,
      customerId: input.customerId,
      amount: input.amount,
      currency: input.currency ?? "ZAR",
      method: input.method ?? null,
      reference: input.reference ?? null,
      receivedAt: input.receivedAt ?? undefined,
    });
    return success({ data });
  } catch (error) {
    return failure(error);
  }
}

export async function applyPaymentAction(raw: unknown) {
  try {
    const schema = z.object({
      paymentId: uuidSchema,
      invoiceId: uuidSchema,
      amount: positiveNumberSchema,
    });
    const input = schema.parse(raw);
    const data = await applyPayment({
      paymentId: input.paymentId,
      invoiceId: input.invoiceId,
      amount: input.amount,
    });
    return success({ data });
  } catch (error) {
    return failure(error);
  }
}

export async function unapplyPaymentAction(raw: unknown) {
  try {
    const schema = z.object({
      applicationId: uuidSchema,
    });
    const input = schema.parse(raw);
    await unapplyPayment({ applicationId: input.applicationId });
    return success();
  } catch (error) {
    return failure(error);
  }
}

export async function reversePaymentAction(raw: unknown) {
  try {
    const schema = z.object({
      paymentId: uuidSchema,
      reason: z.string().trim().optional(),
    });
    const input = schema.parse(raw);
    await reversePayment({
      paymentId: input.paymentId,
      reason: input.reason ?? null,
    });
    return success();
  } catch (error) {
    return failure(error);
  }
}

export async function invoiceFromShipmentAction(raw: unknown) {
  try {
    const schema = z.object({
      shipmentId: uuidSchema,
      invoiceCode: z.string().min(1, "Invoice code is required"),
      customerId: uuidSchema,
      currency: z.string().trim().optional(),
    });
    const input = schema.parse(raw);
    const data = await invoiceFromShipment({
      shipmentId: input.shipmentId,
      invoiceCode: input.invoiceCode,
      customerId: input.customerId,
      currency: input.currency ?? "ZAR",
    });
    return success({ data });
  } catch (error) {
    return failure(error);
  }
}

export async function getAgingSummaryAction() {
  try {
    const summary = await getAgingSummary();
    return success({ data: summary, revalidate: false });
  } catch (error) {
    return failure(error);
  }
}
