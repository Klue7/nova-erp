import { redirect } from "next/navigation";

import { LoadRecorder } from "./components/load-recorder";
import { ShiftControls } from "./components/shift-controls";
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

const ALLOWED_ROLES = ["mining_operator", "admin"];
const VIEW_MISSING_CODE = "42P01";

type VehicleRow = {
  id: string;
  code: string;
  description: string | null;
};

type StockpileRow = {
  id: string;
  code: string;
  name: string | null;
};

type ShiftSummaryRow = {
  shift_id: string;
  vehicle_code: string;
  status: string;
  started_at: string;
  total_tonnage: number | string | null;
  load_count: number | null;
  avg_moisture_pct: number | string | null;
  last_load_at: string | null;
};

type LoadRow = {
  load_id: string;
  shift_id: string;
  occurred_at: string;
  vehicle_code: string | null;
  stockpile_code: string | null;
  tonnage: number | string | null;
  moisture_pct: number | string | null;
  notes: string | null;
};

function isViewMissing(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === VIEW_MISSING_CODE
  );
}

function isRelationMissing(error: unknown) {
  if (typeof error !== "object" || error === null) return false;
  const code = (error as { code?: string }).code;
  const message = ((error as { message?: string }).message ?? "").toLowerCase();

  return (
    code === VIEW_MISSING_CODE ||
    code === "PGRST301" ||
    code === "PGRST100" ||
    message.includes("schema cache") ||
    message.includes("does not exist")
  );
}

function isParseError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "22P02"
  );
}

function safeNumber(value: number | string | null | undefined) {
  if (value === null || value === undefined) return 0;
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : 0;
}

function formatNumber(value: number, digits = 1) {
  return value.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

export default async function MiningPage() {
  const { profile } = await guardRoute();

  if (!profile) {
    return null;
  }

  if (
    !profile.is_platform_admin &&
    !ALLOWED_ROLES.includes(profile.role)
  ) {
    redirect("/dashboard?toast=access-denied");
  }

  const supabase = await createServerSupabaseClient();

  const vehiclesQuery = supabase
    .from("mining_vehicles")
    .select("id, code, description")
    .eq("tenant_id", profile.tenant_id)
    .eq("status", "active")
    .order("code", { ascending: true });

  const stockpilesQuery = supabase
    .from("stockpiles")
    .select("id, code, name")
    .eq("tenant_id", profile.tenant_id)
    .order("code", { ascending: true });

  const activeShiftQuery = supabase
    .from("mining_shift_summary_v")
    .select(
      "shift_id, vehicle_code, status, started_at, total_tonnage, load_count, avg_moisture_pct, last_load_at",
    )
    .eq("tenant_id", profile.tenant_id)
    .eq("operator_id", profile.id)
    .eq("status", "active")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const loadsQuery = supabase
    .from("mining_loads_v")
    .select(
      "load_id, shift_id, occurred_at, vehicle_code, stockpile_code, tonnage, moisture_pct, notes",
    )
    .eq("tenant_id", profile.tenant_id)
    .eq("operator_id", profile.id)
    .order("occurred_at", { ascending: false })
    .limit(50);

  const [vehiclesRes, stockpilesRes, activeShiftRes, loadsRes] =
    await Promise.all([
      vehiclesQuery,
      stockpilesQuery,
      activeShiftQuery,
      loadsQuery,
    ]);

  let vehicles: VehicleRow[] = [];
  if (vehiclesRes.error) {
    if (!isRelationMissing(vehiclesRes.error) && !isParseError(vehiclesRes.error)) {
      throw new Error(vehiclesRes.error.message);
    } else {
      console.warn("mining.vehicles", vehiclesRes.error);
    }
  } else {
    vehicles = (vehiclesRes.data ?? []) as VehicleRow[];
  }

  if (stockpilesRes.error) {
    if (!isRelationMissing(stockpilesRes.error) && !isParseError(stockpilesRes.error)) {
      throw new Error(stockpilesRes.error.message);
    } else {
      console.warn("mining.stockpiles", stockpilesRes.error);
    }
  }
  const stockpiles = (stockpilesRes.data ?? []) as StockpileRow[];

  let activeShift: ShiftSummaryRow | null = null;
  if (activeShiftRes.error) {
    if (!isRelationMissing(activeShiftRes.error) && activeShiftRes.error.code !== "PGRST116") {
      throw new Error(activeShiftRes.error.message);
    }
  } else {
    activeShift = (activeShiftRes.data as ShiftSummaryRow | null) ?? null;
  }

  let loads: LoadRow[] = [];
  if (loadsRes.error) {
    if (!isRelationMissing(loadsRes.error) && !isParseError(loadsRes.error)) {
      throw new Error(loadsRes.error.message);
    } else {
      console.warn("mining.loads", loadsRes.error);
    }
  } else {
    loads = (loadsRes.data ?? []) as LoadRow[];
  }

  const activeShiftDetails = activeShift
    ? {
        shiftId: activeShift.shift_id,
        vehicleCode: activeShift.vehicle_code,
        startedAt: activeShift.started_at,
        totalTonnage: safeNumber(activeShift.total_tonnage),
        loadCount: Number(activeShift.load_count ?? 0),
        avgMoisturePct:
          activeShift.avg_moisture_pct === null
            ? null
            : safeNumber(activeShift.avg_moisture_pct),
        lastLoadAt: activeShift.last_load_at,
      }
    : null;

  const normalizedLoads = loads.map((load) => ({
    id: load.load_id,
    shiftId: load.shift_id,
    occurredAt: load.occurred_at,
    vehicleCode: load.vehicle_code ?? "—",
    stockpileCode: load.stockpile_code ?? "—",
    tonnage: safeNumber(load.tonnage),
    moisturePct:
      load.moisture_pct === null
        ? null
        : safeNumber(load.moisture_pct),
    notes: load.notes,
  }));

  const todayKey = new Date().toISOString().slice(0, 10);
  const loadsToday = normalizedLoads.filter((load) =>
    load.occurredAt.startsWith(todayKey),
  );

  const loadsThisShift = activeShiftDetails
    ? normalizedLoads.filter(
        (load) => load.shiftId === activeShiftDetails.shiftId,
      )
    : [];

  const shiftTonnage = loadsThisShift.reduce(
    (sum, load) => sum + load.tonnage,
    0,
  );
  const shiftLoadCount = loadsThisShift.length;
  const moistureSamples = loadsThisShift.filter(
    (load) => load.moisturePct !== null && load.moisturePct !== undefined,
  );
  const shiftAvgMoisture =
    moistureSamples.length > 0
      ? moistureSamples.reduce(
          (sum, load) => sum + (load.moisturePct ?? 0),
          0,
        ) / moistureSamples.length
      : null;

  const todayTonnage = loadsToday.reduce(
    (sum, load) => sum + load.tonnage,
    0,
  );

  const kpis = [
    {
      title: "Shift tonnage",
      value:
        shiftLoadCount > 0
          ? `${formatNumber(shiftTonnage)} t`
          : activeShiftDetails
            ? "0 t"
            : "—",
      helper: activeShiftDetails
        ? `Vehicle ${activeShiftDetails.vehicleCode}${
            shiftAvgMoisture !== null && Number.isFinite(shiftAvgMoisture)
              ? ` • Avg moisture ${formatNumber(shiftAvgMoisture, 2)} %`
              : ""
          }`
        : "No active shift",
    },
    {
      title: "Loads this shift",
      value: shiftLoadCount.toString(),
      helper: shiftLoadCount === 1 ? "1 load logged" : `${shiftLoadCount} loads logged`,
    },
    {
      title: "Loads today",
      value: loadsToday.length.toString(),
      helper:
        loadsToday.length > 0
          ? `${formatNumber(todayTonnage)} t captured`
          : "No loads yet today",
    },
    {
      title: "Available vehicles",
      value: vehicles.length.toString(),
      helper: "Active vehicles ready to assign",
    },
  ];

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold text-foreground">
          Mining operations
        </h1>
        <p className="text-sm text-muted-foreground">
          Assign equipment, capture haulage loads, and stream real-time events into stockpile inventory.
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((kpi) => (
          <KpiCard key={kpi.title} title={kpi.title} value={kpi.value} helper={kpi.helper} />
        ))}
      </section>

      <section className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <Card className="border-border/70">
          <CardHeader>
            <CardTitle>Shift assignment</CardTitle>
            <CardDescription>
              Select a vehicle to begin your shift or release it when completed.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ShiftControls vehicles={vehicles} activeShift={activeShiftDetails} />
          </CardContent>
        </Card>

        <Card className="border-border/70">
          <CardHeader>
            <CardTitle>Log load</CardTitle>
            <CardDescription>
              Record each haul to keep stockpile balances accurate. Entries emit paired events.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <LoadRecorder
              activeShiftId={activeShiftDetails?.shiftId ?? null}
              stockpiles={stockpiles}
            />
          </CardContent>
        </Card>
      </section>

      <section className="space-y-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold text-foreground">Recent loads</h2>
          <p className="text-sm text-muted-foreground">
            Latest haulage events captured for this operator. Use the stockpile module for full history.
          </p>
        </div>
        <Card className="border-border/70">
          <CardContent className="p-0">
            {normalizedLoads.length === 0 ? (
              <div className="flex flex-col gap-2 p-6 text-sm text-muted-foreground">
                <p>No loads recorded yet.</p>
                <p>Start a shift and log a load to populate the stream.</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-40">Occurred</TableHead>
                    <TableHead>Vehicle</TableHead>
                    <TableHead>Stockpile</TableHead>
                    <TableHead className="text-right">Tonnage (t)</TableHead>
                    <TableHead className="text-right">Moisture %</TableHead>
                    <TableHead>Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {normalizedLoads.map((load) => (
                    <TableRow key={load.id}>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {new Date(load.occurredAt).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-sm text-foreground">
                        {load.vehicleCode}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {load.stockpileCode}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {formatNumber(load.tonnage)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {load.moisturePct !== null && load.moisturePct !== undefined
                          ? formatNumber(load.moisturePct, 2)
                          : "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {load.notes ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
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
