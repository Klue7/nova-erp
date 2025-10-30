import { redirect } from "next/navigation";

import { ExtrusionActions } from "./components/extrusion-actions";
import { RunTable, type RunRow } from "./components/run-table";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { guardRoute } from "@/lib/rbac";
import { createServerSupabaseClient } from "@/utils/supabase/server";

const ALLOWED_ROLES = ["extrusion_operator", "admin"];
const VIEW_MISSING_CODE = "42P01";

type ExtrusionPageProps = {
  searchParams: Record<string, string | string[] | undefined>;
};

type InputAggregate = {
  crushRunId: string;
  crushRunCode: string;
  quantityTonnes: number;
  reference: string | null;
  occurredAt: string | null;
};

type CrushRunOption = {
  id: string;
  code: string;
  availableTonnes: number;
};

type RunDetail = {
  id: string;
  code: string;
  status: string;
  pressLine: string | null;
  dieCode: string | null;
  startedAt: string | null;
  completedAt: string | null;
  inputTonnes: number;
  outputUnits: number;
  scrapUnits: number;
  downtimeMinutes: number;
  uphNet: number | null;
  inputs: InputAggregate[];
};

type CompletedSummary = {
  runCode: string;
  completedAt: string | null;
  outputUnits: number | null;
  scrapUnits: number | null;
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

export default async function ExtrusionPage({
  searchParams,
}: ExtrusionPageProps) {
  const { profile } = await guardRoute();

  if (!profile) {
    return null;
  }

  if (!ALLOWED_ROLES.includes(profile.role)) {
    redirect("/dashboard?toast=access-denied");
  }

  const supabase = await createServerSupabaseClient();

  const runsQuery = supabase
    .from("extrusion_runs")
    .select(
      "id, code, status, press_line, die_code, product_sku, target_units, started_at, completed_at, created_at",
    )
    .eq("tenant_id", profile.tenant_id)
    .order("created_at", { ascending: false });

  const metricsQuery = supabase
    .from("extrusion_run_metrics_v")
    .select(
      "run_id, input_tonnes, output_units, scrap_units, downtime_minutes, uph_net",
    )
    .eq("tenant_id", profile.tenant_id);

  const kpiQuery = supabase
    .from("extrusion_kpi_today")
    .select("active_runs, units_today, scrap_today")
    .eq("tenant_id", profile.tenant_id)
    .maybeSingle();

  const completedQuery = supabase
    .from("extrusion_events")
    .select("payload, occurred_at")
    .eq("tenant_id", profile.tenant_id)
    .eq("event_type", "EXTRUSION_RUN_COMPLETED")
    .order("occurred_at", { ascending: false })
    .limit(5);

  const crushAvailabilityQuery = supabase
    .from("crush_available_for_extrusion_v")
    .select("crush_run_id, available_tonnes")
    .eq("tenant_id", profile.tenant_id)
    .gt("available_tonnes", 0);

  const crushRunsQuery = supabase
    .from("crush_runs")
    .select("id, code, completed_at")
    .eq("tenant_id", profile.tenant_id);

  const [
    runsRes,
    metricsRes,
    kpiRes,
    completedRes,
    crushAvailabilityRes,
    crushRunsRes,
  ] = await Promise.all([
    runsQuery,
    metricsQuery,
    kpiQuery,
    completedQuery,
    crushAvailabilityQuery,
    crushRunsQuery,
  ]);

  if (runsRes.error) throw new Error(runsRes.error.message);
  if (metricsRes.error && !isViewMissing(metricsRes.error)) {
    throw new Error(metricsRes.error.message);
  }
  if (crushAvailabilityRes.error && !isViewMissing(crushAvailabilityRes.error)) {
    throw new Error(crushAvailabilityRes.error.message);
  }
  if (crushRunsRes.error) throw new Error(crushRunsRes.error.message);
  if (completedRes.error && !isViewMissing(completedRes.error)) {
    throw new Error(completedRes.error.message);
  }

  const runs = runsRes.data ?? [];
  const metricRows = (metricsRes.data ?? []) as NonNullable<
    typeof metricsRes.data
  >;
  type MetricsRow = typeof metricRows[number];
  const metricsMap = new Map<string, MetricsRow>();
  metricRows.forEach((row) => metricsMap.set(row.run_id, row));

  const searchSelected = Array.isArray(searchParams.run)
    ? searchParams.run[0]
    : searchParams.run;

  const runTableRows: RunRow[] = runs
    .filter((run) =>
      ["planned", "active", "paused"].includes(run.status ?? ""),
    )
    .map((run) => {
      const metrics = metricsMap.get(run.id);
      return {
        id: run.id,
        code: run.code,
        status: run.status,
        pressLine: run.press_line ?? null,
        dieCode: run.die_code ?? null,
        outputUnits: metrics ? numberOrZero(metrics.output_units) : 0,
        uphNet: metrics?.uph_net ?? null,
      };
    });

  const selectedRunId = (() => {
    if (searchSelected && runs.some((run) => run.id === searchSelected)) {
      return searchSelected;
    }
    if (runTableRows.length > 0) {
      return runTableRows[0].id;
    }
    return runs[0]?.id ?? null;
  })();

  let inputs: InputAggregate[] = [];
  if (selectedRunId) {
    const inputEventsRes = await supabase
      .from("extrusion_events")
      .select("payload, occurred_at")
      .eq("tenant_id", profile.tenant_id)
      .eq("event_type", "EXTRUSION_INPUT_ADDED")
      .eq("payload->>runId", selectedRunId);

    if (inputEventsRes.error && !isViewMissing(inputEventsRes.error)) {
      throw new Error(inputEventsRes.error.message);
    }

    const aggregate = new Map<string, InputAggregate>();
    (inputEventsRes.data ?? []).forEach((event) => {
      const payload = event.payload ?? {};
      const crushRunId =
        (payload.crushRunId as string | undefined) ??
        (payload.crushrunid as string | undefined);
      if (!crushRunId) return;
      const code =
        (payload.crushRunCode as string | undefined) ??
        (payload.crushruncode as string | undefined) ??
        "Unknown run";
      const quantity = numberOrZero(
        payload.quantityTonnes ?? payload.quantitytonnes,
      );
      const reference =
        ((payload.reference ?? null) as string | null) ?? null;
      const current = aggregate.get(crushRunId) ?? {
        crushRunId,
        crushRunCode: code,
        quantityTonnes: 0,
        reference,
        occurredAt: event.occurred_at ?? null,
      };
      current.quantityTonnes += quantity;
      current.reference = reference ?? current.reference;
      current.occurredAt = event.occurred_at ?? current.occurredAt;
      aggregate.set(crushRunId, current);
    });
    inputs = Array.from(aggregate.values()).filter(
      (item) => item.quantityTonnes !== 0,
    );
  }

  const selectedRunDetail: RunDetail | null = (() => {
    if (!selectedRunId) return null;
    const run = runs.find((item) => item.id === selectedRunId);
    if (!run) return null;
    const metrics = metricsMap.get(selectedRunId);
    return {
      id: run.id,
      code: run.code,
      status: run.status,
      pressLine: run.press_line ?? null,
      dieCode: run.die_code ?? null,
      startedAt: run.started_at ?? null,
      completedAt: run.completed_at ?? null,
      inputTonnes: metrics ? numberOrZero(metrics.input_tonnes) : 0,
      outputUnits: metrics ? numberOrZero(metrics.output_units) : 0,
      scrapUnits: metrics ? numberOrZero(metrics.scrap_units) : 0,
      downtimeMinutes: metrics ? numberOrZero(metrics.downtime_minutes) : 0,
      uphNet: metrics?.uph_net ?? null,
      inputs,
    };
  })();

  const availabilityMap = new Map<string, number>();
  (crushAvailabilityRes.data ?? []).forEach((row) => {
    availabilityMap.set(
      row.crush_run_id,
      Number(row.available_tonnes ?? 0),
    );
  });

  const crushOptions: CrushRunOption[] = (crushRunsRes.data ?? [])
    .map((run) => ({
      id: run.id,
      code: run.code,
      availableTonnes: availabilityMap.get(run.id) ?? 0,
    }))
    .filter((option) => option.availableTonnes > 0)
    .sort((a, b) => b.availableTonnes - a.availableTonnes);

  const kpiData =
    kpiRes.error && !isViewMissing(kpiRes.error) ? null : kpiRes.data ?? null;
  const activeRuns = numberOrZero(kpiData?.active_runs);
  const unitsToday = numberOrZero(kpiData?.units_today);
  const scrapToday = numberOrZero(kpiData?.scrap_today);
  const totalUnitsToday = unitsToday + scrapToday;
  const scrapPercentToday =
    totalUnitsToday > 0 ? (scrapToday / totalUnitsToday) * 100 : null;

  const activeMetrics = runs
    .filter((run) => run.status === "active")
    .map((run) => metricsMap.get(run.id))
    .filter(
      (row): row is MetricsRow =>
        row?.uph_net !== null && row?.uph_net !== undefined,
    );

  const avgNetUph = activeMetrics.length
    ? activeMetrics.reduce(
        (sum, row) => sum + Number(row.uph_net ?? 0),
        0,
      ) / activeMetrics.length
    : null;

  const completedSummaries: CompletedSummary[] = (completedRes.data ?? []).map(
    (event) => {
      const payload = event.payload ?? {};
      return {
        runCode:
          (payload.runCode as string | undefined) ??
          (payload.runcode as string | undefined) ??
          "Extrusion run",
        completedAt: event.occurred_at ?? null,
        outputUnits:
          payload.outputUnits !== undefined
            ? numberOrZero(payload.outputUnits)
            : null,
        scrapUnits:
          payload.scrapUnits !== undefined
            ? numberOrZero(payload.scrapUnits)
            : null,
      };
    },
  );

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold text-foreground">
          Extrusion dashboard
        </h1>
        <p className="text-sm text-muted-foreground">
          Monitor extrusion runs, die changes, outputs, and scrap performance.
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title="Active runs"
          value={activeRuns.toString()}
          helper="Currently running or paused"
        />
        <KpiCard
          title="Units today"
          value={unitsToday.toFixed(0)}
          helper="Output units recorded today"
        />
        <KpiCard
          title="Scrap today"
          value={
            scrapPercentToday !== null
              ? `${scrapToday.toFixed(0)} (${scrapPercentToday.toFixed(1)}%)`
              : `${scrapToday.toFixed(0)}`
          }
          helper="Units scrapped today"
        />
        <KpiCard
          title="Avg net UPH"
          value={
            avgNetUph !== null
              ? `${avgNetUph.toFixed(2)}`
              : "No active runs"
          }
          helper="Across active runs"
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,320px)_1fr]">
        <div className="space-y-6">
          <Card className="border-border/70">
            <CardHeader className="space-y-1">
              <CardTitle>Planned & Active runs</CardTitle>
              <CardDescription>
                Select a run to review inputs and actions.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <RunTable runs={runTableRows} />
            </CardContent>
          </Card>

          <Card className="border-border/70">
            <CardHeader className="space-y-1">
              <CardTitle>Recent completions</CardTitle>
              <CardDescription>
                Latest extrusion runs and their outputs.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {completedSummaries.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border/60 p-6 text-sm text-muted-foreground">
                  Completed runs will appear here once recorded.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Run</TableHead>
                      <TableHead>Completed</TableHead>
                      <TableHead className="text-right">
                        Output (units)
                      </TableHead>
                      <TableHead className="text-right">
                        Scrap (units)
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {completedSummaries.map((summary, index) => (
                      <TableRow key={`${summary.runCode}-${index}`}>
                        <TableCell className="font-medium text-foreground">
                          {summary.runCode}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {summary.completedAt
                            ? new Date(summary.completedAt).toLocaleString()
                            : "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs text-muted-foreground">
                          {summary.outputUnits !== null
                            ? summary.outputUnits.toFixed(0)
                            : "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs text-muted-foreground">
                          {summary.scrapUnits !== null
                            ? summary.scrapUnits.toFixed(0)
                            : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="border-border/70">
          <CardHeader className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>
                  {selectedRunDetail
                    ? `Run ${selectedRunDetail.code}`
                    : "Select a run"}
                </CardTitle>
                <CardDescription>
                  {selectedRunDetail
                    ? `Status: ${selectedRunDetail.status}`
                    : "Choose a run to inspect inputs, outputs, and actions."}
                </CardDescription>
              </div>
              <ExtrusionActions
                crushRuns={crushOptions}
                selectedRun={
                  selectedRunDetail
                    ? {
                        id: selectedRunDetail.id,
                        code: selectedRunDetail.code,
                        status: selectedRunDetail.status,
                        dieCode: selectedRunDetail.dieCode,
                      }
                    : null
                }
              />
            </div>
            {selectedRunDetail ? (
              <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                <span>
                  Press line: {selectedRunDetail.pressLine ?? "—"}
                </span>
                <span>Die: {selectedRunDetail.dieCode ?? "—"}</span>
                <span>
                  Input: {selectedRunDetail.inputTonnes.toFixed(2)} t
                </span>
                <span>
                  Output: {selectedRunDetail.outputUnits.toFixed(0)} units
                </span>
                <span>
                  Scrap: {selectedRunDetail.scrapUnits.toFixed(0)} units
                </span>
                <span>
                  Net UPH:{" "}
                  {selectedRunDetail.uphNet !== null
                    ? selectedRunDetail.uphNet.toFixed(2)
                    : "—"}
                </span>
                <span>
                  Downtime: {selectedRunDetail.downtimeMinutes.toFixed(0)} min
                </span>
              </div>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-6">
            {selectedRunDetail ? (
              <>
                <section className="space-y-3">
                  <h3 className="text-sm font-semibold text-foreground">
                    Inputs
                  </h3>
                  <InputsTable inputs={selectedRunDetail.inputs} />
                </section>
                <section className="space-y-3">
                  <h3 className="text-sm font-semibold text-foreground">
                    Outputs & Scrap
                  </h3>
                  <OutputSummary
                    outputUnits={selectedRunDetail.outputUnits}
                    scrapUnits={selectedRunDetail.scrapUnits}
                    netUph={selectedRunDetail.uphNet}
                  />
                </section>
              </>
            ) : (
              <div className="rounded-lg border border-dashed border-border/60 p-6 text-sm text-muted-foreground">
                Select a run from the left to see activity and perform actions.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
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

function InputsTable({ inputs }: { inputs: InputAggregate[] }) {
  if (inputs.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border/60 p-6 text-sm text-muted-foreground">
        No crushed feed logged yet.
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Crushing run</TableHead>
          <TableHead className="text-right">Quantity (t)</TableHead>
          <TableHead>Reference</TableHead>
          <TableHead>Last input</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {inputs.map((input) => (
          <TableRow key={input.crushRunId}>
            <TableCell className="font-medium text-foreground">
              {input.crushRunCode}
            </TableCell>
            <TableCell className="text-right font-mono text-xs text-muted-foreground">
              {input.quantityTonnes.toFixed(2)}
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {input.reference ?? "—"}
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {input.occurredAt
                ? new Date(input.occurredAt).toLocaleString()
                : "—"}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function OutputSummary({
  outputUnits,
  scrapUnits,
  netUph,
}: {
  outputUnits: number;
  scrapUnits: number;
  netUph: number | null;
}) {
  const totalUnits = outputUnits + scrapUnits;
  const scrapPercent =
    totalUnits > 0 ? ((scrapUnits / totalUnits) * 100).toFixed(1) : null;

  return (
    <div className="rounded-lg border border-border/60 p-4 text-sm text-muted-foreground">
      <div className="flex flex-wrap gap-4">
        <span>Total output: {outputUnits.toFixed(0)} units</span>
        <span>Scrap: {scrapUnits.toFixed(0)} units</span>
        <span>
          Scrap %: {scrapPercent !== null ? `${scrapPercent}%` : "—"}
        </span>
        <span>
          Net UPH: {netUph !== null ? netUph.toFixed(2) : "No net rate"}
        </span>
      </div>
    </div>
  );
}
