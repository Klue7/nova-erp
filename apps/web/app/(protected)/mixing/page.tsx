import { redirect } from "next/navigation";

import { BatchTable, type BatchRow } from "./components/batch-table";
import { MixingActions } from "./components/mixing-actions";
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
import { listAvailableForMixing } from "@/lib/upstream";
import { createServerSupabaseClient } from "@/utils/supabase/server";

const ALLOWED_ROLES = ["mixing_operator", "admin"];
const VIEW_MISSING_CODE = "42P01";

type MixingSearchParams = Record<string, string | string[] | undefined>;

type MixingPageProps = {
  searchParams: Promise<MixingSearchParams>;
};

type ComponentAggregate = {
  stockpileId: string;
  stockpileCode: string;
  materialType: string | null;
  quantityTonnes: number;
  lastOccurredAt: string | null;
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

export default async function MixingPage({ searchParams }: MixingPageProps) {
  const { profile } = await guardRoute();

  if (!profile) {
    return null;
  }

  if (!ALLOWED_ROLES.includes(profile.role)) {
    redirect("/dashboard?toast=access-denied");
  }

  const supabase = await createServerSupabaseClient();

  const batchesQuery = supabase
    .from("mix_batches")
    .select("id, code, status, started_at, completed_at, target_output_tonnes")
    .eq("tenant_id", profile.tenant_id)
    .order("created_at", { ascending: false });

  const inputsQuery = supabase
    .from("mix_inputs_v")
    .select("batch_id, total_input_tonnes")
    .eq("tenant_id", profile.tenant_id);

  const kpiQuery = supabase
    .from("mix_kpi_today")
    .select("active_batches, input_today")
    .eq("tenant_id", profile.tenant_id)
    .maybeSingle();

  const lastCompletedEventQuery = supabase
    .from("mixing_events")
    .select("payload, occurred_at")
    .eq("tenant_id", profile.tenant_id)
    .eq("event_type", "MIX_BATCH_COMPLETED")
    .order("occurred_at", { ascending: false })
    .limit(10);

  const [
    batchesRes,
    inputsRes,
    kpiRes,
    completedEventsRes,
  ] = await Promise.all([
    batchesQuery,
    inputsQuery,
    kpiQuery,
    lastCompletedEventQuery,
  ]);

  if (batchesRes.error) {
    throw new Error(batchesRes.error.message);
  }

  const inputsMap = new Map<string, number>();
  (inputsRes.data ?? []).forEach((row) => {
    inputsMap.set(row.batch_id, Number(row.total_input_tonnes ?? 0));
  });

  const allBatches = (batchesRes.data ?? []).map((batch) => ({
    ...batch,
    totalInputTonnes: inputsMap.get(batch.id) ?? 0,
  }));

  const tableBatches: BatchRow[] = allBatches
    .filter((batch) => batch.status === "planned" || batch.status === "active")
    .map((batch) => ({
      id: batch.id,
      code: batch.code,
      status: batch.status,
      totalInputTonnes: batch.totalInputTonnes,
      startedAt: batch.started_at,
    }));

  const params = await searchParams;

  const searchSelected = Array.isArray(params.batch)
    ? params.batch[0]
    : params.batch;

  const selectedBatchId = (() => {
    if (searchSelected && allBatches.some((batch) => batch.id === searchSelected)) {
      return searchSelected;
    }
    if (tableBatches.length > 0) {
      return tableBatches[0].id;
    }
    return allBatches[0]?.id ?? null;
  })();

  const selectedBatch = selectedBatchId
    ? allBatches.find((batch) => batch.id === selectedBatchId) ?? null
    : null;

  let components: ComponentAggregate[] = [];
  if (selectedBatchId) {
    const componentsRes = await supabase
      .from("mix_components_v")
      .select("stockpile_id, stockpile_code, material_type, signed_qty, occurred_at")
      .eq("tenant_id", profile.tenant_id)
      .eq("batch_id", selectedBatchId);

    if (componentsRes.error && !isViewMissing(componentsRes.error)) {
      throw new Error(componentsRes.error.message);
    }

    const aggregate = new Map<string, ComponentAggregate>();
    (componentsRes.data ?? []).forEach((row) => {
      const key = `${row.stockpile_id}:${row.material_type ?? ""}`;
      const entry = aggregate.get(key) ?? {
        stockpileId: row.stockpile_id,
        stockpileCode: row.stockpile_code ?? "",
        materialType: row.material_type ?? null,
        quantityTonnes: 0,
        lastOccurredAt: row.occurred_at ?? null,
      };
      entry.quantityTonnes += numberOrZero(row.signed_qty);
      entry.lastOccurredAt = row.occurred_at ?? entry.lastOccurredAt;
      aggregate.set(key, entry);
    });

    components = Array.from(aggregate.values()).filter(
      (component) => component.quantityTonnes !== 0,
    );
  }

  const stockpileOptions = (await listAvailableForMixing()).map((option) => ({
    id: option.id,
    code: option.code,
    name: null,
    availableTonnes: option.availableTonnes,
  }));

  const componentOptions = components
    .filter((component) => component.quantityTonnes > 0)
    .map((component) => ({
      stockpileId: component.stockpileId,
      stockpileCode: component.stockpileCode,
      remainingTonnes: component.quantityTonnes,
    }));

  const kpi = kpiRes.error && !isViewMissing(kpiRes.error) ? null : kpiRes.data ?? null;
  const activeBatchesKpi = kpi?.active_batches ?? 0;
  const inputTodayKpi = kpi?.input_today ?? 0;

  const completedEvents = completedEventsRes.error
    ? isViewMissing(completedEventsRes.error)
      ? []
      : (() => {
          throw new Error(completedEventsRes.error.message);
        })()
    : completedEventsRes.data ?? [];

  const moistureSamples = completedEvents
    .map((event) => Number(event.payload?.moisturePct ?? event.payload?.moisturepct))
    .filter((value) => Number.isFinite(value));
  const averageMoisture = moistureSamples.length
    ? moistureSamples.reduce((sum, value) => sum + value, 0) / moistureSamples.length
    : null;

  const lastCompleted = completedEvents[0]
    ? {
        occurredAt: completedEvents[0].occurred_at,
        outputTonnes: Number(completedEvents[0].payload?.outputTonnes ?? 0),
        moisturePct: Number(completedEvents[0].payload?.moisturePct ?? 0),
      }
    : null;

  const batchDetails = selectedBatch
    ? {
        id: selectedBatch.id,
        code: selectedBatch.code,
        status: selectedBatch.status,
        totalInputTonnes: selectedBatch.totalInputTonnes,
        startedAt: selectedBatch.started_at,
        completedAt: selectedBatch.completed_at,
        targetOutputTonnes: selectedBatch.target_output_tonnes,
        components,
      }
    : null;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold text-foreground">Mixing dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Coordinate component blending and monitor batch progression before feeding the crushers.
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title="Active batches"
          value={activeBatchesKpi.toString()}
          helper="Batches currently in progress"
        />
        <KpiCard
          title="Inputs today"
          value={`${inputTodayKpi.toFixed(2)} t`}
          helper="Material drawn into batches"
        />
        <KpiCard
          title="Avg moisture"
          value={
            averageMoisture !== null ? `${averageMoisture.toFixed(2)} %` : "No samples"
          }
          helper="Recent completed batches"
        />
        <KpiCard
          title="Last completed"
          value={
            lastCompleted
              ? `${lastCompleted.outputTonnes.toFixed(1)} t @ ${lastCompleted.moisturePct.toFixed(2)} %`
              : "None"
          }
          helper={
            lastCompleted ? new Date(lastCompleted.occurredAt).toLocaleString() : "No history"
          }
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,320px)_1fr]">
        <Card className="border-border/70">
          <CardHeader className="space-y-1">
            <CardTitle>Planned & Active batches</CardTitle>
            <CardDescription>Select a batch to view details and actions.</CardDescription>
          </CardHeader>
          <CardContent>
            <BatchTable batches={tableBatches} />
          </CardContent>
        </Card>

        <Card className="border-border/70">
          <CardHeader className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>
                  {batchDetails ? `Batch ${batchDetails.code}` : "Select a batch"}
                </CardTitle>
                <CardDescription>
                  {batchDetails
                    ? `Status: ${batchDetails.status}`
                    : "Choose a batch from the list to see details."}
                </CardDescription>
              </div>
              <MixingActions
                stockpiles={stockpileOptions}
                componentOptions={componentOptions}
                selectedBatch={
                  batchDetails
                    ? { id: batchDetails.id, code: batchDetails.code, status: batchDetails.status }
                    : null
                }
              />
            </div>
            {batchDetails ? (
              <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                <span>
                  Inputs: {batchDetails.totalInputTonnes.toFixed(2)} t
                </span>
                {batchDetails.targetOutputTonnes ? (
                  <span>Target: {Number(batchDetails.targetOutputTonnes).toFixed(1)} t</span>
                ) : null}
                {batchDetails.startedAt ? (
                  <span>Started: {new Date(batchDetails.startedAt).toLocaleString()}</span>
                ) : null}
                {batchDetails.completedAt ? (
                  <span>Completed: {new Date(batchDetails.completedAt).toLocaleString()}</span>
                ) : null}
              </div>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-4">
            {batchDetails ? (
              <ComponentsTable components={batchDetails.components} />
            ) : (
              <div className="rounded-lg border border-dashed border-border/60 p-6 text-sm text-muted-foreground">
                Select a batch to inspect its component breakdown.
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
        No components logged yet.
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Stockpile</TableHead>
          <TableHead>Material</TableHead>
          <TableHead className="text-right">Quantity (t)</TableHead>
          <TableHead>Last movement</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {components.map((component) => (
          <TableRow key={`${component.stockpileId}:${component.materialType ?? ""}`}>
            <TableCell className="font-medium text-foreground">
              {component.stockpileCode}
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {component.materialType ?? "—"}
            </TableCell>
            <TableCell className="text-right font-mono text-xs">
              {component.quantityTonnes.toFixed(2)}
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {component.lastOccurredAt
                ? new Date(component.lastOccurredAt).toLocaleString()
                : "—"}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
