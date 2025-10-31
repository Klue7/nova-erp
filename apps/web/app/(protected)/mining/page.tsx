import { redirect } from "next/navigation";

import {
  CreateVehicleDialog,
  EndShiftButton,
  LogLoadDialog,
  StartShiftDialog,
} from "./components/mining-actions";
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

type VehicleRow = {
  id: string;
  code: string;
  type: string | null;
  capacity_tonnes: number | null;
  status: string;
};

type ShiftRow = {
  id: string;
  vehicle_id: string;
  operator_id: string | null;
  status: string;
  started_at: string;
  ended_at: string | null;
};

type StockpileBalanceRow = {
  stockpile_id: string;
  code: string;
  available_tonnes: number | null;
};

type KpiRow = {
  loads_today: number | null;
  tonnes_today: number | null;
  active_vehicles: number | null;
};

type LoadRow = {
  shift_id: string;
  picked_tonnes: number | null;
  dumped_tonnes: number | null;
  loads_picked: number | null;
  loads_dumped: number | null;
};

const ALLOWED_ROLES = ["mining_operator", "admin", "platform_admin"];
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

function formatNumber(value: number, fractionDigits = 1) {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

export default async function MiningPage() {
  const { profile } = await guardRoute();

  if (!profile) {
    return null;
  }

  if (!ALLOWED_ROLES.includes(profile.role)) {
    redirect("/dashboard?toast=access-denied");
  }

  const supabase = await createServerSupabaseClient();

  const [
    vehiclesRes,
    activeShiftsRes,
    recentShiftsRes,
    stockpilesRes,
    kpiRes,
    loadsRes,
  ] = await Promise.all([
    supabase
      .from("mining_vehicles")
      .select("id, code, type, capacity_tonnes, status")
      .eq("tenant_id", profile.tenant_id)
      .order("code", { ascending: true }),
    supabase
      .from("haul_shifts")
      .select("id, vehicle_id, operator_id, status, started_at, ended_at")
      .eq("tenant_id", profile.tenant_id)
      .eq("status", "active"),
    supabase
      .from("haul_shifts")
      .select("id, vehicle_id, operator_id, status, started_at, ended_at")
      .eq("tenant_id", profile.tenant_id)
      .order("started_at", { ascending: false })
      .limit(20),
    supabase
      .from("stockpile_balances_v")
      .select("stockpile_id, code, available_tonnes")
      .eq("tenant_id", profile.tenant_id)
      .order("code", { ascending: true }),
    supabase
      .from("mining_kpi_today")
      .select("loads_today, tonnes_today, active_vehicles")
      .eq("tenant_id", profile.tenant_id)
      .maybeSingle(),
    supabase
      .from("mining_shift_loads_v")
      .select("shift_id, picked_tonnes, dumped_tonnes, loads_picked, loads_dumped")
      .eq("tenant_id", profile.tenant_id),
  ]);

  const vehicles = (vehiclesRes.data ?? []) as VehicleRow[];
  const activeShifts = (activeShiftsRes.data ?? []) as ShiftRow[];
  const recentShifts = (recentShiftsRes.data ?? []) as ShiftRow[];
  const stockpiles = (stockpilesRes.data ?? []) as StockpileBalanceRow[];
  const loads = (loadsRes.data ?? []) as LoadRow[];

  const viewError = [
    vehiclesRes.error,
    activeShiftsRes.error,
    recentShiftsRes.error,
    stockpilesRes.error,
    loadsRes.error,
  ]
    .filter(Boolean)
    .find((error) => !isViewMissing(error));

  if (viewError) {
    console.error("mining.dashboard", viewError);
  }

  const vehicleMap = new Map<string, VehicleRow>();
  vehicles.forEach((vehicle) => vehicleMap.set(vehicle.id, vehicle));

  const shiftMap = new Map<string, ShiftRow>();
  recentShifts.forEach((shift) => shiftMap.set(shift.id, shift));

  const activeShift =
    activeShifts.find((shift) => shift.operator_id === profile.id) ??
    activeShifts[0] ??
    null;

  const activeVehicleIds = new Set(activeShifts.map((shift) => shift.vehicle_id));
  const availableVehicles = vehicles.filter(
    (vehicle) => !activeVehicleIds.has(vehicle.id) && vehicle.status === "active",
  );

  const stockpileOptions = stockpiles.map((item) => ({
    id: item.stockpile_id,
    code: item.code,
    availableTonnes: safeNumber(item.available_tonnes),
  }));

  const kpiData = (kpiRes.data ?? {
    loads_today: 0,
    tonnes_today: 0,
    active_vehicles: 0,
  }) as KpiRow;

  const formattedLoads = loads
    .map((row) => ({
      shift: shiftMap.get(row.shift_id) ?? null,
      data: row,
    }))
    .filter((entry) => entry.shift)
    .sort((a, b) =>
      (b.shift?.started_at ?? "").localeCompare(a.shift?.started_at ?? ""),
    )
    .slice(0, 10)
    .map((entry) => {
      const vehicle = entry.shift ? vehicleMap.get(entry.shift.vehicle_id) ?? null : null;
      const picked = safeNumber(entry.data.picked_tonnes);
      const dumped = safeNumber(entry.data.dumped_tonnes);
      return {
        shiftId: entry.shift!.id,
        vehicleCode: vehicle?.code ?? "Unknown vehicle",
        startedAt: entry.shift!.started_at,
        loadsPicked: safeNumber(entry.data.loads_picked),
        loadsDumped: safeNumber(entry.data.loads_dumped),
        tonnesPicked: picked,
        tonnesDumped: dumped,
      };
    });

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Mining</h1>
          <p className="text-sm text-muted-foreground">
            Manage haul shifts, log pit loads, and monitor stockpile receipts in real time.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CreateVehicleDialog />
          <StartShiftDialog vehicles={availableVehicles} />
          <LogLoadDialog
            shiftId={activeShift ? activeShift.id : null}
            stockpiles={stockpileOptions}
          />
          <EndShiftButton shiftId={activeShift ? activeShift.id : null} />
        </div>
      </header>

      <section className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Loads today</CardTitle>
            <CardDescription>Loads dumped across all vehicles</CardDescription>
          </CardHeader>
          <CardContent className="text-3xl font-semibold">
            {formatNumber(safeNumber(kpiData.loads_today), 0)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Tonnes today</CardTitle>
            <CardDescription>Material delivered to stockpiles</CardDescription>
          </CardHeader>
          <CardContent className="text-3xl font-semibold">
            {formatNumber(safeNumber(kpiData.tonnes_today))}
            <span className="ml-1 text-sm text-muted-foreground">t</span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Active vehicles</CardTitle>
            <CardDescription>Vehicles currently in shift</CardDescription>
          </CardHeader>
          <CardContent className="text-3xl font-semibold">
            {formatNumber(safeNumber(kpiData.active_vehicles), 0)}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Vehicles</CardTitle>
            <CardDescription>Fleet status and availability</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Capacity (t)</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vehicles.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                      No vehicles registered yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  vehicles.map((vehicle) => (
                    <TableRow key={vehicle.id}>
                      <TableCell className="font-medium">{vehicle.code}</TableCell>
                      <TableCell>{vehicle.type ?? "—"}</TableCell>
                      <TableCell>
                        {vehicle.capacity_tonnes
                          ? formatNumber(vehicle.capacity_tonnes)
                          : "—"}
                      </TableCell>
                      <TableCell className="capitalize">
                        {activeVehicleIds.has(vehicle.id) ? "Active" : vehicle.status}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Stockpiles</CardTitle>
            <CardDescription>Live balances (tonnes)</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Stockpile</TableHead>
                  <TableHead className="text-right">Available (t)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stockpiles.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={2} className="text-center text-sm text-muted-foreground">
                      No stockpiles recorded yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  stockpiles.map((row) => (
                    <TableRow key={row.stockpile_id}>
                      <TableCell className="font-medium">{row.code}</TableCell>
                      <TableCell className="text-right">
                        {formatNumber(safeNumber(row.available_tonnes))}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>

      <section>
        <Card>
          <CardHeader>
            <CardTitle>Recent loads</CardTitle>
            <CardDescription>Aggregated per shift</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Shift started</TableHead>
                  <TableHead>Vehicle</TableHead>
                  <TableHead className="text-right">Loads (picked / dumped)</TableHead>
                  <TableHead className="text-right">Tonnes (picked / dumped)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {formattedLoads.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                      No loads recorded yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  formattedLoads.map((row) => (
                    <TableRow key={row.shiftId}>
                      <TableCell>{formatDate(row.startedAt)}</TableCell>
                      <TableCell>{row.vehicleCode}</TableCell>
                      <TableCell className="text-right">
                        {formatNumber(row.loadsPicked, 0)} / {formatNumber(row.loadsDumped, 0)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatNumber(row.tonnesPicked)} / {formatNumber(row.tonnesDumped)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

