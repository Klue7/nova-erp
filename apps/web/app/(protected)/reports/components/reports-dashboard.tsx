'use client';

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  formatDate,
  formatISODate,
  isAfterDate,
  isBeforeDate,
  parseISODate,
} from "@/lib/date-utils";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import {
  DailyThroughputRow,
  ExecTodayRow,
  OrderDispatchLeadTimeRow,
  QualityTodayRow,
  WipSummaryRow,
  calculatePercentiles,
  isDateWithinRange,
} from "@/lib/reports";

import {
  exportLeadTimesCsvAction,
  exportThroughputCsvAction,
  exportWipCsvAction,
} from "../actions";

type ReportsDashboardProps = {
  defaultFrom: string;
  defaultTo: string;
  minDate: string;
  maxDate: string;
  execToday: ExecTodayRow | null;
  throughput: DailyThroughputRow[];
  wip: WipSummaryRow[];
  quality: QualityTodayRow | null;
  leadTimes: OrderDispatchLeadTimeRow[];
};

type CsvActionResult =
  | { success: true; filename: string; csv: string }
  | { success: false; error: string };

function coerceNumber(value: number | null | undefined) {
  if (value === null || value === undefined) return 0;
  return Number.isFinite(value) ? Number(value) : 0;
}

function downloadCsv({ filename, csv }: { filename: string; csv: string }) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export default function ReportsDashboard({
  defaultFrom,
  defaultTo,
  minDate,
  maxDate,
  execToday,
  throughput,
  wip,
  quality,
  leadTimes,
}: ReportsDashboardProps) {
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [skuFilter, setSkuFilter] = useState("");
  const [gradeFilter, setGradeFilter] = useState("");

  const [isExportingThroughput, startThroughputExport] = useTransition();
  const [isExportingWip, startWipExport] = useTransition();
  const [isExportingLead, startLeadExport] = useTransition();

  const filteredThroughput = useMemo(
    () =>
      throughput.filter((row) => isDateWithinRange(row.d, from, to)),
    [throughput, from, to],
  );

  const throughputChartData = useMemo(
    () =>
      filteredThroughput.map((row) => ({
        date: row.d,
        label: formatDate(row.d, { month: "short", day: "numeric" }),
        mix_input_tonnes: coerceNumber(row.mix_input_tonnes),
        crush_output_tonnes: coerceNumber(row.crush_output_tonnes),
        extrusion_output_units: coerceNumber(row.extrusion_output_units),
        packed_units: coerceNumber(row.packed_units),
        units_dispatched: coerceNumber(row.units_dispatched),
      })),
    [filteredThroughput],
  );

  const filteredLeadTimes = useMemo(() => {
    const sku = skuFilter.trim().toLowerCase();
    const grade = gradeFilter.trim().toLowerCase();
    return leadTimes.filter((row) => {
      const baseMatch =
        isDateWithinRange(
          row.order_date ?? row.first_dispatch_date,
          from,
          to,
        );
      if (!baseMatch) return false;

      const code = row.order_code?.toLowerCase() ?? "";
      const skuMatches = sku.length === 0 || code.includes(sku);
      const gradeMatches = grade.length === 0 || code.includes(grade);
      return skuMatches && gradeMatches;
    });
  }, [leadTimes, from, to, skuFilter, gradeFilter]);

  const leadTimeValues = filteredLeadTimes
    .map((row) => row.days_order_to_dispatch)
    .filter(
      (value): value is number =>
        value !== null && Number.isFinite(Number(value)),
    )
    .map((value) => Number(value));

  const leadTimeStats = calculatePercentiles(leadTimeValues);

  const leadTimeDistribution = useMemo(() => {
    const buckets = new Map<number, number>();
    leadTimeValues.forEach((value) => {
      const day = Math.max(Math.round(value), 0);
      buckets.set(day, (buckets.get(day) ?? 0) + 1);
    });
    return Array.from(buckets.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([days, count]) => ({ days, count }));
  }, [leadTimeValues]);

  function formatNumber(value: number | null | undefined, digits = 0) {
    const number = coerceNumber(value ?? 0);
    return number.toLocaleString(undefined, {
      maximumFractionDigits: digits,
      minimumFractionDigits: digits,
    });
  }

  function handleFromChange(value: string) {
    if (!value) return;
    if (isAfterDate(parseISODate(value), parseISODate(to))) {
      toast({
        title: "Invalid date range",
        description: "The start date must be before the end date.",
        variant: "destructive",
      });
      return;
    }
    setFrom(value);
  }

  function handleToChange(value: string) {
    if (!value) return;
    if (isBeforeDate(parseISODate(value), parseISODate(from))) {
      toast({
        title: "Invalid date range",
        description: "The end date must be on or after the start date.",
        variant: "destructive",
      });
      return;
    }
    setTo(value);
  }

  async function handleCsvExport(
    action: () => Promise<CsvActionResult>,
  ) {
    const result = await action();
    if (!result.success) {
      toast({
        title: "Export failed",
        description: result.error,
        variant: "destructive",
      });
      return;
    }
    downloadCsv({ filename: result.filename, csv: result.csv });
    toast({
      title: "Export ready",
      description: `Downloaded ${result.filename}`,
    });
  }

  const kpi = {
    units_dispatched_today: coerceNumber(
      execToday?.units_dispatched_today ?? 0,
    ),
    units_packed_today: coerceNumber(execToday?.units_packed_today ?? 0),
    open_orders: coerceNumber(execToday?.open_orders ?? 0),
    units_reserved: coerceNumber(execToday?.units_reserved ?? 0),
    invoices_issued_today: coerceNumber(
      execToday?.invoices_issued_today ?? 0,
    ),
    payments_received_today: coerceNumber(
      execToday?.payments_received_today ?? 0,
    ),
    open_ar_total: coerceNumber(execToday?.open_ar_total ?? 0),
  };

  const qualityCard = {
    extrusion_scrap_today: coerceNumber(
      quality?.extrusion_scrap_today ?? 0,
    ),
    dry_scrap_today: coerceNumber(quality?.dry_scrap_today ?? 0),
    kiln_yield_pct_active_avg:
      quality?.kiln_yield_pct_active_avg ?? null,
  };

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h1 className="text-2xl font-semibold text-foreground">
          Cross-module reporting
        </h1>
        <p className="text-sm text-muted-foreground">
          Review production throughput, WIP posture, quality trends, and
          order-to-dispatch performance across the tenant. Filters are
          applied on the client for quick exploration.
        </p>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <CardDescription>
            Default view covers the last 30 days. Adjust the range or add
            text filters to focus on specific orders or grades.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-5">
            <div className="space-y-2">
              <Label htmlFor="reports-from">From</Label>
              <Input
                id="reports-from"
                type="date"
                min={minDate}
                max={maxDate}
                value={from}
                onChange={(event) => handleFromChange(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reports-to">To</Label>
              <Input
                id="reports-to"
                type="date"
                min={minDate}
                max={maxDate}
                value={to}
                onChange={(event) => handleToChange(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reports-sku">SKU filter</Label>
              <Input
                id="reports-sku"
                placeholder="e.g. MB-CLAY-A"
                value={skuFilter}
                onChange={(event) => setSkuFilter(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reports-grade">Grade filter</Label>
              <Input
                id="reports-grade"
                placeholder="e.g. Premium"
                value={gradeFilter}
                onChange={(event) => setGradeFilter(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-transparent">placeholder</Label>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setFrom(defaultFrom);
                    setTo(defaultTo);
                    setSkuFilter("");
                    setGradeFilter("");
                  }}
                >
                  Reset
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <section className="grid gap-4 md:grid-cols-3">
        <KpiCard
          value={formatNumber(kpi.units_dispatched_today)}
          label="Units dispatched today"
          href="/dispatch"
        />
        <KpiCard
          value={formatNumber(kpi.units_packed_today)}
          label="Units packed today"
          href="/packing"
        />
        <KpiCard
          value={formatNumber(kpi.open_orders)}
          label="Open sales orders"
          href="/sales"
        />
        <KpiCard
          value={formatNumber(kpi.units_reserved)}
          label="Units reserved"
          href="/sales"
        />
        <KpiCard
          value={formatNumber(kpi.invoices_issued_today)}
          label="Invoices issued today"
          href="/finance"
        />
        <KpiCard
          value={formatNumber(kpi.payments_received_today, 2)}
          label="Payments received today"
          href="/finance"
        />
        <KpiCard
          value={`R ${formatNumber(kpi.open_ar_total, 2)}`}
          label="Open accounts receivable"
          href="/finance"
        />
      </section>

      <Card>
        <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle>Throughput (last {filteredThroughput.length} days)</CardTitle>
            <CardDescription>
              Daily trend across upstream production and outbound units.
            </CardDescription>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={isExportingThroughput}
            onClick={() =>
              startThroughputExport(() =>
                handleCsvExport(() =>
                  exportThroughputCsvAction({ from, to }),
                ),
              )
            }
          >
            {isExportingThroughput ? "Preparing…" : "Export throughput CSV"}
          </Button>
        </CardHeader>
        <CardContent>
          {throughputChartData.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No throughput records for the selected range.
            </p>
          ) : (
            <div className="h-[360px] w-full">
              <ResponsiveContainer>
                <AreaChart data={throughputChartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Area
                    type="monotone"
                    dataKey="mix_input_tonnes"
                    name="Mix input (t)"
                    stroke="#2563eb"
                    fill="#2563eb22"
                  />
                  <Area
                    type="monotone"
                    dataKey="crush_output_tonnes"
                    name="Crushing output (t)"
                    stroke="#16a34a"
                    fill="#16a34a22"
                  />
                  <Area
                    type="monotone"
                    dataKey="extrusion_output_units"
                    name="Extrusion output (units)"
                    stroke="#f97316"
                    fill="#f9731622"
                  />
                  <Area
                    type="monotone"
                    dataKey="packed_units"
                    name="Packed units"
                    stroke="#7c3aed"
                    fill="#7c3aed22"
                  />
                  <Area
                    type="monotone"
                    dataKey="units_dispatched"
                    name="Dispatched units"
                    stroke="#0f172a"
                    fill="#0f172a22"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle>WIP snapshot</CardTitle>
            <CardDescription>
              Planned vs active batches and open pallets across the current tenant.
            </CardDescription>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={isExportingWip}
            onClick={() =>
              startWipExport(() =>
                handleCsvExport(() => exportWipCsvAction()),
              )
            }
          >
            {isExportingWip ? "Preparing…" : "Export WIP CSV"}
          </Button>
        </CardHeader>
        <CardContent>
          {wip.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No WIP data is available yet for this tenant.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border/60">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Stage</TableHead>
                    <TableHead className="text-right">Planned</TableHead>
                    <TableHead className="text-right">Active</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {wip.map((row) => (
                    <TableRow key={row.stage}>
                      <TableCell className="capitalize">
                        {row.stage.replace(/_/g, " ")}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatNumber(row.planned)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatNumber(row.active)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <section className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Extrusion scrap (today)</CardTitle>
            <CardDescription>Units recorded as scrap during extrusion runs.</CardDescription>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {formatNumber(qualityCard.extrusion_scrap_today)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Dry yard scrap (today)</CardTitle>
            <CardDescription>Units scrapped while racks are in the dry yard.</CardDescription>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {formatNumber(qualityCard.dry_scrap_today)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Kiln yield (active avg)</CardTitle>
            <CardDescription>
              Average yield percentage across currently active kiln batches.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {qualityCard.kiln_yield_pct_active_avg === null
              ? "—"
              : `${formatNumber(
                  qualityCard.kiln_yield_pct_active_avg,
                  1,
                )}%`}
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle>Order → Dispatch lead time</CardTitle>
            <CardDescription>
              Days between sales order creation and first dispatched units.
              Filters apply to order codes.
            </CardDescription>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={isExportingLead}
            onClick={() =>
              startLeadExport(() =>
                handleCsvExport(() =>
                  exportLeadTimesCsvAction({ from, to }),
                ),
              )
            }
          >
            {isExportingLead ? "Preparing…" : "Export lead times CSV"}
          </Button>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 md:grid-cols-3">
            <LeadStatCard label="Median (p50)" value={`${formatNumber(leadTimeStats.p50, 1)} days`} />
            <LeadStatCard label="90th percentile (p90)" value={`${formatNumber(leadTimeStats.p90, 1)} days`} />
            <LeadStatCard label="Sample size" value={formatNumber(leadTimeValues.length)} />
          </div>
          {leadTimeDistribution.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No dispatched orders match the filters.
            </p>
          ) : (
            <div className="h-[280px] w-full">
              <ResponsiveContainer>
                <BarChart data={leadTimeDistribution}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="days" label={{ value: "Days", position: "insideBottom", offset: -5 }} />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" name="Orders" fill="#2563eb" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="max-h-64 overflow-auto rounded-md border border-border/60">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Order date</TableHead>
                  <TableHead>First dispatch</TableHead>
                  <TableHead className="text-right">Days</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredLeadTimes.map((row) => (
                  <TableRow key={row.order_id}>
                    <TableCell className="font-medium">
                      {row.order_code}
                    </TableCell>
                    <TableCell>
                      {row.order_date
                        ? formatISODate(row.order_date, {
                            representation: "date",
                          })
                        : "—"}
                    </TableCell>
                    <TableCell>
                      {row.first_dispatch_date
                        ? formatISODate(row.first_dispatch_date, {
                            representation: "date",
                          })
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {row.days_order_to_dispatch === null
                        ? "—"
                        : formatNumber(row.days_order_to_dispatch, 1)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({
  value,
  label,
  href,
}: {
  value: string;
  label: string;
  href: string;
}) {
  return (
    <Link href={href} className="group">
      <Card className="transition group-hover:shadow-md">
        <CardHeader>
          <CardDescription>{label}</CardDescription>
          <CardTitle className="text-2xl">{value}</CardTitle>
        </CardHeader>
      </Card>
    </Link>
  );
}

function LeadStatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-xl">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}
