import { redirect } from "next/navigation";

import { PalletTable, type PalletRow } from "./components/pallet-table";
import { PackingActions } from "./components/packing-actions";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { guardRoute } from "@/lib/rbac";
import { listAvailableForPacking } from "@/lib/upstream";
import { createServerSupabaseClient } from "@/utils/supabase/server";

const ALLOWED_ROLES = ["packing_operator", "admin"] as const;
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

type InputSummary = {
  kilnBatchId: string;
  kilnBatchCode: string;
  totalUnits: number;
  lastOccurredAt: string | null;
  availableUnits: number | null;
};

type EventLogItem = {
  occurredAt: string;
  eventType: string;
  description: string;
};

type LocationOption = {
  id: string;
  code: string;
  type?: string | null;
  status: string;
  capacityPallets?: number | null;
};

type KilnOption = {
  id: string;
  code: string;
  availableUnits: number;
};

type PalletDetail = {
  id: string;
  code: string;
  status: string;
  productSku: string;
  grade: string;
  unitsOnPallet: number;
  unitsAvailable: number;
  reservedUnits: number;
  locationCode: string | null;
  locationId: string | null;
  inputs: InputSummary[];
  events: EventLogItem[];
};

function numberOrZero(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

export default async function PackingPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { profile } = await guardRoute();

  if (!profile) {
    return null;
  }

  if (!ALLOWED_ROLES.includes(profile.role as typeof ALLOWED_ROLES[number])) {
    redirect("/dashboard?toast=access-denied");
  }

  const supabase = await createServerSupabaseClient();

  const palletsQuery = supabase
    .from("pallets")
    .select(
      "id, code, product_sku, grade, status, location_id, capacity_units, created_at",
    )
    .eq("tenant_id", profile.tenant_id)
    .order("created_at", { ascending: false });

  const inventoryQuery = supabase
    .from("pallet_inventory_v")
    .select(
      "pallet_id, units_on_pallet, units_available, input_units, scrap_units, reserved_units",
    )
    .eq("tenant_id", profile.tenant_id);

  const kpiQuery = supabase
    .from("packing_kpi_today")
    .select(
      "pallets_built_today, units_packed_today, scrap_units_today, open_units_available",
    )
    .eq("tenant_id", profile.tenant_id)
    .maybeSingle();

  const locationsQuery = supabase
    .from("pack_locations")
    .select("id, code, type, capacity_pallets, status")
    .eq("tenant_id", profile.tenant_id)
    .order("code", { ascending: true });

  const [
    palletsRes,
    inventoryRes,
    kpiRes,
    locationsRes,
  ] = await Promise.all([
    palletsQuery,
    inventoryQuery,
    kpiQuery,
    locationsQuery,
  ]);

  if (palletsRes.error) {
    throw new Error(palletsRes.error.message);
  }
  if (locationsRes.error) {
    throw new Error(locationsRes.error.message);
  }

  if (inventoryRes.error && !isViewMissing(inventoryRes.error)) {
    throw new Error(inventoryRes.error.message);
  }
  if (kpiRes.error && !isViewMissing(kpiRes.error)) {
    throw new Error(kpiRes.error.message);
  }

  const inventoryMap = new Map(
    (inventoryRes.data ?? []).map((row) => [row.pallet_id, row]),
  );

  const locationMap = new Map(
    (locationsRes.data ?? []).map((location) => [location.id, location]),
  );

  const palletSourceMap = new Map(
    (palletsRes.data ?? []).map((pallet) => [pallet.id, pallet]),
  );

  const pallets: PalletRow[] = (palletsRes.data ?? []).map((pallet) => {
    const metrics = inventoryMap.get(pallet.id);
    const location = pallet.location_id
      ? locationMap.get(pallet.location_id)
      : null;
    return {
      id: pallet.id,
      code: pallet.code,
      productSku: pallet.product_sku ?? "—",
      grade: pallet.grade ?? "",
      status: pallet.status,
      locationCode: location?.code ?? null,
      unitsOnPallet: numberOrZero(metrics?.units_on_pallet),
      unitsAvailable: numberOrZero(metrics?.units_available),
    } satisfies PalletRow;
  });

  const params = await searchParams;

  const paramsValue = Array.isArray(params.pallet)
    ? params.pallet[0]
    : params.pallet;
  const selectedPalletId = paramsValue && pallets.some((p) => p.id === paramsValue)
    ? paramsValue
    : pallets[0]?.id ?? null;

  const locationOptions: LocationOption[] = (locationsRes.data ?? []).map(
    (location) => ({
      id: location.id,
      code: location.code,
      type: location.type ?? null,
      status: location.status,
      capacityPallets: location.capacity_pallets ?? null,
    }),
  );

  const kilnOptions: KilnOption[] = (await listAvailableForPacking())
    .map((option) => ({
      id: option.id,
      code: option.code,
      availableUnits: option.availableUnits,
    }))
    .sort((a, b) => b.availableUnits - a.availableUnits);

  let selectedDetail: PalletDetail | null = null;

  if (selectedPalletId) {
    const selectedRow = pallets.find((pallet) => pallet.id === selectedPalletId);
    if (selectedRow) {
      const metrics = inventoryMap.get(selectedRow.id);
      const original = palletSourceMap.get(selectedRow.id);
      const location =
        original?.location_id && locationMap.has(original.location_id)
          ? locationMap.get(original.location_id)!
          : null;

      const eventsRes = await supabase
        .from("packing_events")
        .select("event_type, payload, occurred_at")
        .eq("tenant_id", profile.tenant_id)
        .eq("aggregate_id", selectedRow.id)
        .order("occurred_at", { ascending: false })
        .limit(50);

      if (eventsRes.error && !isViewMissing(eventsRes.error)) {
        throw new Error(eventsRes.error.message);
      }

      const inputAggregate = new Map<string, InputSummary>();
      const eventLog: EventLogItem[] = [];

      (eventsRes.data ?? []).forEach((event) => {
        const occurredAt = event.occurred_at ?? new Date().toISOString();
        if (event.event_type === "PACK_INPUT_ADDED") {
          const kilnBatchId = event.payload?.kilnBatchId as string | undefined;
          if (kilnBatchId) {
            const current = inputAggregate.get(kilnBatchId) ?? {
              kilnBatchId,
              kilnBatchCode: (event.payload?.kilnBatchCode as string | undefined) ??
                kilnBatchMap.get(kilnBatchId) ?? kilnBatchId,
              totalUnits: 0,
              lastOccurredAt: null,
              availableUnits: kilnOptions.find((k) => k.id === kilnBatchId)?.availableUnits ?? null,
            };
            current.totalUnits += numberOrZero(event.payload?.quantityUnits);
            current.lastOccurredAt = occurredAt;
            inputAggregate.set(kilnBatchId, current);
          }
        }

        const description = (() => {
          switch (event.event_type) {
            case "PACK_INPUT_ADDED":
              return `Added ${numberOrZero(event.payload?.quantityUnits)} units from ${event.payload?.kilnBatchCode ?? "kiln batch"}.`;
            case "PACK_PALLET_GRADED":
              return `Grade updated to ${event.payload?.grade ?? "n/a"}.`;
            case "PACK_PALLET_MOVED":
              return `Moved to location ${event.payload?.toLocationId ?? "n/a"}.`;
            case "PACK_PALLET_RESERVED":
              return `Reserved ${numberOrZero(event.payload?.quantityUnits)} units for order ${event.payload?.orderId ?? "n/a"}.`;
            case "PACK_PALLET_RESERVATION_RELEASED":
              return `Released ${numberOrZero(event.payload?.quantityUnits)} units for order ${event.payload?.orderId ?? "n/a"}.`;
            case "PACK_SCRAP_RECORDED":
              return `Scrap recorded: ${numberOrZero(event.payload?.scrapUnits)} units.`;
            case "PACK_PALLET_CLOSED":
              return `Pallet closed.`;
            case "PACK_PALLET_CANCELLED":
              return `Pallet cancelled.`;
            case "PACK_LABEL_PRINTED":
              return `Label printed.`;
            default:
              return event.event_type;
          }
        })();

        eventLog.push({
          occurredAt,
          eventType: event.event_type,
          description,
        });
      });

      selectedDetail = {
        id: selectedRow.id,
        code: selectedRow.code,
        status: selectedRow.status,
        productSku: selectedRow.productSku,
        grade: selectedRow.grade,
        unitsOnPallet: selectedRow.unitsOnPallet,
        unitsAvailable: selectedRow.unitsAvailable,
        reservedUnits: numberOrZero(metrics?.reserved_units),
        locationCode: location?.code ?? null,
        locationId: location?.id ?? null,
        inputs: Array.from(inputAggregate.values()).sort((a, b) => {
          if (!a.lastOccurredAt) return 1;
          if (!b.lastOccurredAt) return -1;
          return new Date(b.lastOccurredAt).getTime() - new Date(a.lastOccurredAt).getTime();
        }),
        events: eventLog.slice(0, 8),
      };
    }
  }

  const kpi = kpiRes.data ?? {
    pallets_built_today: 0,
    units_packed_today: 0,
    scrap_units_today: 0,
    open_units_available: 0,
  };

  const selectedSummary = selectedDetail
    ? {
        id: selectedDetail.id,
        code: selectedDetail.code,
        status: selectedDetail.status,
        productSku: selectedDetail.productSku,
        grade: selectedDetail.grade,
        unitsAvailable: selectedDetail.unitsAvailable,
        locationId: selectedDetail.locationId,
      }
    : null;

  return (
    <div className="space-y-8">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle>Pallets built</CardTitle>
            <CardDescription>Created today</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold text-foreground">
              {numberOrZero(kpi.pallets_built_today)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Units packed</CardTitle>
            <CardDescription>Units assigned to pallets today</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold text-foreground">
              {numberOrZero(kpi.units_packed_today).toFixed(0)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Scrap today</CardTitle>
            <CardDescription>Units scrapped from pallets</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold text-foreground">
              {numberOrZero(kpi.scrap_units_today).toFixed(0)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Open pallet units</CardTitle>
            <CardDescription>Available inventory across open pallets</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold text-foreground">
              {numberOrZero(kpi.open_units_available).toFixed(0)}
            </p>
          </CardContent>
        </Card>
      </div>

      <PackingActions
        locations={locationOptions}
        kilnOptions={kilnOptions}
        selectedPallet={selectedSummary}
      />

      <div className="grid gap-6 lg:grid-cols-[2fr,3fr]">
        <Card>
          <CardHeader>
            <CardTitle>Pallet inventory</CardTitle>
            <CardDescription>Live view of pallets and availability.</CardDescription>
          </CardHeader>
          <CardContent>
            <PalletTable pallets={pallets} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Pallet details</CardTitle>
            <CardDescription>
              Operational context, inputs, and recent actions.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {!selectedDetail ? (
              <div className="rounded-lg border border-dashed border-border/60 p-6 text-sm text-muted-foreground">
                Select a pallet to inspect its timeline and inputs.
              </div>
            ) : (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-semibold text-foreground">
                    {selectedDetail.code}
                  </h3>
                  <dl className="mt-3 grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <dt className="text-muted-foreground">Product SKU</dt>
                      <dd className="font-medium text-foreground">
                        {selectedDetail.productSku}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Grade</dt>
                      <dd className="font-medium text-foreground">
                        {selectedDetail.grade || "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Status</dt>
                      <dd className="capitalize font-medium text-foreground">
                        {selectedDetail.status}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Location</dt>
                      <dd className="font-medium text-foreground">
                        {selectedDetail.locationCode ?? "Unassigned"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Units on pallet</dt>
                      <dd className="font-medium text-foreground">
                        {selectedDetail.unitsOnPallet.toFixed(0)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Available units</dt>
                      <dd className="font-medium text-foreground">
                        {selectedDetail.unitsAvailable.toFixed(0)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Reserved units</dt>
                      <dd className="font-medium text-foreground">
                        {selectedDetail.reservedUnits.toFixed(0)}
                      </dd>
                    </div>
                  </dl>
                </div>

                <div>
                  <h4 className="text-sm font-semibold text-foreground">Inputs by kiln batch</h4>
                  {selectedDetail.inputs.length === 0 ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      No kiln inputs recorded yet.
                    </p>
                  ) : (
                    <Table className="mt-3">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Batch</TableHead>
                          <TableHead className="text-right">Units</TableHead>
                          <TableHead className="text-right">Remaining</TableHead>
                          <TableHead>Last added</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {selectedDetail.inputs.map((input) => (
                          <TableRow key={input.kilnBatchId}>
                            <TableCell className="font-medium text-foreground">
                              {input.kilnBatchCode}
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs text-muted-foreground">
                              {input.totalUnits.toFixed(0)}
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs text-muted-foreground">
                              {input.availableUnits !== null
                                ? input.availableUnits.toFixed(0)
                                : "—"}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {input.lastOccurredAt
                                ? new Date(input.lastOccurredAt).toLocaleString()
                                : "—"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>

                <div>
                  <h4 className="text-sm font-semibold text-foreground">Recent events</h4>
                  {selectedDetail.events.length === 0 ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      No events captured yet.
                    </p>
                  ) : (
                    <ul className="mt-3 space-y-2 text-xs text-muted-foreground">
                      {selectedDetail.events.map((event) => (
                        <li key={`${event.eventType}-${event.occurredAt}`}>
                          <span className="font-medium text-foreground">
                            {new Date(event.occurredAt).toLocaleString()}
                          </span>
                          {": "}
                          {event.description}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
