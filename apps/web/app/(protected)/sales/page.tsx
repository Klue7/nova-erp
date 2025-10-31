import { redirect } from "next/navigation";

import { createServerSupabaseClient } from "@/utils/supabase/server";
import { guardRoute } from "@/lib/rbac";
import { listAvailablePallets } from "@/lib/upstream";
import { SalesKpiCards, type SalesKpi } from "./components/kpi-cards";
import {
  SalesSidebar,
  type CustomerRow,
  type ProductRow,
} from "./components/sales-sidebar";
import {
  SalesDetail,
  type SelectedOrder,
  type OrderLineRow,
  type ReservationRow,
  type AvailablePalletRow,
} from "./components/sales-detail";
import type { SalesOrderRow } from "./components/orders-table";

type SalesSearchParams = Record<string, string | string[] | undefined>;

type PageProps = {
  searchParams?: Promise<SalesSearchParams>;
};

const VIEW_MISSING_CODE = "42P01";

export default async function SalesPage({ searchParams }: PageProps) {
  const { profile } = await guardRoute({
    requiredRole: ["sales_rep", "admin"],
  });

  if (!profile) {
    redirect("/onboarding");
  }

  const params: SalesSearchParams = searchParams ? await searchParams : {};

  const supabase = await createServerSupabaseClient();
  const tenantId = profile.tenant_id;

  const [
    kpiResult,
    ordersResult,
    totalsResult,
    reservationsResult,
    shippedResult,
    customersResult,
    productsResult,
    pricesResult,
    palletLookupResult,
    locationsResult,
  ] = await Promise.all([
    supabase
      .from("sales_kpi_today")
      .select("open_orders, units_ordered_today, units_reserved, units_shipped_today")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    supabase
      .from("sales_orders")
      .select(
        "id, code, status, created_at, confirmed_at, customer:customer_id (id, code, name)",
      )
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false }),
    supabase
      .from("sales_order_totals_v")
      .select("order_id, total_units, total_value_est")
      .eq("tenant_id", tenantId),
    supabase
      .from("order_reservations_v")
      .select("order_id, pallet_id, reserved_units")
      .eq("tenant_id", tenantId),
    supabase.from("order_shipped_v").select("order_id, shipped_units").eq("tenant_id", tenantId),
    supabase
      .from("customers")
      .select("id, code, name, credit_limit, status")
      .eq("tenant_id", tenantId)
      .order("name"),
    supabase.from("products").select("id, sku, name, uom, status").eq("tenant_id", tenantId),
    supabase
      .from("current_product_price_v")
      .select("product_id, unit_price, currency")
      .eq("tenant_id", tenantId),
    supabase.from("pallets").select("id, code").eq("tenant_id", tenantId),
    supabase.from("pack_locations").select("id, code").eq("tenant_id", tenantId),
  ]);

  if (kpiResult.error && kpiResult.error.code !== VIEW_MISSING_CODE) {
    throw kpiResult.error;
  }
  if (ordersResult.error) throw ordersResult.error;
  if (totalsResult.error && totalsResult.error.code !== VIEW_MISSING_CODE) {
    throw totalsResult.error;
  }
  if (reservationsResult.error && reservationsResult.error.code !== VIEW_MISSING_CODE) {
    throw reservationsResult.error;
  }
  if (shippedResult.error && shippedResult.error.code !== VIEW_MISSING_CODE) {
    throw shippedResult.error;
  }
  if (customersResult.error) throw customersResult.error;
  if (productsResult.error) throw productsResult.error;
  if (pricesResult.error && pricesResult.error.code !== VIEW_MISSING_CODE) {
    throw pricesResult.error;
  }
  if (palletLookupResult.error) throw palletLookupResult.error;
  if (locationsResult.error) throw locationsResult.error;

  const kpiData: SalesKpi = {
    openOrders: Number(kpiResult.data?.open_orders ?? 0),
    unitsOrderedToday: Number(kpiResult.data?.units_ordered_today ?? 0),
    unitsReserved: Number(kpiResult.data?.units_reserved ?? 0),
    unitsShippedToday: Number(kpiResult.data?.units_shipped_today ?? 0),
  };

  const totalsMap = new Map<
    string,
    {
      totalUnits: number;
      totalValue: number;
    }
  >();
  (totalsResult.data ?? []).forEach((row) => {
    totalsMap.set(row.order_id, {
      totalUnits: Number(row.total_units ?? 0),
      totalValue: Number(row.total_value_est ?? 0),
    });
  });

  const shippedMap = new Map<string, number>();
  (shippedResult.data ?? []).forEach((row) => {
    shippedMap.set(row.order_id, Number(row.shipped_units ?? 0));
  });

  const palletCodeMap = new Map<string, string>();
  (palletLookupResult.data ?? []).forEach((row) => {
    palletCodeMap.set(row.id, row.code);
  });

  const locationCodeMap = new Map<string, string>();
  (locationsResult.data ?? []).forEach((row) => {
    locationCodeMap.set(row.id, row.code);
  });

  const reservationTotals = new Map<string, number>();
  const reservationsByOrder = new Map<string, ReservationRow[]>();
  (reservationsResult.data ?? []).forEach((row) => {
    const orderId = row.order_id;
    const palletId = row.pallet_id;
    const units = Number(row.reserved_units ?? 0);
    if (!orderId || !palletId) return;

    reservationTotals.set(orderId, (reservationTotals.get(orderId) ?? 0) + units);

    if (units > 0) {
      const items = reservationsByOrder.get(orderId) ?? [];
      items.push({
        palletId,
        palletCode: palletCodeMap.get(palletId) ?? palletId.slice(0, 8),
        unitsReserved: units,
      });
      reservationsByOrder.set(orderId, items);
    }
  });

  const priceMap = new Map<string, { unitPrice: number; currency: string }>();
  (pricesResult.data ?? []).forEach((row) => {
    priceMap.set(row.product_id, {
      unitPrice: Number(row.unit_price ?? 0),
      currency: row.currency ?? "ZAR",
    });
  });

  const customerRows: CustomerRow[] = (customersResult.data ?? []).map((customer) => ({
    id: customer.id,
    code: customer.code,
    name: customer.name,
    creditLimit: customer.credit_limit ? Number(customer.credit_limit) : null,
    status: customer.status,
  }));

  const productRows: ProductRow[] = (productsResult.data ?? []).map((product) => ({
    id: product.id,
    sku: product.sku,
    name: product.name,
    uom: product.uom,
    status: product.status,
    price: priceMap.get(product.id) ?? null,
  }));

  const orderRows: SalesOrderRow[] = (ordersResult.data ?? []).map((order) => {
    const customer = Array.isArray(order.customer)
      ? order.customer[0] ?? null
      : (order.customer ?? null);
    const totals = totalsMap.get(order.id) ?? { totalUnits: 0, totalValue: 0 };
    const reserved = reservationTotals.get(order.id) ?? 0;
    const shipped = shippedMap.get(order.id) ?? 0;
    return {
      id: order.id,
      code: order.code,
      status: order.status,
      customerName: customer?.name ?? "Unassigned",
      customerCode: customer?.code ?? null,
      totalUnits: totals.totalUnits,
      reservedUnits: reserved > 0 ? reserved : 0,
      shippedUnits: shipped > 0 ? shipped : 0,
      valueEstimate: totals.totalValue,
      currency: null,
      createdAt: order.created_at,
    };
  });

  const orderParam = params.order;
  const orderParamValue =
    typeof orderParam === "string" ? orderParam : Array.isArray(orderParam) ? orderParam[0] : null;
  const selectedOrderId = orderRows.some((order) => order.id === orderParamValue)
    ? orderParamValue
    : orderRows[0]?.id ?? null;

  type LineQueryRow = {
    product_id: string;
    sku: string;
    quantity_units: number | null;
    line_value_est: number | null;
    currency: string | null;
  };

  const linesResult = selectedOrderId
    ? await supabase
        .from("sales_order_lines_v")
        .select("product_id, sku, quantity_units, line_value_est, currency")
        .eq("tenant_id", tenantId)
        .eq("order_id", selectedOrderId)
    : { data: [] as LineQueryRow[], error: null };

  if (linesResult.error && linesResult.error.code !== VIEW_MISSING_CODE) {
    throw linesResult.error;
  }

  const lineRows: OrderLineRow[] = (linesResult.data ?? []).map((line) => ({
    productId: line.product_id,
    sku: line.sku,
    quantityUnits: Number(line.quantity_units ?? 0),
    lineValue: Number(line.line_value_est ?? 0),
    currency: line.currency ?? null,
  }));

  const fallbackPriceEntry = priceMap.values().next();
  const fallbackCurrency =
    fallbackPriceEntry && !fallbackPriceEntry.done ? fallbackPriceEntry.value.currency : null;
  const selectedOrderCurrency =
    lineRows.find((line) => line.currency)?.currency ?? fallbackCurrency ?? "ZAR";

  const selectedOrderBase = selectedOrderId
    ? ordersResult.data?.find((order) => order.id === selectedOrderId) ?? null
    : null;
  const selectedOrderRow = orderRows.find((order) => order.id === selectedOrderId) ?? null;

  const selectedReservations: ReservationRow[] =
    (selectedOrderId ? reservationsByOrder.get(selectedOrderId) : null) ?? [];

  const availablePallets = await listAvailablePallets();
  const inventoryRows: AvailablePalletRow[] = availablePallets.map((pallet) => ({
    palletId: pallet.id,
    code: pallet.code,
    productSku: pallet.productSku ?? null,
    grade: pallet.grade ?? null,
    locationCode: pallet.locationId ? locationCodeMap.get(pallet.locationId) ?? null : null,
    unitsAvailable: pallet.unitsAvailable,
  }));

  const selectedOrder: SelectedOrder | null =
    selectedOrderBase && selectedOrderRow
      ? {
          id: selectedOrderRow.id,
          code: selectedOrderRow.code,
          status: selectedOrderRow.status,
          customerName: selectedOrderRow.customerName,
          customerCode: selectedOrderRow.customerCode,
          totalUnits: selectedOrderRow.totalUnits,
          totalValue: selectedOrderRow.valueEstimate,
          reservedUnits: selectedOrderRow.reservedUnits,
          shippedUnits: selectedOrderRow.shippedUnits,
          currency: selectedOrderCurrency ?? "ZAR",
          createdAt: selectedOrderBase.created_at,
          confirmedAt: selectedOrderBase.confirmed_at,
        }
      : null;

  return (
    <div className="space-y-8">
      <SalesKpiCards data={kpiData} />
      <div className="grid gap-6 lg:grid-cols-[360px,1fr]">
        <SalesSidebar orders={orderRows} customers={customerRows} products={productRows} />
        <SalesDetail
          order={selectedOrder}
          lines={lineRows}
          reservations={selectedReservations}
          availablePallets={inventoryRows}
          products={productRows}
        />
      </div>
    </div>
  );
}
