import { redirect } from "next/navigation";

import { BatchTable, type BatchRow } from "./components/batch-table";
import { KilnActions } from "./components/kiln-actions";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { guardRoute } from "@/lib/rbac";
import { listAvailableForKiln } from "@/lib/upstream";
import { createServerSupabaseClient } from "@/utils/supabase/server";

const ALLOWED_ROLES = ["kiln_operator", "admin"];
const VIEW_MISSING_CODE = "42P01";

type KilnSearchParams = Record<string, string | string[] | undefined>;

type KilnPageProps = {
  searchParams: Promise<KilnSearchParams>;
};

type DryLoadOption = {
  id: string;
  code: string;
  availableUnits: number;
};

type ZoneTemperature = {
  zone: string;
  temperatureC: number;
  occurredAt: string | null;
};

type FuelSummary = {
  fuelType: string;
  amount: number;
  unit: string;
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

export default async function KilnPage({ searchParams }: KilnPageProps) {
  const { profile } = await guardRoute();

  if (!profile) {
    return null;
  }

  if (!ALLOWED_ROLES.includes(profile.role)) {
    redirect("/dashboard?toast=access-denied");
  }

  const supabase = await createServerSupabaseClient();

  const batchesQuery = supabase
    .from("kiln_batches")
    .select(
      "id, code, status, kiln_code, firing_curve_code, target_units, started_at, completed_at, created_at",
    )
    .eq("tenant_id", profile.tenant_id)
    .order("created_at", { ascending: false });

  const metricsQuery = supabase
    .from("kiln_batch_metrics_v")
    .select(
      "batch_id, input_units, fired_units, downtime_minutes, yield_pct, run_time_hours_gross, run_time_hours_net",
    )
    .eq("tenant_id", profile.tenant_id);

  const kpiQuery = supabase
    .from("kiln_kpi_today")
    .select("active_batches, units_fired_today, fuel_amount_today")
    .eq("tenant_id", profile.tenant_id)
    .maybeSingle();

  const [
    batchesRes,
    metricsRes,
    kpiRes,
  ] = await Promise.all([
    batchesQuery,
    metricsQuery,
    kpiQuery,
  ]);

  if (batchesRes.error) throw new Error(batchesRes.error.message);
  if (metricsRes.error && !isViewMissing(metricsRes.error)) {
    throw new Error(metricsRes.error.message);
  }
  const batches = batchesRes.data ?? [];
  const metricRows = (metricsRes.data ?? []) as NonNullable<
    typeof metricsRes.data
  >;
  type MetricsRow = typeof metricRows[number];
  const metricsMap = new Map<string, MetricsRow>();
  metricRows.forEach((row) => metricsMap.set(row.batch_id, row));

  const batchRows: BatchRow[] = batches
    .filter((batch) =>
      ["planned", "active", "paused"].includes(batch.status ?? ""),
    )
    .map((batch) => {
      const metrics = metricsMap.get(batch.id);
      return {
        id: batch.id,
        code: batch.code,
        status: batch.status,
        kilnCode: batch.kiln_code ?? null,
        targetUnits:
          batch.target_units !== null
            ? numberOrZero(batch.target_units)
            : null,
        firedUnits: metrics ? numberOrZero(metrics.fired_units) : 0,
        yieldPct: metrics?.yield_pct ?? null,
        startedAt: batch.started_at ?? null,
      };
    });

  const params = await searchParams;

  const searchSelected = Array.isArray(params.batch)
    ? params.batch[0]
    : params.batch;

  const selectedBatchId = (() => {
    if (searchSelected && batches.some((batch) => batch.id === searchSelected)) {
      return searchSelected;
    }
    if (batchRows.length > 0) {
      return batchRows[0].id;
    }
    return batches[0]?.id ?? null;
  })();

  const dryOptions: DryLoadOption[] = (await listAvailableForKiln())
    .map((option) => ({
      id: option.id,
      code: option.code,
      availableUnits: option.availableUnits,
    }))
    .sort((a, b) => b.availableUnits - a.availableUnits);
  const dryLoadCodeMap = new Map(
    dryOptions.map((option) => [option.id, option.code]),
  );

  const kpiData =
    kpiRes.error && !isViewMissing(kpiRes.error) ? null : kpiRes.data ?? null;

  const activeBatches = numberOrZero(kpiData?.active_batches);
  const unitsFiredToday = numberOrZero(kpiData?.units_fired_today);
  const fuelAmountToday = numberOrZero(kpiData?.fuel_amount_today);

  const yieldSamples = metricRows.filter((row) =>
    Number.isFinite(row.yield_pct ?? null),
  );
  const averageYield =
    yieldSamples.length > 0
      ? yieldSamples.reduce(
          (sum, row) => sum + Number(row.yield_pct ?? 0),
          0,
        ) / yieldSamples.length
      : null;

  let selectedBatchDetail:
    | {
        id: string;
        code: string;
        status: string;
        kilnCode: string | null;
        firingCurveCode: string | null;
        targetUnits: number | null;
        startedAt: string | null;
        completedAt: string | null;
        inputUnits: number;
        firedUnits: number;
        yieldPct: number | null;
        downtimeMinutes: number;
        runTimeHoursNet: number | null;
        runTimeHoursGross: number | null;
      }
    | null = null;

  let inputDetails: Array<{
    dryLoadId: string;
    dryLoadCode: string;
    quantityUnits: number;
  }> = [];

  let zoneTemps: ZoneTemperature[] = [];
  let fuelUsage: FuelSummary[] = [];

  let outputSummary: {
    firedUnits: number;
    avgShrinkage: number | null;
  } | null = null;

  if (selectedBatchId) {
    const batch = batches.find((item) => item.id === selectedBatchId) ?? null;
    const metrics = metricsMap.get(selectedBatchId) ?? null;

    if (batch) {
      selectedBatchDetail = {
        id: batch.id,
        code: batch.code,
        status: batch.status,
        kilnCode: batch.kiln_code ?? null,
        firingCurveCode: batch.firing_curve_code ?? null,
        targetUnits:
          batch.target_units !== null
            ? numberOrZero(batch.target_units)
            : null,
        startedAt: batch.started_at ?? null,
        completedAt: batch.completed_at ?? null,
        inputUnits: metrics ? numberOrZero(metrics.input_units) : 0,
        firedUnits: metrics ? numberOrZero(metrics.fired_units) : 0,
        yieldPct: metrics?.yield_pct ?? null,
        downtimeMinutes: metrics ? numberOrZero(metrics.downtime_minutes) : 0,
        runTimeHoursNet: metrics?.run_time_hours_net ?? null,
        runTimeHoursGross: metrics?.run_time_hours_gross ?? null,
      };

      const [
        inputsRes,
        tempsRes,
        fuelRes,
        outputsRes,
      ] = await Promise.all([
        supabase
          .from("kiln_events")
          .select("payload")
          .eq("tenant_id", profile.tenant_id)
          .eq("event_type", "KILN_INPUT_ADDED")
          .eq("payload->>batchId", batch.id),
        supabase
          .from("kiln_zone_temps_latest")
          .select("zone, temperature_c, occurred_at")
          .eq("tenant_id", profile.tenant_id)
          .eq("batch_id", batch.id),
        supabase
          .from("kiln_fuel_v")
          .select("fuel_type, amount, unit")
          .eq("tenant_id", profile.tenant_id)
          .eq("batch_id", batch.id),
        supabase
          .from("kiln_outputs_v")
          .select("fired_units, avg_shrinkage_pct")
          .eq("tenant_id", profile.tenant_id)
          .eq("batch_id", batch.id)
          .maybeSingle(),
      ]);

      if (inputsRes.error && !isViewMissing(inputsRes.error)) {
        throw new Error(inputsRes.error.message);
      }
      if (tempsRes.error && !isViewMissing(tempsRes.error)) {
        throw new Error(tempsRes.error.message);
      }
      if (fuelRes.error && !isViewMissing(fuelRes.error)) {
        throw new Error(fuelRes.error.message);
      }

      const inputMap = new Map<string, { dryLoadId: string; quantity: number }>();
      (inputsRes.data ?? []).forEach((event, index) => {
        const payload = event.payload ?? {};
        const dryLoadId =
          (payload.dryLoadId as string | undefined) ??
          (payload.dryloadid as string | undefined) ??
          `unknown-${index}`;
        const quantity = numberOrZero(
          payload.quantityUnits ?? payload.quantityunits,
        );
        const existing = inputMap.get(dryLoadId) ?? {
          dryLoadId,
          quantity: 0,
        };
        existing.quantity += quantity;
        inputMap.set(dryLoadId, existing);
      });

      inputDetails = Array.from(inputMap.values()).map((entry) => ({
        dryLoadId: entry.dryLoadId,
        dryLoadCode: dryLoadCodeMap.get(entry.dryLoadId) ?? "Dry load",
        quantityUnits: entry.quantity,
      }));

      zoneTemps = (tempsRes.data ?? []).map((row) => ({
        zone: row.zone ?? "Zone",
        temperatureC: numberOrZero(row.temperature_c),
        occurredAt: row.occurred_at ?? null,
      }));

      fuelUsage = (fuelRes.data ?? []).map((row) => ({
        fuelType: row.fuel_type ?? "Fuel",
        amount: numberOrZero(row.amount),
        unit: row.unit ?? "",
      }));

      if (outputsRes.error && !isViewMissing(outputsRes.error)) {
        throw new Error(outputsRes.error.message);
      }

      if (outputsRes.data) {
        outputSummary = {
          firedUnits: numberOrZero(outputsRes.data.fired_units),
          avgShrinkage:
            outputsRes.data.avg_shrinkage_pct !== null
              ? numberOrZero(outputsRes.data.avg_shrinkage_pct)
              : null,
        };
      }
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold text-foreground">
          Kiln dashboard
        </h1>
        <p className="text-sm text-muted-foreground">
          Monitor firing progress, fuel usage, and quality metrics for kiln
          batches.
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title="Active/paused batches"
          value={activeBatches.toString()}
          helper="Currently firing or paused"
        />
        <KpiCard
          title="Units fired today"
          value={unitsFiredToday.toFixed(0)}
          helper="Fired units recorded in the last 24h"
        />
        <KpiCard
          title="Fuel usage today"
          value={fuelAmountToday.toFixed(1)}
          helper="Total fuel logged today"
        />
        <KpiCard
          title="Average yield"
          value={
            averageYield !== null
              ? `${averageYield.toFixed(1)}%`
              : "No yield data"
          }
          helper="Across batches with input/output data"
        />
      </section>

      <section className="grid gap-6 lg:grid-cols-[minmax(0,320px)_1fr]">
        <Card className="border-border/70">
          <CardHeader className="space-y-1">
            <CardTitle>Planned & Active batches</CardTitle>
            <CardDescription>
              Select a batch to review inputs and firing details.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <BatchTable batches={batchRows} />
          </CardContent>
        </Card>

        <Card className="border-border/70">
          <CardHeader className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>
                  {selectedBatchDetail
                    ? `Batch ${selectedBatchDetail.code}`
                    : "Select a batch"}
                </CardTitle>
                <CardDescription>
                  {selectedBatchDetail
                    ? `Status: ${selectedBatchDetail.status}`
                    : "Choose a batch to inspect inputs, outputs, and actions."}
                </CardDescription>
              </div>
              <KilnActions
                dryLoads={dryOptions}
                selectedBatch={
                  selectedBatchDetail
                    ? {
                        id: selectedBatchDetail.id,
                        code: selectedBatchDetail.code,
                        status: selectedBatchDetail.status,
                      }
                    : null
                }
              />
            </div>
            {selectedBatchDetail ? (
              <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                <span>Kiln: {selectedBatchDetail.kilnCode ?? "—"}</span>
                <span>
                  Target:{" "}
                  {selectedBatchDetail.targetUnits !== null
                    ? `${selectedBatchDetail.targetUnits.toFixed(0)} units`
                    : "—"}
                </span>
                <span>
                  Input: {selectedBatchDetail.inputUnits.toFixed(0)} units
                </span>
                <span>
                  Fired: {selectedBatchDetail.firedUnits.toFixed(0)} units
                </span>
                <span>
                  Yield:{" "}
                  {selectedBatchDetail.yieldPct !== null
                    ? `${selectedBatchDetail.yieldPct.toFixed(1)}%`
                    : "—"}
                </span>
                <span>
                  Downtime: {selectedBatchDetail.downtimeMinutes.toFixed(0)} min
                </span>
                <span>
                  Runtime (net):{" "}
                  {selectedBatchDetail.runTimeHoursNet !== null
                    ? `${selectedBatchDetail.runTimeHoursNet.toFixed(2)} h`
                    : "—"}
                </span>
              </div>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-6">
            {selectedBatchDetail ? (
              <>
                <section className="space-y-3">
                  <h3 className="text-sm font-semibold text-foreground">
                    Inputs from Dry Yard
                  </h3>
                  {inputDetails.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border/60 p-6 text-sm text-muted-foreground">
                      No inputs recorded yet.
                    </div>
                  ) : (
                    <ul className="grid gap-2 text-sm text-muted-foreground">
                      {inputDetails.map((input, index) => (
                        <li
                          key={`${input.dryLoadId}-${index}`}
                          className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2"
                        >
                          <span className="font-medium text-foreground">
                            {input.dryLoadCode}
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
                    Zone temperatures
                  </h3>
                  {zoneTemps.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border/60 p-6 text-sm text-muted-foreground">
                      No zone temperatures recorded.
                    </div>
                  ) : (
                    <ul className="grid gap-2 text-sm text-muted-foreground">
                      {zoneTemps.map((zone, index) => (
                        <li
                          key={`${zone.zone}-${index}`}
                          className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2"
                        >
                          <span className="font-medium text-foreground">
                            {zone.zone}
                          </span>
                          <span className="font-mono text-xs">
                            {zone.temperatureC.toFixed(0)}°C
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
                <section className="space-y-3">
                  <h3 className="text-sm font-semibold text-foreground">
                    Fuel usage
                  </h3>
                  {fuelUsage.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border/60 p-6 text-sm text-muted-foreground">
                      No fuel usage recorded.
                    </div>
                  ) : (
                    <ul className="grid gap-2 text-sm text-muted-foreground">
                      {fuelUsage.map((fuel, index) => (
                        <li
                          key={`${fuel.fuelType}-${index}`}
                          className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2"
                        >
                          <span className="font-medium text-foreground">
                            {fuel.fuelType}
                          </span>
                          <span className="font-mono text-xs">
                            {fuel.amount.toFixed(2)} {fuel.unit}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
                <section className="space-y-3">
                  <h3 className="text-sm font-semibold text-foreground">
                    Output summary
                  </h3>
                  {outputSummary ? (
                    <div className="rounded-lg border border-border/60 p-4 text-sm text-muted-foreground">
                      <div className="flex flex-wrap gap-4">
                        <span>
                          Fired units: {outputSummary.firedUnits.toFixed(0)}
                        </span>
                        <span>
                          Avg shrinkage:{" "}
                          {outputSummary.avgShrinkage !== null
                            ? `${outputSummary.avgShrinkage.toFixed(2)}%`
                            : "—"}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-border/60 p-6 text-sm text-muted-foreground">
                      No output recorded yet.
                    </div>
                  )}
                </section>
              </>
            ) : (
              <div className="rounded-lg border border-dashed border-border/60 p-6 text-sm text-muted-foreground">
                Select a batch from the left to review details and actions.
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
