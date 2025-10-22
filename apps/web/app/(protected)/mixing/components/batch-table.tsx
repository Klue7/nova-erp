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
  totalInputTonnes: number;
  startedAt: string | null;
};

export function BatchTable({ batches }: { batches: BatchRow[] }) {
  const pathname = usePathname() ?? "/mixing";
  const searchParams = useSearchParams();
  const selectedId = searchParams?.get("batch") ?? undefined;
  const defaultSelectedId = selectedId ?? batches[0]?.id;

  if (batches.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border/60 p-6 text-sm text-muted-foreground">
        No planned or active batches yet.
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Batch</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Inputs (t)</TableHead>
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
                <Link href={`${pathname}?${params.toString()}`}>{batch.code}</Link>
              </TableCell>
              <TableCell className="capitalize text-sm text-muted-foreground">
                {batch.status}
              </TableCell>
              <TableCell className="text-right font-mono text-xs text-muted-foreground">
                {batch.totalInputTonnes.toFixed(2)}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {batch.startedAt ? new Date(batch.startedAt).toLocaleString() : "—"}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
