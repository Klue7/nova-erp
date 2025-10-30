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

export type ShipmentRow = {
  id: string;
  code: string;
  status: string;
  customerName: string | null;
  totalUnitsPicked: number;
  netKgEstimate: number | null;
  createdAt: string | null;
};

function formatDate(value: string | null) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return "—";
  }
}

export function ShipmentsTable({ shipments }: { shipments: ShipmentRow[] }) {
  const pathname = usePathname() ?? "/dispatch";
  const searchParams = useSearchParams();
  const selected = searchParams?.get("shipment");
  const activeId = selected ?? shipments[0]?.id;

  if (shipments.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border/60 p-6 text-sm text-muted-foreground">
        No shipments yet. Use the Create Shipment action to plan the first outbound load.
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Shipment</TableHead>
          <TableHead>Customer</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Units</TableHead>
          <TableHead className="text-right">Net kg</TableHead>
          <TableHead>Created</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {shipments.map((shipment) => {
          const params = new URLSearchParams(searchParams?.toString() ?? "");
          params.set("shipment", shipment.id);
          const isActive = shipment.id === activeId;
          return (
            <TableRow
              key={shipment.id}
              className={cn(
                "cursor-pointer",
                isActive ? "bg-primary/5" : "hover:bg-muted/60",
              )}
            >
              <TableCell className="font-medium text-foreground">
                <Link href={`${pathname}?${params.toString()}`}>{shipment.code}</Link>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {shipment.customerName ?? "—"}
              </TableCell>
              <TableCell className="capitalize text-sm text-muted-foreground">
                {shipment.status.replace(/_/g, " ")}
              </TableCell>
              <TableCell className="text-right font-mono text-xs text-muted-foreground">
                {shipment.totalUnitsPicked.toFixed(0)}
              </TableCell>
              <TableCell className="text-right font-mono text-xs text-muted-foreground">
                {shipment.netKgEstimate !== null
                  ? shipment.netKgEstimate.toFixed(0)
                  : "—"}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {formatDate(shipment.createdAt)}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
