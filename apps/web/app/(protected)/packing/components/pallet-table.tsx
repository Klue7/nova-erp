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

export type PalletRow = {
  id: string;
  code: string;
  productSku: string;
  grade: string;
  status: string;
  locationCode: string | null;
  unitsOnPallet: number;
  unitsAvailable: number;
};

export function PalletTable({ pallets }: { pallets: PalletRow[] }) {
  const pathname = usePathname() ?? "/packing";
  const searchParams = useSearchParams();
  const selectedParam = searchParams?.get("pallet") ?? undefined;
  const selectedId = selectedParam ?? pallets[0]?.id;

  if (pallets.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border/60 p-6 text-sm text-muted-foreground">
        No pallets tracked yet. Create a pallet to begin.
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Pallet</TableHead>
          <TableHead>SKU</TableHead>
          <TableHead>Grade</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Location</TableHead>
          <TableHead className="text-right">Units</TableHead>
          <TableHead className="text-right">Available</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {pallets.map((pallet) => {
          const isActive = pallet.id === selectedId;
          const params = new URLSearchParams(searchParams?.toString() ?? "");
          params.set("pallet", pallet.id);
          return (
            <TableRow
              key={pallet.id}
              className={cn(
                "cursor-pointer",
                isActive ? "bg-primary/5" : "hover:bg-muted/60",
              )}
            >
              <TableCell className="font-medium text-foreground">
                <Link href={`${pathname}?${params.toString()}`}>{pallet.code}</Link>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {pallet.productSku}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {pallet.grade}
              </TableCell>
              <TableCell className="capitalize text-sm text-muted-foreground">
                {pallet.status}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {pallet.locationCode ?? "—"}
              </TableCell>
              <TableCell className="text-right font-mono text-xs text-muted-foreground">
                {pallet.unitsOnPallet.toFixed(0)}
              </TableCell>
              <TableCell className="text-right font-mono text-xs text-muted-foreground">
                {pallet.unitsAvailable.toFixed(0)}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
