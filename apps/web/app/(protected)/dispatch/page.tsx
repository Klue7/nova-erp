import { redirect } from "next/navigation";

import { DispatchDetail } from "./components/dispatch-detail";
import { ShipmentsTable, type ShipmentRow } from "./components/shipments-table";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { guardRoute } from "@/lib/rbac";
import { createServerSupabaseClient } from "@/utils/supabase/server";

const ALLOWED_ROLES = ["dispatch_clerk", "admin"] as const;
const VIEW_MISSING_CODE = "42P01";

function isViewMissing(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === VIEW_MISSING_CODE
  );
}

type SearchParams = Record<string, string | string[] | undefined>;

type KpiSummary = {
  shipmentsDispatchedToday: number;
  unitsDispatchedToday: number;
  netKgDispatchedToday: number;
  openShipments: number;
};

type ShipmentSummary = {
  id: string;
  code: string;
  status: string;
  customerCode: string | null;
  customerName: string | null;
  deliveryAddress: Record<string, unknown> | null;
  carrier: string | null;
  vehicleReg: string | null;
  trailerReg: string | null;
  sealNo: string | null;
  createdAt: string | null;
  dispatchedAt: string | null;
};

type PickItem = {
  palletId: string;
  palletCode: string;
  productSku: string | null;
  grade: string | null;
  unitsPicked: number;
};

type AvailablePallet = {
  palletId: string;
  code: string;
  productSku: string | null;
  grade: string | null;
  locationCode: string | null;
  unitsAvailable: number;
};

type WeighbridgeInfo = {
  inGrossKg: number | null;
  inTareKg: number | null;
  outGrossKg: number | null;
  outTareKg: number | null;
  netKgEstimate: number | null;
};

type DispatchEvent = {
  occurredAt: string;
  eventType: string;
  description: string;
};

function numberOrZero(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

export default async function DispatchPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { profile } = await guardRoute();

  if (!profile) {
    return null;
  }

  if (!ALLOWED_ROLES.includes(profile.role as typeof ALLOWED_ROLES[number])) {
    redirect("/dashboard?toast=access-denied");
  }

  const supabase = await createServerSupabaseClient();

  const shipmentsQuery = supabase
    .from("shipment_summary_v")
    .select(
      "shipment_id, code, status, customer_name, customer_code, total_units_picked, net_kg_estimate, created_at",
    )
    .eq("tenant_id", profile.tenant_id)
    .order("created_at", { ascending: false });

  const kpiQuery = supabase
    .from("dispatch_kpi_today")
    .select(
      "shipments_dispatched_today, units_dispatched_today, net_kg_dispatched_today, open_shipments",
    )
    .eq("tenant_id", profile.tenant_id)
    .maybeSingle();

  const availablePalletsQuery = supabase
    .from("pallet_inventory_live_v")
    .select("pallet_id, code, product_sku, grade, units_available, location_id")
    .eq("tenant_id", profile.tenant_id)
    .gt("units_available", 0)
    .order("code", { ascending: true });

  const locationsQuery = supabase
    .from("pack_locations")
    .select("id, code")
    .eq("tenant_id", profile.tenant_id);

  const [shipmentsRes, kpiRes, palletsRes, locationsRes] = await Promise.all([
    shipmentsQuery,
    kpiQuery,
    availablePalletsQuery,
    locationsQuery,
  ]);

  if (shipmentsRes.error) {
    throw new Error(shipmentsRes.error.message);
  }
  if (locationsRes.error) {
    throw new Error(locationsRes.error.message);
  }

  if (palletsRes.error && !isViewMissing(palletsRes.error)) {
    throw new Error(palletsRes.error.message);
  }
  if (kpiRes.error && !isViewMissing(kpiRes.error)) {
    throw new Error(kpiRes.error.message);
  }

  const shipments: ShipmentRow[] = (shipmentsRes.data ?? []).map((row) => ({
    id: row.shipment_id,
    code: row.code,
    status: row.status,
    customerName: row.customer_name ?? null,
    totalUnitsPicked: numberOrZero(row.total_units_picked),
    netKgEstimate: row.net_kg_estimate ?? null,
    createdAt: row.created_at ?? null,
  }));

  const selectedParam = Array.isArray(searchParams.shipment)
    ? searchParams.shipment[0]
    : searchParams.shipment;
  const selectedShipmentId =
    selectedParam && shipments.some((shipment) => shipment.id === selectedParam)
      ? selectedParam
      : shipments[0]?.id ?? null;

  const kpis: KpiSummary = {
    shipmentsDispatchedToday: numberOrZero(kpiRes.data?.shipments_dispatched_today),
    unitsDispatchedToday: numberOrZero(kpiRes.data?.units_dispatched_today),
    netKgDispatchedToday: numberOrZero(kpiRes.data?.net_kg_dispatched_today),
    openShipments: numberOrZero(kpiRes.data?.open_shipments),
  };

  const locationMap = new Map(
    (locationsRes.data ?? []).map((location) => [location.id, location.code]),
  );

  const availablePallets: AvailablePallet[] = (palletsRes.data ?? []).map(
    (row) => ({
      palletId: row.pallet_id,
      code: row.code,
      productSku: row.product_sku ?? null,
      grade: row.grade ?? null,
      unitsAvailable: numberOrZero(row.units_available),
      locationCode: row.location_id ? locationMap.get(row.location_id) ?? null : null,
    }),
  );

  let selectedShipment: ShipmentSummary | null = null;
  let picks: PickItem[] = [];
  let weighbridge: WeighbridgeInfo | null = null;
  let events: DispatchEvent[] = [];

  if (selectedShipmentId) {
    const shipmentDetailQuery = supabase
      .from("shipments")
      .select(
        "id, code, status, customer_code, customer_name, delivery_address, carrier, vehicle_reg, trailer_reg, seal_no, created_at, dispatched_at",
      )
      .eq("tenant_id", profile.tenant_id)
      .eq("id", selectedShipmentId)
      .maybeSingle();

    const picksQuery = supabase
      .from("shipment_picks_v")
      .select("pallet_id, picked_units")
      .eq("tenant_id", profile.tenant_id)
      .eq("shipment_id", selectedShipmentId);

    const weighbridgeQuery = supabase
      .from("shipment_weighbridge_latest")
      .select(
        "in_gross_kg, in_tare_kg, out_gross_kg, out_tare_kg, net_kg_estimate",
      )
      .eq("tenant_id", profile.tenant_id)
      .eq("shipment_id", selectedShipmentId)
      .maybeSingle();

    const eventsQuery = supabase
      .from("dispatch_events")
      .select("event_type, payload, occurred_at")
      .eq("tenant_id", profile.tenant_id)
      .eq("aggregate_id", selectedShipmentId)
      .order("occurred_at", { ascending: false })
      .limit(20);

    const [shipmentDetailRes, picksRes, weighbridgeRes, eventsRes] =
      await Promise.all([shipmentDetailQuery, picksQuery, weighbridgeQuery, eventsQuery]);

    if (shipmentDetailRes.error) {
      throw new Error(shipmentDetailRes.error.message);
    }

    selectedShipment = shipmentDetailRes.data
      ? {
          id: shipmentDetailRes.data.id,
          code: shipmentDetailRes.data.code,
          status: shipmentDetailRes.data.status,
          customerCode: shipmentDetailRes.data.customer_code ?? null,
          customerName: shipmentDetailRes.data.customer_name ?? null,
          deliveryAddress: (shipmentDetailRes.data.delivery_address ?? null) as
            | Record<string, unknown>
            | null,
          carrier: shipmentDetailRes.data.carrier ?? null,
          vehicleReg: shipmentDetailRes.data.vehicle_reg ?? null,
          trailerReg: shipmentDetailRes.data.trailer_reg ?? null,
          sealNo: shipmentDetailRes.data.seal_no ?? null,
          createdAt: shipmentDetailRes.data.created_at ?? null,
          dispatchedAt: shipmentDetailRes.data.dispatched_at ?? null,
        }
      : null;

    if (picksRes.error && !isViewMissing(picksRes.error)) {
      throw new Error(picksRes.error.message);
    }

    const pickRows = picksRes.data ?? [];
    const pickIds = pickRows.map((row) => row.pallet_id);
    let pickMetaMap = new Map<string, { code: string; productSku: string | null; grade: string | null }>();

    if (pickIds.length > 0) {
      const pickMetaRes = await supabase
        .from("pallet_inventory_v")
        .select("pallet_id, code, product_sku, grade")
        .eq("tenant_id", profile.tenant_id)
        .in("pallet_id", pickIds);

      if (pickMetaRes.error && !isViewMissing(pickMetaRes.error)) {
        throw new Error(pickMetaRes.error.message);
      }

      pickMetaMap = new Map(
        (pickMetaRes.data ?? []).map((row) => [row.pallet_id, {
          code: row.code,
          productSku: row.product_sku ?? null,
          grade: row.grade ?? null,
        }]),
      );
    }

    picks = pickRows
      .map((row) => {
        const meta = pickMetaMap.get(row.pallet_id);
        return {
          palletId: row.pallet_id,
          palletCode: meta?.code ?? row.pallet_id,
          productSku: meta?.productSku ?? null,
          grade: meta?.grade ?? null,
          unitsPicked: numberOrZero(row.picked_units),
        };
      })
      .filter((pick) => pick.unitsPicked > 0);

    if (weighbridgeRes.error && !isViewMissing(weighbridgeRes.error)) {
      throw new Error(weighbridgeRes.error.message);
    }

    weighbridge = weighbridgeRes.data
      ? {
          inGrossKg: weighbridgeRes.data.in_gross_kg ?? null,
          inTareKg: weighbridgeRes.data.in_tare_kg ?? null,
          outGrossKg: weighbridgeRes.data.out_gross_kg ?? null,
          outTareKg: weighbridgeRes.data.out_tare_kg ?? null,
          netKgEstimate: weighbridgeRes.data.net_kg_estimate ?? null,
        }
      : null;

    if (eventsRes.error && !isViewMissing(eventsRes.error)) {
      throw new Error(eventsRes.error.message);
    }

    events = (eventsRes.data ?? []).map((event) => ({
      occurredAt: event.occurred_at ?? new Date().toISOString(),
      eventType: event.event_type,
      description: describeDispatchEvent(event.event_type, event.payload ?? {}),
    }));
  }

  return (
    <div className="space-y-8">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard title="Shipments dispatched" description="Completed today" value={kpis.shipmentsDispatchedToday} />
        <KpiCard
          title="Units dispatched"
          description="Units on deliveries today"
          value={kpis.unitsDispatchedToday}
        />
        <KpiCard
          title="Net kg dispatched"
          description="Estimated net weight today"
          value={kpis.netKgDispatchedToday}
          format="number"
        />
        <KpiCard
          title="Open shipments"
          description="Awaiting dispatch"
          value={kpis.openShipments}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr,3fr]">
        <Card>
          <CardHeader>
            <CardTitle>Shipments</CardTitle>
            <CardDescription>Plan and monitor outbound loads.</CardDescription>
          </CardHeader>
          <CardContent>
            <ShipmentsTable shipments={shipments} />
          </CardContent>
        </Card>

        <DispatchDetail
          shipment={selectedShipment}
          picks={picks}
          availablePallets={availablePallets}
          weighbridge={weighbridge}
          events={events}
        />
      </div>
    </div>
  );
}

type KpiCardProps = {
  title: string;
  description: string;
  value: number;
  format?: "number" | "default";
};

function KpiCard({ title, description, value, format = "default" }: KpiCardProps) {
  const display =
    format === "number" ? value.toLocaleString(undefined, { maximumFractionDigits: 0 }) : value;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-semibold text-foreground">{display}</p>
      </CardContent>
    </Card>
  );
}

function describeDispatchEvent(eventType: string, payload: Record<string, unknown>) {
  const quantity = payload.quantityUnits ? numberOrZero(payload.quantityUnits) : null;
  switch (eventType) {
    case "SHIPMENT_CREATED":
      return `Shipment created (${payload.shipmentCode ?? "code"})`;
    case "SHIPMENT_PICKLIST_CREATED":
      return "Picklist created";
    case "SHIPMENT_PICK_ADDED":
      return `Picked ${quantity ?? 0} units from pallet ${payload.palletCode ?? payload.palletId}`;
    case "SHIPMENT_PICK_REMOVED":
      return `Removed ${quantity ?? 0} units from picklist`;
    case "SHIPMENT_WEIGHBRIDGE_IN":
      return `Weighbridge in @ ${payload.grossKg ?? "?"} kg`;
    case "SHIPMENT_WEIGHBRIDGE_OUT":
      return `Weighbridge out @ ${payload.grossKg ?? "?"} kg`;
    case "SHIPMENT_DISPATCHED":
      return `Dispatch completed (${payload.totalUnits ?? 0} units)`;
    case "SHIPMENT_CANCELLED":
      return "Shipment cancelled";
    case "SHIPMENT_CARRIER_SET":
      return `Carrier set to ${payload.carrier ?? "n/a"}`;
    default:
      return eventType;
  }
}
