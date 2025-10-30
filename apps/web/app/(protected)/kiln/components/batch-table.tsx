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

export type BatchRow = {
  id: string;
  code: string;
  status: string;
  kilnCode: string | null;
  targetUnits: number | null;
  firedUnits: number;
  yieldPct: number | null;
  startedAt: string | null;
};

export function BatchTable({ batches }: { batches: BatchRow[] }) {
  const pathname = usePathname() ?? "/kiln";
  const searchParams = useSearchParams();
  const selectedId = searchParams?.get("batch") ?? undefined;
  const defaultSelectedId = selectedId ?? batches[0]?.id;

  if (batches.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border/60 p-6 text-sm text-muted-foreground">
        No planned or active kiln batches yet.
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Batch</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Kiln</TableHead>
          <TableHead className="text-right">Target</TableHead>
          <TableHead className="text-right">Fired</TableHead>
          <TableHead className="text-right">Yield %</TableHead>
          <TableHead>Started</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {batches.map((batch) => {
          const isActive = batch.id === defaultSelectedId;
          const params = new URLSearchParams(searchParams?.toString() ?? "");
          params.set("batch", batch.id);

          return (
            <TableRow
              key={batch.id}
              className={cn(
                "cursor-pointer",
                isActive ? "bg-primary/5" : "hover:bg-muted/60",
              )}
            >
              <TableCell className="font-medium text-foreground">
                <Link href={`${pathname}?${params.toString()}`}>
                  {batch.code}
                </Link>
              </TableCell>
              <TableCell className="capitalize text-sm text-muted-foreground">
                {batch.status}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {batch.kilnCode ?? "—"}
              </TableCell>
              <TableCell className="text-right font-mono text-xs text-muted-foreground">
                {batch.targetUnits !== null
                  ? batch.targetUnits.toFixed(0)
                  : "—"}
              </TableCell>
              <TableCell className="text-right font-mono text-xs text-muted-foreground">
                {batch.firedUnits.toFixed(0)}
              </TableCell>
              <TableCell className="text-right font-mono text-xs text-muted-foreground">
                {batch.yieldPct !== null ? batch.yieldPct.toFixed(1) : "—"}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {batch.startedAt
                  ? new Date(batch.startedAt).toLocaleString()
                  : "—"}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
