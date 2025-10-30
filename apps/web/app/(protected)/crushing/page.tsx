import { redirect } from "next/navigation";

import { RunTable, type RunRow } from "./components/run-table";
import { CrushingActions } from "./components/crushing-actions";
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

const ALLOWED_ROLES = ["crushing_operator", "admin"];
const VIEW_MISSING_CODE = "42P01";

type CrushingPageProps = {
  searchParams: Record<string, string | string[] | undefined>;
};

type ComponentAggregate = {
  mixBatchId: string;
  mixBatchCode: string;
  quantityTonnes: number;
  reference: string | null;
  occurredAt: string | null;
};

type MixBatchOption = {
  id: string;
  code: string;
  availableTonnes: number;
  completedAt: string | null;
};

type RunDetail = {
  id: string;
  code: string;
  status: string;
  targetTPH: number | null;
  startedAt: string | null;
  completedAt: string | null;
  inputTonnes: number;
  outputTonnes: number;
  avgFinesPct: number | null;
  downtimeMinutes: number;
  tphNet: number | null;
  components: ComponentAggregate[];
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

export default async function CrushingPage({ searchParams }: CrushingPageProps) {
  const { profile } = await guardRoute();

  if (!profile) {
    return null;
  }

  if (!ALLOWED_ROLES.includes(profile.role)) {
    redirect("/dashboard?toast=access-denied");
  }

  const supabase = await createServerSupabaseClient();

  const runsQuery = supabase
    .from("crush_runs")
    .select(
      "id, code, status, target_tph, started_at, completed_at, created_at",
    )
    .eq("tenant_id", profile.tenant_id)
    .order("created_at", { ascending: false });

  const metricsQuery = supabase
    .from("crush_run_metrics_v")
    .select(
      "run_id, input_tonnes, output_tonnes, downtime_minutes, tph_net, run_time_hours_net",
    )
    .eq("tenant_id", profile.tenant_id);

  const outputsQuery = supabase
    .from("crush_outputs_v")
    .select("run_id, output_tonnes, avg_fines_pct")
    .eq("tenant_id", profile.tenant_id);

  const kpiQuery = supabase
    .from("crush_kpi_today")
    .select("active_runs, output_today, downtime_today_minutes")
    .eq("tenant_id", profile.tenant_id)
    .maybeSingle();

  const mixAvailabilityQuery = supabase
    .from("mix_available_for_crushing_v")
    .select("batch_id, available_tonnes")
    .eq("tenant_id", profile.tenant_id)
    .gt("available_tonnes", 0);

  const mixBatchesQuery = supabase
    .from("mix_batches")
    .select("id, code, completed_at")
    .eq("tenant_id", profile.tenant_id);

  const [
    runsRes,
    metricsRes,
    outputsRes,
    kpiRes,
    mixAvailabilityRes,
    mixBatchesRes,
  ] = await Promise.all([
    runsQuery,
    metricsQuery,
    outputsQuery,
    kpiQuery,
    mixAvailabilityQuery,
    mixBatchesQuery,
  ]);

  if (runsRes.error) throw new Error(runsRes.error.message);
  if (metricsRes.error && !isViewMissing(metricsRes.error)) {
    throw new Error(metricsRes.error.message);
  }
  if (outputsRes.error && !isViewMissing(outputsRes.error)) {
    throw new Error(outputsRes.error.message);
  }
  if (mixAvailabilityRes.error && !isViewMissing(mixAvailabilityRes.error)) {
    throw new Error(mixAvailabilityRes.error.message);
  }
  if (mixBatchesRes.error) throw new Error(mixBatchesRes.error.message);

  const runs = runsRes.data ?? [];
  const metricRows = (metricsRes.data ?? []) as NonNullable<
    typeof metricsRes.data
  >;
  type MetricsRow = typeof metricRows[number];
  const metricsMap = new Map<string, MetricsRow>();
  metricRows.forEach((row) => metricsMap.set(row.run_id, row));

  const outputRows = (outputsRes.data ?? []) as NonNullable<
    typeof outputsRes.data
  >;
  type OutputsRow = typeof outputRows[number];
  const outputsMap = new Map<string, OutputsRow>();
  outputRows.forEach((row) => outputsMap.set(row.run_id, row));

  const searchSelected = Array.isArray(searchParams.run)
    ? searchParams.run[0]
    : searchParams.run;

  const runTableRows: RunRow[] = runs
    .filter((run) => run.status === "planned" || run.status === "active")
    .map((run) => {
      const metrics = metricsMap.get(run.id);
      return {
        id: run.id,
        code: run.code,
        status: run.status,
        inputTonnes: metrics ? Number(metrics.input_tonnes ?? 0) : 0,
        startedAt: run.started_at,
        tphNet: metrics?.tph_net ?? null,
      } satisfies RunRow;
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

  let components: ComponentAggregate[] = [];
  if (selectedRunId) {
    const componentsRes = await supabase
      .from("crushing_events")
      .select("payload, occurred_at")
      .eq("tenant_id", profile.tenant_id)
      .eq("event_type", "CRUSH_COMPONENT_ADDED")
      .eq("payload->>runId", selectedRunId);

    if (componentsRes.error && !isViewMissing(componentsRes.error)) {
      throw new Error(componentsRes.error.message);
    }

    const aggregate = new Map<string, ComponentAggregate>();
    (componentsRes.data ?? []).forEach((event) => {
      const payload = event.payload ?? {};
      const batchId = (payload.mixBatchId ?? payload.mixbatchid) as string | undefined;
      if (!batchId) return;
      const key = batchId;
      const current = aggregate.get(key) ?? {
        mixBatchId: batchId,
        mixBatchCode: (payload.mixBatchCode ?? payload.mixbatchcode ?? "") as string,
        quantityTonnes: 0,
        reference: (payload.reference ?? null) as string | null,
        occurredAt: event.occurred_at ?? null,
      };
      current.quantityTonnes += numberOrZero(payload.quantityTonnes ?? payload.quantitytonnes);
      current.occurredAt = event.occurred_at ?? current.occurredAt;
      aggregate.set(key, current);
    });

    components = Array.from(aggregate.values()).filter(
      (component) => component.quantityTonnes !== 0,
    );
  }

  const outputsSummary = selectedRunId
    ? outputsMap.get(selectedRunId) ?? null
    : null;

  const selectedRunDetail: RunDetail | null = (() => {
    if (!selectedRunId) return null;
    const run = runs.find((item) => item.id === selectedRunId);
    if (!run) return null;
    const metrics = metricsMap.get(selectedRunId);
    return {
      id: run.id,
      code: run.code,
      status: run.status,
      targetTPH: run.target_tph ?? null,
      startedAt: run.started_at,
      completedAt: run.completed_at,
      inputTonnes: metrics ? Number(metrics.input_tonnes ?? 0) : 0,
      outputTonnes: metrics ? Number(metrics.output_tonnes ?? 0) : 0,
      downtimeMinutes: metrics ? Number(metrics.downtime_minutes ?? 0) : 0,
      tphNet: metrics?.tph_net ?? null,
      avgFinesPct: outputsSummary?.avg_fines_pct ?? null,
      components,
    };
  })();

  const mixAvailability = new Map<string, number>();
  (mixAvailabilityRes.data ?? []).forEach((row) => {
    mixAvailability.set(row.batch_id, Number(row.available_tonnes ?? 0));
  });

  const mixBatches: MixBatchOption[] = (mixBatchesRes.data ?? [])
    .map((batch) => ({
      id: batch.id,
      code: batch.code,
      completedAt: batch.completed_at ?? null,
      availableTonnes: mixAvailability.get(batch.id) ?? 0,
    }))
    .filter((item) => item.availableTonnes > 0)
    .sort((a, b) => b.availableTonnes - a.availableTonnes);

  const kpiData = kpiRes.error && !isViewMissing(kpiRes.error) ? null : kpiRes.data ?? null;
  const activeRuns = kpiData?.active_runs ?? 0;
  const outputToday = kpiData?.output_today ?? 0;
  const downtimeToday = kpiData?.downtime_today_minutes ?? 0;

  const activeMetrics = runs
    .filter((run) => run.status === "active")
    .map((run) => metricsMap.get(run.id))
    .filter((row): row is MetricsRow => Boolean(row));
  const avgNetTph = activeMetrics.length
    ? activeMetrics.reduce((sum, row) => sum + Number(row.tph_net ?? 0), 0) /
      activeMetrics.length
    : null;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold text-foreground">Crushing dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Track crushing runs, inputs from mixing, downtime, and output quality.
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title="Active runs"
          value={activeRuns.toString()}
          helper="Runs currently in progress"
        />
        <KpiCard
          title="Output today"
          value={`${outputToday.toFixed(2)} t`}
          helper="Tonnes recorded today"
        />
        <KpiCard
          title="Downtime today"
          value={`${downtimeToday.toFixed(0)} min`}
          helper="Logged downtime"
        />
        <KpiCard
          title="Avg net TPH"
          value={avgNetTph !== null ? `${avgNetTph.toFixed(2)}` : "No active runs"}
          helper="Across active runs"
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,320px)_1fr]">
        <Card className="border-border/70">
          <CardHeader className="space-y-1">
            <CardTitle>Planned & Active runs</CardTitle>
            <CardDescription>Select a run to view its details.</CardDescription>
          </CardHeader>
          <CardContent>
            <RunTable runs={runTableRows} />
          </CardContent>
        </Card>

        <Card className="border-border/70">
          <CardHeader className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>
                  {selectedRunDetail ? `Run ${selectedRunDetail.code}` : "Select a run"}
                </CardTitle>
                <CardDescription>
                  {selectedRunDetail
                    ? `Status: ${selectedRunDetail.status}`
                    : "Choose a run to inspect inputs and outputs."}
                </CardDescription>
              </div>
              <CrushingActions
                mixBatches={mixBatches}
                selectedRun={
                  selectedRunDetail
                    ? {
                        id: selectedRunDetail.id,
                        code: selectedRunDetail.code,
                        status: selectedRunDetail.status,
                      }
                    : null
                }
              />
            </div>
            {selectedRunDetail ? (
              <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                <span>Input: {selectedRunDetail.inputTonnes.toFixed(2)} t</span>
                <span>Output: {selectedRunDetail.outputTonnes.toFixed(2)} t</span>
                <span>Net TPH: {selectedRunDetail.tphNet?.toFixed(2) ?? "—"}</span>
                <span>Downtime: {selectedRunDetail.downtimeMinutes.toFixed(0)} min</span>
                {selectedRunDetail.avgFinesPct !== null ? (
                  <span>Avg fines: {selectedRunDetail.avgFinesPct.toFixed(2)} %</span>
                ) : null}
              </div>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-6">
            {selectedRunDetail ? (
              <>
                <section className="space-y-3">
                  <h3 className="text-sm font-semibold text-foreground">Components</h3>
                  <ComponentsTable components={selectedRunDetail.components} />
                </section>
                <section className="space-y-3">
                  <h3 className="text-sm font-semibold text-foreground">Outputs</h3>
                  <OutputSummary
                    outputTonnes={selectedRunDetail.outputTonnes}
                    avgFinesPct={selectedRunDetail.avgFinesPct}
                  />
                </section>
              </>
            ) : (
              <div className="rounded-lg border border-dashed border-border/60 p-6 text-sm text-muted-foreground">
                Select a run from the left to see activity and actions.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function KpiCard({ title, value, helper }: { title: string; value: string; helper: string }) {
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

function ComponentsTable({ components }: { components: ComponentAggregate[] }) {
  if (components.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border/60 p-6 text-sm text-muted-foreground">
        No inputs recorded yet.
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Mix batch</TableHead>
          <TableHead>Quantity (t)</TableHead>
          <TableHead>Reference</TableHead>
          <TableHead>Last input</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {components.map((component) => (
          <TableRow key={component.mixBatchId}>
            <TableCell className="font-medium text-foreground">
              {component.mixBatchCode}
            </TableCell>
            <TableCell className="font-mono text-xs text-muted-foreground">
              {component.quantityTonnes.toFixed(2)}
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {component.reference ?? "—"}
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {component.occurredAt ? new Date(component.occurredAt).toLocaleString() : "—"}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function OutputSummary({
  outputTonnes,
  avgFinesPct,
}: {
  outputTonnes: number;
  avgFinesPct: number | null;
}) {
  return (
    <div className="rounded-lg border border-border/60 p-4 text-sm text-muted-foreground">
      <div className="flex flex-wrap gap-4">
        <span>Total output: {outputTonnes.toFixed(2)} t</span>
        <span>Average fines: {avgFinesPct !== null ? `${avgFinesPct.toFixed(2)} %` : "—"}</span>
      </div>
    </div>
  );
}
