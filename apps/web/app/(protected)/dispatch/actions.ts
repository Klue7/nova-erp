"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  addPick,
  cancelShipment,
  createPicklist,
  createShipment,
  finalizeDispatch,
  removePick,
  setAddress,
  setCarrier,
  weighbridgeIn,
  weighbridgeOut,
} from "@/lib/dispatch";

type ActionResult = { ok: true } | { ok: false; error: string };

function success(): ActionResult {
  revalidatePath("/dispatch");
  return { ok: true };
}

function failure(error: unknown): ActionResult {
  return {
    ok: false,
    error: error instanceof Error ? error.message : "Unknown error",
  };
}

const idSchema = z.string().uuid("Invalid identifier");

const positiveNumberSchema = z
  .union([z.number(), z.string()])
  .transform((value) => {
    const num = typeof value === "string" ? Number(value) : value;
    return Number.isFinite(num) ? num : Number.NaN;
  })
  .refine((value) => Number.isFinite(value) && value > 0, {
    message: "Value must be greater than zero",
  });

function compactAddress(address: Record<string, string | null | undefined>) {
  return Object.fromEntries(
    Object.entries(address)
      .map(([key, value]) => [key, value?.trim()])
      .filter(([, value]) => value),
  );
}

export async function createShipmentAction(raw: unknown) {
  try {
    const schema = z.object({
      code: z.string().min(1, "Code is required"),
      customerCode: z.string().trim().optional(),
      customerName: z.string().trim().optional(),
      addressLine1: z.string().trim().optional(),
      addressLine2: z.string().trim().optional(),
      city: z.string().trim().optional(),
      state: z.string().trim().optional(),
      postalCode: z.string().trim().optional(),
      country: z.string().trim().optional(),
    });
    const input = schema.parse(raw);
    const deliveryAddress = compactAddress({
      line1: input.addressLine1,
      line2: input.addressLine2,
      city: input.city,
      state: input.state,
      postalCode: input.postalCode,
      country: input.country,
    });
    await createShipment({
      code: input.code,
      customerCode: input.customerCode ?? null,
      customerName: input.customerName ?? null,
      deliveryAddress: Object.keys(deliveryAddress).length > 0 ? deliveryAddress : null,
    });
    return success();
  } catch (error) {
    return failure(error);
  }
}

export async function setCarrierAction(raw: unknown) {
  try {
    const schema = z.object({
      shipmentId: idSchema,
      carrier: z.string().min(1, "Carrier is required"),
      vehicleReg: z.string().trim().optional(),
      trailerReg: z.string().trim().optional(),
      sealNo: z.string().trim().optional(),
    });
    const input = schema.parse(raw);
    await setCarrier({
      shipmentId: input.shipmentId,
      carrier: input.carrier,
      vehicleReg: input.vehicleReg ?? null,
      trailerReg: input.trailerReg ?? null,
      sealNo: input.sealNo ?? null,
    });
    return success();
  } catch (error) {
    return failure(error);
  }
}

export async function setAddressAction(raw: unknown) {
  try {
    const schema = z.object({
      shipmentId: idSchema,
      addressLine1: z.string().trim().optional(),
      addressLine2: z.string().trim().optional(),
      city: z.string().trim().optional(),
      state: z.string().trim().optional(),
      postalCode: z.string().trim().optional(),
      country: z.string().trim().optional(),
    });
    const input = schema.parse(raw);
    const deliveryAddress = compactAddress({
      line1: input.addressLine1,
      line2: input.addressLine2,
      city: input.city,
      state: input.state,
      postalCode: input.postalCode,
      country: input.country,
    });
    await setAddress({
      shipmentId: input.shipmentId,
      deliveryAddress: Object.keys(deliveryAddress).length > 0 ? deliveryAddress : null,
    });
    return success();
  } catch (error) {
    return failure(error);
  }
}

export async function createPicklistAction(raw: unknown) {
  try {
    const input = z.object({ shipmentId: idSchema }).parse(raw);
    await createPicklist({ shipmentId: input.shipmentId });
    return success();
  } catch (error) {
    return failure(error);
  }
}

export async function addPickAction(raw: unknown) {
  try {
    const schema = z.object({
      shipmentId: idSchema,
      palletId: idSchema,
      quantityUnits: positiveNumberSchema,
      productSku: z.string().trim().optional(),
      grade: z.string().trim().optional(),
      orderId: z.string().trim().optional(),
    });
    const input = schema.parse(raw);
    await addPick({
      shipmentId: input.shipmentId,
      palletId: input.palletId,
      quantityUnits: input.quantityUnits,
      productSku: input.productSku ?? null,
      grade: input.grade ?? null,
      orderId: input.orderId ?? null,
    });
    return success();
  } catch (error) {
    return failure(error);
  }
}

export async function removePickAction(raw: unknown) {
  try {
    const schema = z.object({
      shipmentId: idSchema,
      palletId: idSchema,
      quantityUnits: positiveNumberSchema,
      orderId: z.string().trim().optional(),
    });
    const input = schema.parse(raw);
    await removePick({
      shipmentId: input.shipmentId,
      palletId: input.palletId,
      quantityUnits: input.quantityUnits,
      orderId: input.orderId ?? null,
    });
    return success();
  } catch (error) {
    return failure(error);
  }
}

const weighbridgeSchema = z.object({
  shipmentId: idSchema,
  grossKg: positiveNumberSchema,
  tareKg: z
    .union([z.number(), z.string(), z.null(), z.undefined()])
    .transform((value) => {
      if (value === undefined || value === null || value === "") return undefined;
      const num = typeof value === "string" ? Number(value) : value;
      return Number.isFinite(num) ? num : Number.NaN;
    })
    .refine((value) => value === undefined || Number.isFinite(value), {
      message: "Tare must be a number",
    })
    .optional(),
});

export async function weighbridgeInAction(raw: unknown) {
  try {
    const input = weighbridgeSchema.parse(raw);
    await weighbridgeIn({
      shipmentId: input.shipmentId,
      grossKg: input.grossKg,
      tareKg: input.tareKg ?? null,
    });
    return success();
  } catch (error) {
    return failure(error);
  }
}

export async function weighbridgeOutAction(raw: unknown) {
  try {
    const input = weighbridgeSchema.parse(raw);
    await weighbridgeOut({
      shipmentId: input.shipmentId,
      grossKg: input.grossKg,
      tareKg: input.tareKg ?? null,
    });
    return success();
  } catch (error) {
    return failure(error);
  }
}

export async function finalizeDispatchAction(raw: unknown) {
  try {
    const input = z.object({ shipmentId: idSchema }).parse(raw);
    await finalizeDispatch({ shipmentId: input.shipmentId });
    return success();
  } catch (error) {
    return failure(error);
  }
}

export async function cancelShipmentAction(raw: unknown) {
  try {
    const schema = z.object({
      shipmentId: idSchema,
      reason: z.string().trim().optional(),
    });
    const input = schema.parse(raw);
    await cancelShipment({
      shipmentId: input.shipmentId,
      reason: input.reason ?? null,
    });
    return success();
  } catch (error) {
    return failure(error);
  }
}
