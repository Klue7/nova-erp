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

export type SalesOrderRow = {
  id: string;
  code: string;
  status: string;
  customerName: string;
  customerCode: string | null;
  totalUnits: number;
  reservedUnits: number;
  shippedUnits: number;
  valueEstimate: number;
  currency: string | null;
  createdAt: string | null;
};

export function OrdersTable({ orders }: { orders: SalesOrderRow[] }) {
  const pathname = usePathname() ?? "/sales";
  const searchParams = useSearchParams();
  const selectedId = searchParams?.get("order") ?? undefined;
  const fallbackId = selectedId ?? orders[0]?.id;

  if (orders.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border/60 p-6 text-sm text-muted-foreground">
        No sales orders yet. Create one to get started.
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Order</TableHead>
          <TableHead>Customer</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Units</TableHead>
          <TableHead className="text-right">Reserved</TableHead>
          <TableHead className="text-right">Shipped</TableHead>
          <TableHead className="text-right">Value (est)</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {orders.map((order) => {
          const isActive = order.id === fallbackId;
          const params = new URLSearchParams(searchParams?.toString() ?? "");
          params.set("order", order.id);
          return (
            <TableRow
              key={order.id}
              className={cn(
                "cursor-pointer transition-colors",
                isActive ? "bg-primary/5" : "hover:bg-muted/60",
              )}
            >
              <TableCell className="font-medium">
                <Link href={`${pathname}?${params.toString()}`}>{order.code}</Link>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {order.customerName || "Unassigned"}
              </TableCell>
              <TableCell className="capitalize text-sm text-muted-foreground">
                {order.status}
              </TableCell>
              <TableCell className="text-right font-mono text-xs">
                {order.totalUnits.toFixed(1)}
              </TableCell>
              <TableCell className="text-right font-mono text-xs">
                {order.reservedUnits.toFixed(1)}
              </TableCell>
              <TableCell className="text-right font-mono text-xs">
                {order.shippedUnits.toFixed(1)}
              </TableCell>
              <TableCell className="text-right font-mono text-xs text-muted-foreground">
                {order.valueEstimate === 0
                  ? "—"
                  : order.valueEstimate.toLocaleString(undefined, {
                      style: "currency",
                      currency: order.currency ?? "ZAR",
                      maximumFractionDigits: 0,
                    })}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
