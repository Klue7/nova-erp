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
  pressLine: string | null;
  dieCode: string | null;
  outputUnits: number;
  uphNet: number | null;
};

export function RunTable({ runs }: { runs: RunRow[] }) {
  const pathname = usePathname() ?? "/extrusion";
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
          <TableHead>Press line</TableHead>
          <TableHead>Die</TableHead>
          <TableHead className="text-right">Output (units)</TableHead>
          <TableHead className="text-right">Net UPH</TableHead>
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
                <Link href={`${pathname}?${params.toString()}`}>
                  {run.code}
                </Link>
              </TableCell>
              <TableCell className="capitalize text-sm text-muted-foreground">
                {run.status}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {run.pressLine ?? "—"}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {run.dieCode ?? "—"}
              </TableCell>
              <TableCell className="text-right font-mono text-xs text-muted-foreground">
                {run.outputUnits.toFixed(0)}
              </TableCell>
              <TableCell className="text-right font-mono text-xs text-muted-foreground">
                {run.uphNet !== null ? run.uphNet.toFixed(2) : "—"}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
