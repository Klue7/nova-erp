"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export type LoadRow = {
  id: string;
  code: string;
  rackCode: string | null;
  status: string;
  inputUnits: number;
  latestMoisturePct: number | null;
  dwellHours: number | null;
};

export function LoadsTable({ loads }: { loads: LoadRow[] }) {
  const pathname = usePathname() ?? "/dry-yard";
  const searchParams = useSearchParams();
  const selectedId = searchParams?.get("load") ?? undefined;
  const defaultSelectedId = selectedId ?? loads[0]?.id;

  if (loads.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border/60 p-6 text-sm text-muted-foreground">
        No planned or active loads yet.
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Load</TableHead>
          <TableHead>Rack</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Units</TableHead>
          <TableHead className="text-right">Moisture %</TableHead>
          <TableHead className="text-right">Dwell (h)</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {loads.map((load) => {
          const isActive = load.id === defaultSelectedId;
          const params = new URLSearchParams(searchParams?.toString() ?? "");
          params.set("load", load.id);

          return (
            <TableRow
              key={load.id}
              className={cn(
                "cursor-pointer",
                isActive ? "bg-primary/5" : "hover:bg-muted/60",
              )}
            >
              <TableCell className="font-medium text-foreground">
                <Link href={`${pathname}?${params.toString()}`}>
                  {load.code}
                </Link>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {load.rackCode ?? "—"}
              </TableCell>
              <TableCell className="capitalize text-sm text-muted-foreground">
                {load.status}
              </TableCell>
              <TableCell className="text-right font-mono text-xs text-muted-foreground">
                {load.inputUnits.toFixed(0)}
              </TableCell>
              <TableCell className="text-right font-mono text-xs text-muted-foreground">
                {load.latestMoisturePct !== null
                  ? load.latestMoisturePct.toFixed(1)
                  : "—"}
              </TableCell>
              <TableCell className="text-right font-mono text-xs text-muted-foreground">
                {load.dwellHours !== null ? load.dwellHours.toFixed(1) : "—"}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
