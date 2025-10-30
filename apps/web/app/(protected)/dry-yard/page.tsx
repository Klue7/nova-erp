import { redirect } from "next/navigation";

import { DryActions } from "./components/dry-actions";
import { LoadsTable, type LoadRow } from "./components/loads-table";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { guardRoute } from "@/lib/rbac";
import { createServerSupabaseClient } from "@/utils/supabase/server";

const ALLOWED_ROLES = ["dryyard_operator", "admin"];
const VIEW_MISSING_CODE = "42P01";

type DryYardPageProps = {
  searchParams: Record<string, string | string[] | undefined>;
};

type RackDisplay = {
  id: string;
  code: string;
  bay: string | null;
  capacityUnits: number;
  occupiedUnits: number;
  status: string;
};

type ExtrusionOption = {
  id: string;
  code: string;
  availableUnits: number;
};

type MoistureReading = {
  occurredAt: string | null;
  moisturePct: number;
  method: string | null;
};

function isViewMissing(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === VIEW_MISSING_CODE
  );
}

function numberOrZero(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

export default async function DryYardPage({
  searchParams,
}: DryYardPageProps) {
  const { profile } = await guardRoute();

  if (!profile) {
    return null;
  }

  if (!ALLOWED_ROLES.includes(profile.role)) {
    redirect("/dashboard?toast=access-denied");
  }

  const supabase = await createServerSupabaseClient();

  const racksQuery = supabase
    .from("dry_racks")
    .select("id, code, bay, capacity_units, status")
    .eq("tenant_id", profile.tenant_id)
    .order("code", { ascending: true });

  const occupancyQuery = supabase
    .from("dry_rack_occupancy_v")
    .select("rack_id, occupied_units")
    .eq("tenant_id", profile.tenant_id);

  const loadsQuery = supabase
    .from("dry_loads")
    .select(
      "id, code, rack_id, status, started_at, completed_at, created_at, target_moisture_pct",
    )
    .eq("tenant_id", profile.tenant_id)
    .order("created_at", { ascending: false });

  const metricsQuery = supabase
    .from("dry_load_metrics_v")
    .select(
      "load_id, input_units, scrap_units, latest_moisture_pct, dwell_hours",
    )
    .eq("tenant_id", profile.tenant_id);

  const kpiQuery = supabase
    .from("dry_kpi_today")
    .select(
      "active_loads, units_loaded_today, units_completed_today, avg_active_moisture",
    )
    .eq("tenant_id", profile.tenant_id)
    .maybeSingle();

  const extrusionAvailabilityQuery = supabase
    .from("extrusion_available_for_drying_v")
    .select("extrusion_run_id, available_units")
    .eq("tenant_id", profile.tenant_id)
    .gt("available_units", 0);

  const extrusionRunsQuery = supabase
    .from("extrusion_runs")
    .select("id, code")
    .eq("tenant_id", profile.tenant_id);

  const [
    racksRes,
    occupancyRes,
    loadsRes,
    metricsRes,
    kpiRes,
    extrusionAvailabilityRes,
    extrusionRunsRes,
  ] = await Promise.all([
    racksQuery,
    occupancyQuery,
    loadsQuery,
    metricsQuery,
    kpiQuery,
    extrusionAvailabilityQuery,
    extrusionRunsQuery,
  ]);

  if (racksRes.error) throw new Error(racksRes.error.message);
  if (
    occupancyRes.error &&
    !isViewMissing(occupancyRes.error)
  ) {
    throw new Error(occupancyRes.error.message);
  }
  if (loadsRes.error) throw new Error(loadsRes.error.message);
  if (metricsRes.error && !isViewMissing(metricsRes.error)) {
    throw new Error(metricsRes.error.message);
  }
  if (
    extrusionAvailabilityRes.error &&
    !isViewMissing(extrusionAvailabilityRes.error)
  ) {
    throw new Error(extrusionAvailabilityRes.error.message);
  }
  if (extrusionRunsRes.error) {
    throw new Error(extrusionRunsRes.error.message);
  }

  const occupancyMap = new Map<string, number>();
  (occupancyRes.data ?? []).forEach((row) => {
    occupancyMap.set(
      row.rack_id,
      Number(row.occupied_units ?? 0),
    );
  });

  const racks: RackDisplay[] = (racksRes.data ?? []).map((rack) => ({
    id: rack.id,
    code: rack.code,
    bay: rack.bay ?? null,
    capacityUnits: numberOrZero(rack.capacity_units),
    occupiedUnits: occupancyMap.get(rack.id) ?? 0,
    status: rack.status ?? "active",
  }));

  const rackCodeMap = new Map(racks.map((rack) => [rack.id, rack.code]));

  const loads = loadsRes.data ?? [];
  const metricRows = (metricsRes.data ?? []) as NonNullable<
    typeof metricsRes.data
  >;
  type MetricsRow = typeof metricRows[number];
  const metricsMap = new Map<string, MetricsRow>();
  metricRows.forEach((row) => metricsMap.set(row.load_id, row));

  const loadRows: LoadRow[] = loads
    .filter((load) =>
      ["planned", "active"].includes(load.status ?? ""),
    )
    .map((load) => {
      const metrics = metricsMap.get(load.id);
      return {
        id: load.id,
        code: load.code,
        rackCode: load.rack_id ? rackCodeMap.get(load.rack_id) ?? null : null,
        status: load.status,
        inputUnits: metrics ? numberOrZero(metrics.input_units) : 0,
        latestMoisturePct: metrics
          ? metrics.latest_moisture_pct ?? null
          : null,
        dwellHours: metrics ? metrics.dwell_hours ?? null : null,
      };
    });

  const searchSelected = Array.isArray(searchParams.load)
    ? searchParams.load[0]
    : searchParams.load;

  const selectedLoadId = (() => {
    if (searchSelected && loads.some((load) => load.id === searchSelected)) {
      return searchSelected;
    }
    if (loadRows.length > 0) {
      return loadRows[0].id;
    }
    return loads[0]?.id ?? null;
  })();

  const extrusionRunMap = new Map(
    (extrusionRunsRes.data ?? []).map((run) => [
      run.id,
      run.code,
    ]),
  );

  const extrusionOptions: ExtrusionOption[] = (
    extrusionAvailabilityRes.data ?? []
  )
    .map((row) => ({
      id: row.extrusion_run_id,
      code: extrusionRunMap.get(row.extrusion_run_id) ?? "Extrusion run",
      availableUnits: numberOrZero(row.available_units),
    }))
    .filter((option) => option.availableUnits > 0)
    .sort((a, b) => b.availableUnits - a.availableUnits);

  let selectedInputs: Array<{
    runId: string;
    runCode: string;
    quantityUnits: number;
  }> = [];
  let moistureHistory: MoistureReading[] = [];

  let selectedLoadSummary: {
    id: string;
    code: string;
    status: string;
    rackId: string | null;
    inputUnits: number;
    latestMoisturePct: number | null;
    targetMoisturePct: number | null;
    dwellHours: number | null;
    scrapUnits: number;
    startedAt: string | null;
    completedAt: string | null;
  } | null = null;

  if (selectedLoadId) {
    const load = loads.find((item) => item.id === selectedLoadId) ?? null;
    const metrics = metricsMap.get(selectedLoadId) ?? null;

    if (load) {
      selectedLoadSummary = {
        id: load.id,
        code: load.code,
        status: load.status,
        rackId: load.rack_id ?? null,
        inputUnits: metrics ? numberOrZero(metrics.input_units) : 0,
        latestMoisturePct: metrics?.latest_moisture_pct ?? null,
        targetMoisturePct:
          load.target_moisture_pct !== null
            ? numberOrZero(load.target_moisture_pct)
            : null,
        dwellHours: metrics?.dwell_hours ?? null,
        scrapUnits: metrics ? numberOrZero(metrics.scrap_units) : 0,
        startedAt: load.started_at ?? null,
        completedAt: load.completed_at ?? null,
      };

      const [inputsRes, moistureRes] = await Promise.all([
        supabase
          .from("dry_inputs_v")
          .select("extrusion_run_id, input_units")
          .eq("tenant_id", profile.tenant_id)
          .eq("load_id", selectedLoadId),
        supabase
          .from("dry_events")
          .select("payload, occurred_at")
          .eq("tenant_id", profile.tenant_id)
          .eq("event_type", "DRY_MOISTURE_RECORDED")
          .eq("payload->>loadId", selectedLoadId)
          .order("occurred_at", { ascending: false })
          .limit(5),
      ]);

      if (inputsRes.error && !isViewMissing(inputsRes.error)) {
        throw new Error(inputsRes.error.message);
      }
      if (moistureRes.error && !isViewMissing(moistureRes.error)) {
        throw new Error(moistureRes.error.message);
      }

      selectedInputs = (inputsRes.data ?? []).map((row) => ({
        runId: row.extrusion_run_id,
        runCode: extrusionRunMap.get(row.extrusion_run_id) ?? "Extrusion run",
        quantityUnits: numberOrZero(row.input_units),
      }));

      moistureHistory = (moistureRes.data ?? []).map((event) => {
        const payload = event.payload ?? {};
        const pct = Number(payload.moisturePct ?? payload.moisturepct ?? 0);
        const method =
          (payload.method as string | undefined) ??
          (payload.Method as string | undefined) ??
          null;

        return {
          occurredAt: event.occurred_at ?? null,
          moisturePct: Number.isFinite(pct) ? pct : 0,
          method,
        };
      });
    }
  }

  const kpiData =
    kpiRes.error && !isViewMissing(kpiRes.error) ? null : kpiRes.data ?? null;

  const activeLoads = numberOrZero(kpiData?.active_loads);
  const unitsLoadedToday = numberOrZero(kpiData?.units_loaded_today);
  const unitsCompletedToday = numberOrZero(kpiData?.units_completed_today);
  const avgActiveMoisture =
    kpiData?.avg_active_moisture !== undefined &&
    kpiData?.avg_active_moisture !== null
      ? Number(kpiData.avg_active_moisture)
      : null;

  const rackUtilisation = racks.map((rack) => {
    const utilisation =
      rack.capacityUnits > 0
        ? (rack.occupiedUnits / rack.capacityUnits) * 100
        : 0;
    return {
      ...rack,
      utilisation,
      remaining: rack.capacityUnits - rack.occupiedUnits,
    };
  });

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold text-foreground">
          Dry Yard dashboard
        </h1>
        <p className="text-sm text-muted-foreground">
          Assign green units to racks, monitor dwell times, and track moisture
          before Kiln loading.
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard title="Active loads" value={activeLoads.toString()} helper="Loads currently drying" />
        <KpiCard
          title="Units loaded today"
          value={unitsLoadedToday.toFixed(0)}
          helper="Green units staged on racks"
        />
        <KpiCard
          title="Units completed today"
          value={unitsCompletedToday.toFixed(0)}
          helper="Loads moved onward from Dry Yard"
        />
        <KpiCard
          title="Avg moisture (active)"
          value={
            avgActiveMoisture !== null
              ? `${avgActiveMoisture.toFixed(1)}%`
              : "No readings"
          }
          helper="Latest readings across active loads"
        />
      </section>

      <section className="grid gap-6 lg:grid-cols-[minmax(0,320px)_1fr]">
        <div className="space-y-6">
          <Card className="border-border/70">
            <CardHeader className="space-y-1">
              <CardTitle>Planned & Active loads</CardTitle>
              <CardDescription>
                Select a load to review dwell time, inputs, and actions.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <LoadsTable loads={loadRows} />
            </CardContent>
          </Card>

          <Card className="border-border/70">
            <CardHeader className="space-y-1">
              <CardTitle>Rack occupancy</CardTitle>
              <CardDescription>
                Capacity and utilisation across drying racks.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {rackUtilisation.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border/60 p-6 text-sm text-muted-foreground">
                  Create at least one rack to start tracking capacity.
                </div>
              ) : (
                <ul className="grid gap-3">
                  {rackUtilisation.map((rack) => {
                    const utilizationLabel = `${Math.min(Math.max(rack.utilisation, 0), 100).toFixed(0)}%`;
                    const remaining = Math.max(rack.remaining, 0);
                    const statusColor =
                      rack.utilisation >= 90
                        ? "text-red-500"
                        : rack.utilisation >= 70
                          ? "text-amber-500"
                          : "text-emerald-500";
                    return (
                      <li
                        key={rack.id}
                        className="flex flex-col rounded-lg border border-border/60 p-3 text-sm"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-foreground">
                            {rack.code}
                          </span>
                          <span className={statusColor}>{utilizationLabel}</span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {rack.bay ? `Bay ${rack.bay} • ` : ""}
                          {rack.occupiedUnits.toFixed(0)} /
                          {rack.capacityUnits.toFixed(0)} units occupied •{" "}
                          {remaining.toFixed(0)} free
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="border-border/70">
          <CardHeader className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>
                  {selectedLoadSummary
                    ? `Load ${selectedLoadSummary.code}`
                    : "Select a load"}
                </CardTitle>
                <CardDescription>
                  {selectedLoadSummary
                    ? `Status: ${selectedLoadSummary.status}`
                    : "Choose a load to inspect metrics and actions."}
                </CardDescription>
              </div>
              <DryActions
                racks={racks}
                extrusionOptions={extrusionOptions}
                selectedLoad={
                  selectedLoadSummary
                    ? {
                        id: selectedLoadSummary.id,
                        code: selectedLoadSummary.code,
                        status: selectedLoadSummary.status,
                        rackId: selectedLoadSummary.rackId,
                        inputUnits: selectedLoadSummary.inputUnits,
                        latestMoisturePct:
                          selectedLoadSummary.latestMoisturePct,
                      }
                    : null
                }
              />
            </div>
            {selectedLoadSummary ? (
              <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                <span>
                  Rack:{" "}
                  {selectedLoadSummary.rackId
                    ? rackCodeMap.get(selectedLoadSummary.rackId) ?? "—"
                    : "Unassigned"}
                </span>
                <span>
                  Units: {selectedLoadSummary.inputUnits.toFixed(0)}
                </span>
                <span>
                  Target moisture:{" "}
                  {selectedLoadSummary.targetMoisturePct !== null
                    ? `${selectedLoadSummary.targetMoisturePct.toFixed(1)}%`
                    : "—"}
                </span>
                <span>
                  Latest moisture:{" "}
                  {selectedLoadSummary.latestMoisturePct !== null
                    ? `${selectedLoadSummary.latestMoisturePct.toFixed(1)}%`
                    : "No readings"}
                </span>
                <span>
                  Scrap: {selectedLoadSummary.scrapUnits.toFixed(0)} units
                </span>
                <span>
                  Dwell:{" "}
                  {selectedLoadSummary.dwellHours !== null
                    ? `${selectedLoadSummary.dwellHours.toFixed(1)} h`
                    : "—"}
                </span>
              </div>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-6">
            {selectedLoadSummary ? (
              <>
                <section className="space-y-3">
                  <h3 className="text-sm font-semibold text-foreground">
                    Inputs by extrusion run
                  </h3>
                  {selectedInputs.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border/60 p-6 text-sm text-muted-foreground">
                      No inputs logged yet.
                    </div>
                  ) : (
                    <ul className="grid gap-2 text-sm text-muted-foreground">
                      {selectedInputs.map((input) => (
                        <li
                          key={input.runId}
                          className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2"
                        >
                          <span className="font-medium text-foreground">
                            {input.runCode}
                          </span>
                          <span className="font-mono text-xs">
                            {input.quantityUnits.toFixed(0)} units
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
                <section className="space-y-3">
                  <h3 className="text-sm font-semibold text-foreground">
                    Recent moisture readings
                  </h3>
                  {moistureHistory.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border/60 p-6 text-sm text-muted-foreground">
                      No moisture readings recorded.
                    </div>
                  ) : (
                    <ul className="grid gap-2 text-sm text-muted-foreground">
                      {moistureHistory.map((reading, index) => (
                        <li
                          key={`${reading.occurredAt}-${index}`}
                          className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2"
                        >
                          <span>
                            {reading.occurredAt
                              ? new Date(reading.occurredAt).toLocaleString()
                              : "Unknown time"}
                          </span>
                          <span className="font-mono text-xs text-foreground">
                            {reading.moisturePct.toFixed(1)}%
                            {reading.method ? ` (${reading.method})` : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </>
            ) : (
              <div className="rounded-lg border border-dashed border-border/60 p-6 text-sm text-muted-foreground">
                Select a load from the left to review details and actions.
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function KpiCard({
  title,
  value,
  helper,
}: {
  title: string;
  value: string;
  helper: string;
}) {
  return (
    <Card className="border-border/70">
      <CardHeader className="space-y-1">
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-2xl text-foreground">{value}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{helper}</p>
      </CardContent>
    </Card>
  );
}
