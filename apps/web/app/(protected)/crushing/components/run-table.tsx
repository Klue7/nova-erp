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

export type RunRow = {
  id: string;
  code: string;
  status: string;
  inputTonnes: number;
  startedAt: string | null;
  tphNet: number | null;
};

export function RunTable({ runs }: { runs: RunRow[] }) {
  const pathname = usePathname() ?? "/crushing";
  const searchParams = useSearchParams();
  const selectedId = searchParams?.get("run") ?? undefined;
  const defaultSelectedId = selectedId ?? runs[0]?.id;

  if (runs.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border/60 p-6 text-sm text-muted-foreground">
        No planned or active runs yet.
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Run</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Inputs (t)</TableHead>
          <TableHead className="text-right">Net TPH</TableHead>
          <TableHead>Started</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {runs.map((run) => {
          const isActive = run.id === defaultSelectedId;
          const params = new URLSearchParams(searchParams?.toString() ?? "");
          params.set("run", run.id);

          return (
            <TableRow
              key={run.id}
              className={cn(
                "cursor-pointer",
                isActive ? "bg-primary/5" : "hover:bg-muted/60",
              )}
            >
              <TableCell className="font-medium text-foreground">
                <Link href={`${pathname}?${params.toString()}`}>{run.code}</Link>
              </TableCell>
              <TableCell className="capitalize text-sm text-muted-foreground">
                {run.status}
              </TableCell>
              <TableCell className="text-right font-mono text-xs text-muted-foreground">
                {run.inputTonnes.toFixed(2)}
              </TableCell>
              <TableCell className="text-right font-mono text-xs text-muted-foreground">
                {run.tphNet !== null ? run.tphNet.toFixed(2) : "—"}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {run.startedAt ? new Date(run.startedAt).toLocaleString() : "—"}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
