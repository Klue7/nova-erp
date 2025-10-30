import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { logEvent } from "@/lib/events";
import { getUserProfile } from "@/lib/rbac";
import { createServerSupabaseClient } from "@/utils/supabase/server";

const VIEW_MISSING_CODE = "42P01";

function ensurePositive(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be greater than zero.`);
  }
}

async function assertProfile() {
  const { profile } = await getUserProfile();
  if (!profile) {
    throw new Error("Profile required for sales operations.");
  }
  return profile;
}

async function fetchCustomer(customerId: string, tenantId: string) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("customers")
    .select("id, code, name, tenant_id")
    .eq("tenant_id", tenantId)
    .eq("id", customerId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    throw new Error("Customer not found.");
  }
  return data;
}

async function fetchProduct(productId: string, tenantId: string) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("products")
    .select("id, sku, tenant_id, status")
    .eq("tenant_id", tenantId)
    .eq("id", productId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    throw new Error("Product not found.");
  }
  if (data.status === "inactive") {
    throw new Error("Product is inactive.");
  }
  return data;
}

async function fetchOrder(orderId: string, tenantId: string) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("sales_orders")
    .select("id, code, status, tenant_id, customer_id")
    .eq("tenant_id", tenantId)
    .eq("id", orderId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    throw new Error("Sales order not found.");
  }
  return data;
}

function ensureOrderMutable(status: string) {
  if (status === "cancelled") {
    throw new Error("Order is cancelled.");
  }
  if (status === "fulfilled") {
    throw new Error("Order already fulfilled.");
  }
}

async function getActivePrice(
  supabase: SupabaseClient,
  tenantId: string,
  productId: string,
): Promise<{ unitPrice: number; currency: string } | null> {
  const { data, error } = await supabase
    .from("current_product_price_v")
    .select("unit_price, currency")
    .eq("tenant_id", tenantId)
    .eq("product_id", productId)
    .maybeSingle();

  if (error && error.code !== VIEW_MISSING_CODE) {
    throw new Error(error.message);
  }

  if (data) {
    const unitPrice = Number(data.unit_price ?? 0);
    const currency = data.currency ?? "ZAR";
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
      throw new Error("Configured price is invalid.");
    }
    return { unitPrice, currency };
  }

  const { data: fallback, error: fallbackError } = await supabase
    .from("product_prices")
    .select("unit_price, currency")
    .eq("tenant_id", tenantId)
    .eq("product_id", productId)
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (fallbackError && fallbackError.code !== VIEW_MISSING_CODE) {
    throw new Error(fallbackError.message);
  }

  if (!fallback) {
    return null;
  }

  const fallbackPrice = Number(fallback.unit_price ?? 0);
  const fallbackCurrency = fallback.currency ?? "ZAR";
  if (!Number.isFinite(fallbackPrice) || fallbackPrice <= 0) {
    throw new Error("Latest price record is invalid.");
  }
  return { unitPrice: fallbackPrice, currency: fallbackCurrency };
}

export async function createCustomer({
  code,
  name,
  creditLimit,
  status = "active",
}: {
  code: string;
  name: string;
  creditLimit?: number | null;
  status?: string;
}) {
  const trimmedCode = code.trim();
  const trimmedName = name.trim();
  const normalizedStatus = status?.trim() || "active";

  if (!trimmedCode) {
    throw new Error("Customer code is required.");
  }
  if (!trimmedName) {
    throw new Error("Customer name is required.");
  }

  const profile = await assertProfile();
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("customers")
    .insert({
      tenant_id: profile.tenant_id,
      code: trimmedCode,
      name: trimmedName,
      credit_limit: creditLimit ?? null,
      status: normalizedStatus,
    })
    .select("id, code, name, credit_limit, status")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    throw new Error("Failed to create customer.");
  }

  return data;
}

export async function createProduct({
  sku,
  name,
  uom,
  status = "active",
}: {
  sku: string;
  name?: string | null;
  uom?: string | null;
  status?: string;
}) {
  const trimmedSku = sku.trim();
  if (!trimmedSku) {
    throw new Error("Product SKU is required.");
  }

  const profile = await assertProfile();
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("products")
    .insert({
      tenant_id: profile.tenant_id,
      sku: trimmedSku,
      name: name?.trim() || null,
      uom: uom?.trim() || "units",
      status: status?.trim() || "active",
    })
    .select("id, sku, name, uom, status")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    throw new Error("Failed to create product.");
  }

  return data;
}

export async function setPrice({
  productId,
  unitPrice,
  currency = "ZAR",
  effectiveFrom,
}: {
  productId: string;
  unitPrice: number;
  currency?: string;
  effectiveFrom?: Date | string | null;
}) {
  ensurePositive(unitPrice, "Unit price");

  const profile = await assertProfile();
  await fetchProduct(productId, profile.tenant_id);

  const supabase = await createServerSupabaseClient();
  const timestamp =
    effectiveFrom instanceof Date
      ? effectiveFrom.toISOString()
      : effectiveFrom
        ? new Date(effectiveFrom).toISOString()
        : new Date().toISOString();

  const { error } = await supabase.from("product_prices").insert({
    tenant_id: profile.tenant_id,
    product_id: productId,
    unit_price: unitPrice,
    currency: currency?.trim() || "ZAR",
    effective_from: timestamp,
  });

  if (error) {
    throw new Error(error.message);
  }
}

export async function createOrder({
  code,
  customerId,
}: {
  code: string;
  customerId: string;
}) {
  const trimmedCode = code.trim();
  if (!trimmedCode) {
    throw new Error("Order code is required.");
  }

  const profile = await assertProfile();
  const customer = await fetchCustomer(customerId, profile.tenant_id);

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("sales_orders")
    .insert({
      tenant_id: profile.tenant_id,
      code: trimmedCode,
      customer_id: customer.id,
      status: "draft",
    })
    .select("id, code, status")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    throw new Error("Failed to create order.");
  }

  await logEvent(supabase, {
    aggregateType: "sales_order",
    aggregateId: data.id,
    eventType: "SALES_ORDER_CREATED",
    payload: {
      orderId: data.id,
      orderCode: data.code,
      customerId: customer.id,
      customerCode: customer.code,
    },
  });

  return data;
}

export async function addLine({
  orderId,
  productId,
  sku,
  quantityUnits,
}: {
  orderId: string;
  productId: string;
  sku: string;
  quantityUnits: number;
}) {
  ensurePositive(quantityUnits, "Quantity");
  if (!sku.trim()) {
    throw new Error("SKU is required.");
  }

  const profile = await assertProfile();
  const order = await fetchOrder(orderId, profile.tenant_id);
  ensureOrderMutable(order.status);
  await fetchProduct(productId, profile.tenant_id);

  const supabase = await createServerSupabaseClient();
  const price = await getActivePrice(supabase, profile.tenant_id, productId);
  if (!price) {
    throw new Error("No active price configured for this product.");
  }

  await logEvent(supabase, {
    aggregateType: "sales_order",
    aggregateId: order.id,
    eventType: "SALES_ORDER_LINE_ADDED",
    payload: {
      orderId: order.id,
      productId,
      sku: sku.trim(),
      quantityUnits,
      unitPrice: price.unitPrice,
      currency: price.currency,
    },
  });

  const { data: totalsRow, error } = await supabase
    .from("sales_order_totals_v")
    .select("total_units, total_value_est")
    .eq("tenant_id", profile.tenant_id)
    .eq("order_id", order.id)
    .maybeSingle();

  if (error && error.code !== VIEW_MISSING_CODE) {
    throw new Error(error.message);
  }

  return {
    totalUnits: Number(totalsRow?.total_units ?? 0),
    totalValue: Number(totalsRow?.total_value_est ?? 0),
  };
}

export async function removeLine({
  orderId,
  productId,
  sku,
  quantityUnits,
}: {
  orderId: string;
  productId: string;
  sku: string;
  quantityUnits: number;
}) {
  ensurePositive(quantityUnits, "Quantity");
  if (!sku.trim()) {
    throw new Error("SKU is required.");
  }

  const profile = await assertProfile();
  const order = await fetchOrder(orderId, profile.tenant_id);
  ensureOrderMutable(order.status);
  await fetchProduct(productId, profile.tenant_id);

  const supabase = await createServerSupabaseClient();
  const price = await getActivePrice(supabase, profile.tenant_id, productId);
  const unitPrice = price?.unitPrice ?? 0;
  const currency = price?.currency ?? "ZAR";

  await logEvent(supabase, {
    aggregateType: "sales_order",
    aggregateId: order.id,
    eventType: "SALES_ORDER_LINE_REMOVED",
    payload: {
      orderId: order.id,
      productId,
      sku: sku.trim(),
      quantityUnits,
      unitPrice,
      currency,
    },
  });

  const { data: totalsRow, error } = await supabase
    .from("sales_order_totals_v")
    .select("total_units, total_value_est")
    .eq("tenant_id", profile.tenant_id)
    .eq("order_id", order.id)
    .maybeSingle();

  if (error && error.code !== VIEW_MISSING_CODE) {
    throw new Error(error.message);
  }

  return {
    totalUnits: Number(totalsRow?.total_units ?? 0),
    totalValue: Number(totalsRow?.total_value_est ?? 0),
  };
}

export async function confirmOrder({ orderId }: { orderId: string }) {
  const profile = await assertProfile();
  const order = await fetchOrder(orderId, profile.tenant_id);
  if (order.status === "cancelled") {
    throw new Error("Cannot confirm a cancelled order.");
  }
  if (order.status === "confirmed") {
    return;
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from("sales_orders")
    .update({ status: "confirmed", confirmed_at: new Date().toISOString() })
    .eq("tenant_id", profile.tenant_id)
    .eq("id", order.id);

  if (error) {
    throw new Error(error.message);
  }

  await logEvent(supabase, {
    aggregateType: "sales_order",
    aggregateId: order.id,
    eventType: "SALES_ORDER_CONFIRMED",
    payload: {
      orderId: order.id,
      confirmedAt: new Date().toISOString(),
    },
  });
}

export async function reserveFromPallet({
  orderId,
  palletId,
  quantityUnits,
  productSku,
  grade,
  correlationId,
}: {
  orderId: string;
  palletId: string;
  quantityUnits: number;
  productSku?: string | null;
  grade?: string | null;
  correlationId?: string | null;
}) {
  ensurePositive(quantityUnits, "Quantity");

  const profile = await assertProfile();
  const order = await fetchOrder(orderId, profile.tenant_id);
  ensureOrderMutable(order.status);

  const supabase = await createServerSupabaseClient();
  const { data: palletRow, error: palletError } = await supabase
    .from("pallets")
    .select("id, code, product_sku, grade, status")
    .eq("tenant_id", profile.tenant_id)
    .eq("id", palletId)
    .maybeSingle();

  if (palletError) {
    throw new Error(palletError.message);
  }
  if (!palletRow) {
    throw new Error("Pallet not found.");
  }
  if (palletRow.status !== "open") {
    throw new Error("Reservations allowed only on open pallets.");
  }

  const { data: availabilityRow, error: availabilityError } = await supabase
    .from("pallet_inventory_live_v")
    .select("units_available, units_on_pallet")
    .eq("tenant_id", profile.tenant_id)
    .eq("pallet_id", palletId)
    .maybeSingle();

  if (availabilityError && availabilityError.code !== VIEW_MISSING_CODE) {
    throw new Error(availabilityError.message);
  }

  const available = Number(availabilityRow?.units_available ?? availabilityRow?.units_on_pallet ?? 0);
  if (availabilityError?.code !== VIEW_MISSING_CODE && available < quantityUnits) {
    throw new Error(
      `Only ${available.toFixed(0)} units available on pallet ${palletRow.code}.`,
    );
  }

  const linkCorrelation = correlationId ?? randomUUID();
  const normalizedSku = productSku?.trim() || palletRow.product_sku || null;
  const normalizedGrade = grade?.trim() || palletRow.grade || null;

  await logEvent(supabase, {
    aggregateType: "pallet",
    aggregateId: palletRow.id,
    eventType: "PACK_PALLET_RESERVED",
    payload: {
      palletId: palletRow.id,
      orderId: order.id,
      quantityUnits,
      productSku: normalizedSku,
      grade: normalizedGrade,
    },
    correlationId: linkCorrelation,
  });

  await logEvent(supabase, {
    aggregateType: "sales_order",
    aggregateId: order.id,
    eventType: "SALES_ORDER_RESERVED",
    payload: {
      orderId: order.id,
      palletId: palletRow.id,
      quantityUnits,
      productSku: normalizedSku,
      grade: normalizedGrade,
    },
    correlationId: linkCorrelation,
  });
}

export async function releaseReservation({
  orderId,
  palletId,
  quantityUnits,
  correlationId,
}: {
  orderId: string;
  palletId: string;
  quantityUnits: number;
  correlationId?: string | null;
}) {
  ensurePositive(quantityUnits, "Quantity");

  const profile = await assertProfile();
  const order = await fetchOrder(orderId, profile.tenant_id);
  ensureOrderMutable(order.status);

  const supabase = await createServerSupabaseClient();
  const { data: palletRow, error: palletError } = await supabase
    .from("pallets")
    .select("id")
    .eq("tenant_id", profile.tenant_id)
    .eq("id", palletId)
    .maybeSingle();

  if (palletError) {
    throw new Error(palletError.message);
  }
  if (!palletRow) {
    throw new Error("Pallet not found.");
  }

  const linkCorrelation = correlationId ?? randomUUID();

  await logEvent(supabase, {
    aggregateType: "sales_order",
    aggregateId: order.id,
    eventType: "SALES_ORDER_RESERVATION_RELEASED",
    payload: {
      orderId: order.id,
      palletId: palletRow.id,
      quantityUnits,
    },
    correlationId: linkCorrelation,
  });

  await logEvent(supabase, {
    aggregateType: "pallet",
    aggregateId: palletRow.id,
    eventType: "PACK_PALLET_RESERVATION_RELEASED",
    payload: {
      palletId: palletRow.id,
      orderId: order.id,
      quantityUnits,
    },
    correlationId: linkCorrelation,
  });
}

export async function cancelOrder({
  orderId,
  reason,
}: {
  orderId: string;
  reason?: string | null;
}) {
  const profile = await assertProfile();
  const order = await fetchOrder(orderId, profile.tenant_id);
  if (order.status === "cancelled") {
    return;
  }

  const supabase = await createServerSupabaseClient();
  const { error: reservationsError, data: reservations } = await supabase
    .from("order_reservations_v")
    .select("pallet_id, reserved_units")
    .eq("tenant_id", profile.tenant_id)
    .eq("order_id", order.id);

  if (reservationsError && reservationsError.code !== VIEW_MISSING_CODE) {
    throw new Error(reservationsError.message);
  }

  for (const reservation of reservations ?? []) {
    const quantity = Number(reservation.reserved_units ?? 0);
    if (quantity <= 0 || !reservation.pallet_id) {
      continue;
    }
    const correlation = randomUUID();
    await logEvent(supabase, {
      aggregateType: "sales_order",
      aggregateId: order.id,
      eventType: "SALES_ORDER_RESERVATION_RELEASED",
      payload: {
        orderId: order.id,
        palletId: reservation.pallet_id,
        quantityUnits: quantity,
      },
      correlationId: correlation,
    });
    await logEvent(supabase, {
      aggregateType: "pallet",
      aggregateId: reservation.pallet_id,
      eventType: "PACK_PALLET_RESERVATION_RELEASED",
      payload: {
        palletId: reservation.pallet_id,
        orderId: order.id,
        quantityUnits: quantity,
      },
      correlationId: correlation,
    });
  }

  const { error } = await supabase
    .from("sales_orders")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
    })
    .eq("tenant_id", profile.tenant_id)
    .eq("id", order.id);

  if (error) {
    throw new Error(error.message);
  }

  await logEvent(supabase, {
    aggregateType: "sales_order",
    aggregateId: order.id,
    eventType: "SALES_ORDER_CANCELLED",
    payload: {
      orderId: order.id,
      reason: reason?.trim() || null,
      cancelledAt: new Date().toISOString(),
    },
  });
}

export async function computeFulfillment({ orderId }: { orderId: string }) {
  const profile = await assertProfile();
  const order = await fetchOrder(orderId, profile.tenant_id);

  const supabase = await createServerSupabaseClient();

  const [totalsResult, reservationsResult, shippedResult] = await Promise.all([
    supabase
      .from("sales_order_totals_v")
      .select("total_units, total_value_est")
      .eq("tenant_id", profile.tenant_id)
      .eq("order_id", order.id)
      .maybeSingle(),
    supabase
      .from("order_reservations_v")
      .select("reserved_units")
      .eq("tenant_id", profile.tenant_id)
      .eq("order_id", order.id),
    supabase
      .from("order_shipped_v")
      .select("shipped_units")
      .eq("tenant_id", profile.tenant_id)
      .eq("order_id", order.id)
      .maybeSingle(),
  ]);

  const [totals, totalsError] = [totalsResult.data, totalsResult.error];
  const [reservations, reservationsError] = [reservationsResult.data, reservationsResult.error];
  const [shipped, shippedError] = [shippedResult.data, shippedResult.error];

  if (
    (totalsError && totalsError.code !== VIEW_MISSING_CODE) ||
    (reservationsError && reservationsError.code !== VIEW_MISSING_CODE) ||
    (shippedError && shippedError.code !== VIEW_MISSING_CODE)
  ) {
    throw new Error(
      totalsError?.message ?? reservationsError?.message ?? shippedError?.message ?? "Unable to compute fulfilment.",
    );
  }

  const totalUnits = Number(totals?.total_units ?? 0);
  const totalValue = Number(totals?.total_value_est ?? 0);
  const reservedUnits = (reservations ?? []).reduce((acc, row) => {
    const value = Number(row.reserved_units ?? 0);
    return acc + (Number.isFinite(value) ? value : 0);
  }, 0);
  const shippedUnits = Number(shipped?.shipped_units ?? 0);

  const fulfilmentPct =
    totalUnits > 0 ? Number(((shippedUnits / totalUnits) * 100).toFixed(2)) : 0;

  return {
    orderId: order.id,
    totalUnits,
    totalValue,
    reservedUnits,
    shippedUnits,
    fulfilmentPct,
  };
}
