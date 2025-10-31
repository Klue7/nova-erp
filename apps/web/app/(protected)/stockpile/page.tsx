import { redirect } from "next/navigation";

import { StockpileActions } from "./components/action-dialogs";
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
import { cn } from "@/lib/utils";
import { guardRoute } from "@/lib/rbac";
import { createServerSupabaseClient } from "@/utils/supabase/server";

type StockpileRow = {
  id: string;
  code: string;
  name: string | null;
  location: string | null;
  material_type: string | null;
  status: string;
};

type BalanceRow = {
  stockpile_id: string;
  available_tonnes: number | null;
  last_movement_at?: string | null;
};

type QualityRow = {
  stockpile_id: string;
  moisture_pct: number | null;
  occurred_at: string | null;
};

type MovementRow = {
  event_type: string;
  raw_qty: number | null;
  signed_qty: number | null;
  occurred_at: string;
};

type StockpileEventRow = {
  id: string;
  occurred_at: string;
  event_type: string;
  payload: Record<string, unknown>;
};

const ALLOWED_ROLES = ["stockpile_operator", "mining_operator", "admin"];

const VIEW_MISSING_CODE = "42P01";

function isViewMissing(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === VIEW_MISSING_CODE
  );
}

function safeNumber(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return 0;
  }
  return Number(value);
}

function formatNumber(value: number, digits = 1) {
  return value.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

export default async function StockpilePage() {
  const { profile } = await guardRoute();

  if (!profile) {
    return null;
  }

  if (!ALLOWED_ROLES.includes(profile.role)) {
    redirect("/dashboard?toast=access-denied");
  }

  const supabase = await createServerSupabaseClient();

  const [stockpilesRes, balancesRes, qualityRes, eventsRes, movementsRes] =
    await Promise.all([
      supabase
        .from("stockpiles")
        .select("id, code, name, location, material_type, status")
        .eq("tenant_id", profile.tenant_id)
        .order("code", { ascending: true }),
      supabase
        .from("stockpile_balances_v")
        .select("stockpile_id, available_tonnes")
        .eq("tenant_id", profile.tenant_id),
      supabase
        .from("stockpile_quality_latest")
        .select("stockpile_id, moisture_pct, occurred_at")
        .eq("tenant_id", profile.tenant_id),
      supabase
        .from("stockpile_events")
        .select("id, occurred_at, event_type, payload")
        .eq("tenant_id", profile.tenant_id)
        .order("occurred_at", { ascending: false })
        .limit(20),
      supabase
        .from("stockpile_movements")
        .select("event_type, raw_qty, signed_qty, occurred_at")
        .eq("tenant_id", profile.tenant_id)
        .gte("occurred_at", new Date(new Date().setHours(0, 0, 0, 0)).toISOString()),
    ]);

  const stockpiles = stockpilesRes.data as StockpileRow[] | null;
  const balances = balancesRes.data as BalanceRow[] | null;
  const quality = qualityRes.data as QualityRow[] | null;
  const events = eventsRes.data as StockpileEventRow[] | null;
  const movements = movementsRes.data as MovementRow[] | null;

  const viewError =
    [stockpilesRes.error, balancesRes.error, qualityRes.error, eventsRes.error, movementsRes.error]
      .filter(Boolean)
      .find((err) => !isViewMissing(err));

  if (viewError) {
    console.error("stockpile.dashboard", viewError);
  }

  const stockpileMap = new Map<string, StockpileRow>();
  (stockpiles ?? []).forEach((row) => {
    stockpileMap.set(row.id, row);
  });

  const balanceMap = new Map<string, BalanceRow>();
  (balances ?? []).forEach((row) => {
    balanceMap.set(row.stockpile_id, row);
  });

  const qualityMap = new Map<string, QualityRow>();
  (quality ?? []).forEach((row) => {
    qualityMap.set(row.stockpile_id, row);
  });

  const totalAvailable = (balances ?? []).reduce(
    (sum, row) => sum + safeNumber(row.available_tonnes),
    0,
  );

  const activeStockpiles = (stockpiles ?? []).filter(
    (row) => row.status === "active",
  ).length;

  const moistureValues = (quality ?? [])
    .map((row) => safeNumber(row.moisture_pct))
    .filter((value) => value > 0);
  const averageMoisture =
    moistureValues.length > 0
      ? moistureValues.reduce((sum, value) => sum + value, 0) /
        moistureValues.length
      : 0;

  const latestMoistureRecord = (quality ?? [])
    .slice()
    .sort((a, b) =>
      (b.occurred_at ?? "").localeCompare(a.occurred_at ?? ""),
    )[0];

  const movementsToday = (movements ?? []).reduce(
    (acc, movement) => {
      const raw = safeNumber(movement.raw_qty);
      if (
        [
          "STOCKPILE_RECEIPT_RECORDED",
          "STOCKPILE_TRANSFERRED_IN",
          "STOCKPILE_ADJUSTED_IN",
          "STOCKPILE_RESERVATION_RELEASED",
        ].includes(movement.event_type)
      ) {
        acc.in += raw;
      } else if (
        [
          "STOCKPILE_TRANSFERRED_OUT",
          "STOCKPILE_ADJUSTED_OUT",
          "STOCKPILE_RESERVED",
        ].includes(movement.event_type)
      ) {
        acc.out += raw;
      }
      return acc;
    },
    { in: 0, out: 0 },
  );

  const tableRows = (stockpiles ?? []).map((stockpile) => {
    const balance = balanceMap.get(stockpile.id);
    const qualityRecord = qualityMap.get(stockpile.id);
    return {
      ...stockpile,
      availableTonnes: safeNumber(balance?.available_tonnes),
      lastMovementAt: balance?.last_movement_at ?? null,
      latestMoisture: qualityRecord?.moisture_pct ?? null,
      latestMoistureAt: qualityRecord?.occurred_at ?? null,
    };
  });

  const stockpileOptions = tableRows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
  }));

  const recentEvents = (events ?? []).map((item) => {
    const payload = item.payload ?? {};
    const quantity = Number(payload.quantityTonnes ?? payload.qty ?? 0);
    const code = payload.code ?? payload.stockpileCode ?? "";
    return {
      id: item.id,
      occurredAt: item.occurred_at,
      eventType: item.event_type,
      quantity: Number.isNaN(quantity) ? null : quantity,
      code: code as string,
    };
  });

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold text-foreground">
            Stockpile dashboard
          </h1>
          <p className="text-sm text-muted-foreground">
            Monitor stock balances, material quality, and stockpile movements
            in real time.
          </p>
        </div>
        <StockpileActions stockpiles={stockpileOptions} />
      </header>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title="Total available"
          value={`${formatNumber(totalAvailable)} t`}
          helper="Across all stockpiles"
        />
        <KpiCard
          title="Active stockpiles"
          value={activeStockpiles.toString()}
          helper="Status = active"
        />
        <KpiCard
          title="Avg moisture"
          value={moistureValues.length > 0 ? `${formatNumber(averageMoisture, 2)} %` : "—"}
          helper={latestMoistureRecord?.occurred_at ? `Last sample ${new Date(latestMoistureRecord.occurred_at).toLocaleDateString()}` : "No samples yet"}
        />
        <KpiCard
          title="Movements today"
          value={`+${formatNumber(movementsToday.in)} / -${formatNumber(movementsToday.out)}`}
          helper="Inbound / outbound (t)"
        />
      </section>

      <section className="space-y-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold text-foreground">Stockpiles</h2>
          <p className="text-sm text-muted-foreground">
            Inventory positions and latest quality readings for each stockpile.
          </p>
        </div>
        <Card className="border-border/70">
          <CardContent className="p-0">
            {tableRows.length === 0 ? (
              <EmptyState message="No stockpiles yet. Create your first stockpile to begin tracking." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Material</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Available (t)</TableHead>
                    <TableHead className="text-right">Moisture %</TableHead>
                    <TableHead>Last movement</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tableRows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium text-foreground">
                        {row.code}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {row.name ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {row.location ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {row.material_type ?? "—"}
                      </TableCell>
                      <TableCell>
                        <span
                          className={cn(
                            "rounded-full border px-2 py-1 text-xs capitalize",
                            row.status === "active"
                              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600"
                              : "border-muted/60 bg-muted/30 text-muted-foreground",
                          )}
                        >
                          {row.status}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {formatNumber(row.availableTonnes)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {row.latestMoisture !== null && row.latestMoisture !== undefined
                          ? formatNumber(row.latestMoisture, 2)
                          : "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(row.lastMovementAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="space-y-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold text-foreground">
            Recent events
          </h2>
          <p className="text-sm text-muted-foreground">
            Event-sourced activity across all stockpiles.
          </p>
        </div>
        <Card className="border-border/70">
          <CardContent className="divide-y divide-border/60 p-0">
            {recentEvents.length === 0 ? (
              <EmptyState message="No stockpile events recorded yet." />
            ) : (
              recentEvents.map((event) => (
                <div key={event.id} className="flex flex-col gap-1 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium text-foreground">
                      {event.eventType.replace(/_/g, " ")}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {formatDate(event.occurredAt)}
                    </span>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {event.code ? `Stockpile ${event.code}` : "Stockpile event"}
                    {event.quantity
                      ? ` • Qty ${formatNumber(event.quantity, 2)} t`
                      : ""}
                  </div>
                </div>
              ))
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

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-start gap-2 p-6 text-sm text-muted-foreground">
      <p>{message}</p>
    </div>
  );
}
