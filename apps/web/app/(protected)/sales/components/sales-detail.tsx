"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm, type UseFormReturn } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
  addLineAction,
  cancelOrderAction,
  computeFulfillmentAction,
  confirmOrderAction,
  releaseReservationAction,
  reserveFromPalletAction,
  removeLineAction,
} from "../actions";
import type { ProductRow } from "./sales-sidebar";

export type SelectedOrder = {
  id: string;
  code: string;
  status: string;
  customerName: string;
  customerCode: string | null;
  totalUnits: number;
  totalValue: number;
  reservedUnits: number;
  shippedUnits: number;
  currency: string | null;
  createdAt: string | null;
  confirmedAt: string | null;
};

export type OrderLineRow = {
  productId: string;
  sku: string;
  quantityUnits: number;
  lineValue: number;
  currency: string | null;
};

export type ReservationRow = {
  palletId: string;
  palletCode: string;
  unitsReserved: number;
};

export type AvailablePalletRow = {
  palletId: string;
  code: string;
  productSku: string | null;
  grade: string | null;
  locationCode: string | null;
  unitsAvailable: number;
};

type SalesDetailProps = {
  order: SelectedOrder | null;
  lines: OrderLineRow[];
  reservations: ReservationRow[];
  availablePallets: AvailablePalletRow[];
  products: ProductRow[];
};

export function SalesDetail({
  order,
  lines,
  reservations,
  availablePallets,
  products,
}: SalesDetailProps) {
  const router = useRouter();

  if (!order) {
    return (
      <Card className="border-dashed">
        <CardHeader>
          <CardTitle>No order selected</CardTitle>
          <CardDescription>
            Choose an order from the list to manage lines, reservations, and fulfilment.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Once you create an order it will appear here with actions to progress it from quote to
            dispatch.
          </p>
        </CardContent>
      </Card>
    );
  }

  const handleActionResult = async (
    action: () => Promise<{ ok: boolean; error?: string }>,
    successMessage = "Changes saved.",
  ) => {
    const result = await action();
    if (result.ok) {
      toast({ title: "Success", description: successMessage });
      router.refresh();
      return true;
    }
    toast({
      title: "Action failed",
      description: result.error ?? "Unknown error",
      variant: "destructive",
    });
    return false;
  };

  const currency = order.currency ?? "ZAR";

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-xl">{order.code}</CardTitle>
            <CardDescription>
              {order.customerName}
              {order.customerCode ? ` · ${order.customerCode}` : ""}
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() =>
                handleActionResult(
                  () => confirmOrderAction({ orderId: order.id }),
                  "Order confirmed.",
                )
              }
              disabled={order.status === "confirmed"}
            >
              {order.status === "confirmed" ? "Confirmed" : "Confirm Order"}
            </Button>
            <ComputeFulfilmentButton orderId={order.id} />
            <Button variant="outline" asChild>
              <Link href={`/dispatch?fromOrder=${order.id}`}>Create Shipment Draft</Link>
            </Button>
            <CancelOrderDialog orderId={order.id} onCompleted={handleActionResult} />
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Ordered units" value={order.totalUnits.toFixed(1)} accent />
          <Metric
            label="Reserved units"
            value={order.reservedUnits.toFixed(1)}
            trend={order.reservedUnits / Math.max(order.totalUnits, 1)}
          />
          <Metric
            label="Shipped units"
            value={order.shippedUnits.toFixed(1)}
            trend={order.shippedUnits / Math.max(order.totalUnits, 1)}
          />
          <Metric
            label="Order value (est)"
            value={
              order.totalValue === 0
                ? "—"
                : order.totalValue.toLocaleString(undefined, {
                    style: "currency",
                    currency,
                    maximumFractionDigits: 0,
                  })
            }
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Order Lines</CardTitle>
            <CardDescription>Items requested by the customer and pricing context.</CardDescription>
          </div>
          <div className="flex gap-2">
            <AddLineDialog
              orderId={order.id}
              products={products}
              onCompleted={handleActionResult}
            />
            <RemoveLineDialog orderId={order.id} lines={lines} onCompleted={handleActionResult} />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <LinesTable lines={lines} currency={currency} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Reservations</CardTitle>
            <CardDescription>
              Link pallets to this order to guarantee fulfilment quantities.
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <ReserveDialog
              orderId={order.id}
              pallets={availablePallets}
              onCompleted={handleActionResult}
            />
            <ReleaseReservationDialog
              orderId={order.id}
              reservations={reservations}
              onCompleted={handleActionResult}
            />
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-2">
          <ReservationsTable reservations={reservations} />
          <AvailablePalletsTable pallets={availablePallets} />
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({
  label,
  value,
  trend,
  accent,
}: {
  label: string;
  value: string;
  trend?: number;
  accent?: boolean;
}) {
  const percentage = trend && Number.isFinite(trend) ? Math.round(trend * 100) : null;
  return (
    <div
      className={`rounded-lg border border-border/60 p-4 ${
        accent ? "bg-primary/5 text-primary-foreground" : "bg-muted/40"
      }`}
    >
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-2 text-lg font-semibold text-foreground">{value}</p>
      {percentage !== null && (
        <p className="text-xs text-muted-foreground">
          {percentage >= 100 ? "Fully allocated" : `${percentage}% of ordered`}
        </p>
      )}
    </div>
  );
}

function LinesTable({ lines, currency }: { lines: OrderLineRow[]; currency: string }) {
  if (lines.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border/60 p-6 text-sm text-muted-foreground">
        No lines yet. Add a product to start tracking demand.
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>SKU</TableHead>
          <TableHead className="text-right">Quantity</TableHead>
          <TableHead className="text-right">Value</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {lines.map((line) => (
          <TableRow key={`${line.productId}-${line.sku}`}>
            <TableCell className="font-medium">{line.sku}</TableCell>
            <TableCell className="text-right font-mono text-xs">
              {line.quantityUnits.toFixed(1)}
            </TableCell>
            <TableCell className="text-right font-mono text-xs text-muted-foreground">
              {line.lineValue === 0
                ? "—"
                : line.lineValue.toLocaleString(undefined, {
                    style: "currency",
                    currency: line.currency ?? currency,
                    maximumFractionDigits: 0,
                  })}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ReservationsTable({ reservations }: { reservations: ReservationRow[] }) {
  if (reservations.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border/60 p-6 text-sm text-muted-foreground">
        No reservations yet. Allocate pallets so production can plan dispatch.
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Pallet</TableHead>
          <TableHead className="text-right">Reserved units</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {reservations.map((reservation) => (
          <TableRow key={reservation.palletId}>
            <TableCell className="font-medium">{reservation.palletCode}</TableCell>
            <TableCell className="text-right font-mono text-xs">
              {reservation.unitsReserved.toFixed(1)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function AvailablePalletsTable({ pallets }: { pallets: AvailablePalletRow[] }) {
  if (pallets.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border/60 p-6 text-sm text-muted-foreground">
        No free pallets found. Build new pallets in Packing or release reservations.
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Pallet</TableHead>
          <TableHead>SKU / Grade</TableHead>
          <TableHead>Location</TableHead>
          <TableHead className="text-right">Available</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {pallets.map((pallet) => (
          <TableRow key={pallet.palletId}>
            <TableCell className="font-medium">{pallet.code}</TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {pallet.productSku ?? "—"}
              {pallet.grade ? ` · ${pallet.grade}` : ""}
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {pallet.locationCode ?? "—"}
            </TableCell>
            <TableCell className="text-right font-mono text-xs">
              {pallet.unitsAvailable.toFixed(1)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

const addLineSchema = z.object({
  orderId: z.string().uuid(),
  productId: z.string().uuid("Select a product"),
  sku: z.string().min(1, "SKU required"),
  quantityUnits: z
    .union([z.number(), z.string()])
    .transform((value) => Number(value))
    .refine((value) => Number.isFinite(value) && value > 0, {
      message: "Quantity must be greater than zero",
    }),
});

function AddLineDialog({
  orderId,
  products,
  onCompleted,
}: {
  orderId: string;
  products: ProductRow[];
  onCompleted: (
    action: () => Promise<{ ok: boolean; error?: string }>,
    successMessage?: string,
  ) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const form = useForm<z.infer<typeof addLineSchema>>({
    resolver: zodResolver(addLineSchema),
    defaultValues: {
      orderId,
      productId: products[0]?.id ?? "",
      sku: products[0]?.sku ?? "",
      quantityUnits: 1,
    },
  });

  const options = useMemo(
    () =>
      products.map((product) => ({
        value: product.id,
        label: `${product.sku}${product.name ? ` · ${product.name}` : ""}`,
        sku: product.sku,
      })),
    [products],
  );

  const updateSku = (productId: string) => {
    const option = options.find((item) => item.value === productId);
    if (option) {
      form.setValue("sku", option.sku);
    }
  };

  const submit = form.handleSubmit((values) => {
    startTransition(async () => {
      const ok = await onCompleted(() =>
        addLineAction({
          orderId,
          productId: values.productId,
          sku: values.sku,
          quantityUnits: values.quantityUnits,
        }),
      );
      if (ok) {
        setOpen(false);
        form.reset({
          orderId,
          productId: products[0]?.id ?? "",
          sku: products[0]?.sku ?? "",
          quantityUnits: 1,
        });
      }
    });
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">Add Line</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Order Line</DialogTitle>
          <DialogDescription>Select product and quantity to append.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <input type="hidden" value={orderId} {...form.register("orderId")} />
          <div className="space-y-2">
            <Label htmlFor="add-line-product">Product</Label>
            <select
              id="add-line-product"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              {...form.register("productId")}
              onChange={(event) => {
                form.register("productId").onChange(event);
                updateSku(event.target.value);
              }}
            >
              <option value="">Select product</option>
              {options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <FormError form={form} field="productId" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="add-line-quantity">Quantity</Label>
            <Input
              id="add-line-quantity"
              type="number"
              min={0}
              step={1}
              {...form.register("quantityUnits")}
            />
            <FormError form={form} field="quantityUnits" />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Adding..." : "Add line"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const removeLineSchema = z.object({
  orderId: z.string().uuid(),
  productId: z.string().uuid("Select a line"),
  sku: z.string().min(1, "SKU required"),
  quantityUnits: z
    .union([z.number(), z.string()])
    .transform((value) => Number(value))
    .refine((value) => Number.isFinite(value) && value > 0, {
      message: "Quantity must be greater than zero",
    }),
});

function RemoveLineDialog({
  orderId,
  lines,
  onCompleted,
}: {
  orderId: string;
  lines: OrderLineRow[];
  onCompleted: (
    action: () => Promise<{ ok: boolean; error?: string }>,
    successMessage?: string,
  ) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const lineOptions = useMemo(
    () =>
      lines.map((line) => ({
        value: line.productId,
        label: `${line.sku} (${line.quantityUnits.toFixed(1)} units)`,
        sku: line.sku,
        quantity: line.quantityUnits,
      })),
    [lines],
  );

  const form = useForm<z.infer<typeof removeLineSchema>>({
    resolver: zodResolver(removeLineSchema),
    defaultValues: {
      orderId,
      productId: lineOptions[0]?.value ?? "",
      sku: lineOptions[0]?.sku ?? "",
      quantityUnits: lineOptions[0]?.quantity ?? 1,
    },
  });

  const updateSku = (productId: string) => {
    const option = lineOptions.find((item) => item.value === productId);
    if (option) {
      form.setValue("sku", option.sku);
      form.setValue("quantityUnits", option.quantity);
    }
  };

  const submit = form.handleSubmit((values) => {
    startTransition(async () => {
      const ok = await onCompleted(() =>
        removeLineAction({
          orderId,
          productId: values.productId,
          sku: values.sku,
          quantityUnits: values.quantityUnits,
        }),
      );
      if (ok) {
        setOpen(false);
      }
    });
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" disabled={lines.length === 0}>
          Remove Line
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Remove Units</DialogTitle>
          <DialogDescription>Decrease ordered quantity for a product.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <input type="hidden" value={orderId} {...form.register("orderId")} />
          <div className="space-y-2">
            <Label htmlFor="remove-line-product">Order line</Label>
            <select
              id="remove-line-product"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              {...form.register("productId")}
              onChange={(event) => {
                form.register("productId").onChange(event);
                updateSku(event.target.value);
              }}
            >
              <option value="">Select line</option>
              {lineOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <FormError form={form} field="productId" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="remove-line-quantity">Quantity to remove</Label>
            <Input
              id="remove-line-quantity"
              type="number"
              min={0}
              step={1}
              {...form.register("quantityUnits")}
            />
            <FormError form={form} field="quantityUnits" />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Removing..." : "Remove"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const reserveSchema = z.object({
  orderId: z.string().uuid(),
  palletId: z.string().uuid("Select a pallet"),
  quantityUnits: z
    .union([z.number(), z.string()])
    .transform((value) => Number(value))
    .refine((value) => Number.isFinite(value) && value > 0, {
      message: "Quantity must be greater than zero",
    }),
});

function ReserveDialog({
  orderId,
  pallets,
  onCompleted,
}: {
  orderId: string;
  pallets: AvailablePalletRow[];
  onCompleted: (
    action: () => Promise<{ ok: boolean; error?: string }>,
    successMessage?: string,
  ) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const form = useForm<z.infer<typeof reserveSchema>>({
    resolver: zodResolver(reserveSchema),
    defaultValues: {
      orderId,
      palletId: pallets[0]?.palletId ?? "",
      quantityUnits: pallets[0]?.unitsAvailable ?? 1,
    },
  });

  const submit = form.handleSubmit((values) => {
    startTransition(async () => {
      const ok = await onCompleted(() =>
        reserveFromPalletAction({
          orderId,
          palletId: values.palletId,
          quantityUnits: values.quantityUnits,
        }),
      );
      if (ok) {
        setOpen(false);
      }
    });
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" disabled={pallets.length === 0}>
          Reserve
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reserve Pallet Units</DialogTitle>
          <DialogDescription>Locks pallet stock to this order.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <input type="hidden" value={orderId} {...form.register("orderId")} />
          <div className="space-y-2">
            <Label htmlFor="reserve-pallet">Pallet</Label>
            <select
              id="reserve-pallet"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              {...form.register("palletId")}
            >
              <option value="">Select pallet</option>
              {pallets.map((pallet) => (
                <option key={pallet.palletId} value={pallet.palletId}>
                  {pallet.code} · {pallet.unitsAvailable.toFixed(1)} units free
                </option>
              ))}
            </select>
            <FormError form={form} field="palletId" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="reserve-quantity">Quantity</Label>
            <Input
              id="reserve-quantity"
              type="number"
              min={0}
              step={1}
              {...form.register("quantityUnits")}
            />
            <FormError form={form} field="quantityUnits" />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Reserving..." : "Reserve"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const releaseSchema = z.object({
  orderId: z.string().uuid(),
  palletId: z.string().uuid("Select a reservation"),
  quantityUnits: z
    .union([z.number(), z.string()])
    .transform((value) => Number(value))
    .refine((value) => Number.isFinite(value) && value > 0, {
      message: "Quantity must be greater than zero",
    }),
});

function ReleaseReservationDialog({
  orderId,
  reservations,
  onCompleted,
}: {
  orderId: string;
  reservations: ReservationRow[];
  onCompleted: (
    action: () => Promise<{ ok: boolean; error?: string }>,
    successMessage?: string,
  ) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const form = useForm<z.infer<typeof releaseSchema>>({
    resolver: zodResolver(releaseSchema),
    defaultValues: {
      orderId,
      palletId: reservations[0]?.palletId ?? "",
      quantityUnits: reservations[0]?.unitsReserved ?? 1,
    },
  });

  const submit = form.handleSubmit((values) => {
    startTransition(async () => {
      const ok = await onCompleted(() =>
        releaseReservationAction({
          orderId,
          palletId: values.palletId,
          quantityUnits: values.quantityUnits,
        }),
      );
      if (ok) {
        setOpen(false);
      }
    });
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" disabled={reservations.length === 0}>
          Release
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Release Reservation</DialogTitle>
          <DialogDescription>Return units on a pallet to available inventory.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <input type="hidden" value={orderId} {...form.register("orderId")} />
          <div className="space-y-2">
            <Label htmlFor="release-reservation">Reservation</Label>
            <select
              id="release-reservation"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              {...form.register("palletId")}
            >
              <option value="">Select reservation</option>
              {reservations.map((reservation) => (
                <option key={reservation.palletId} value={reservation.palletId}>
                  {reservation.palletCode} · {reservation.unitsReserved.toFixed(1)} units
                </option>
              ))}
            </select>
            <FormError form={form} field="palletId" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="release-quantity">Quantity</Label>
            <Input
              id="release-quantity"
              type="number"
              min={0}
              step={1}
              {...form.register("quantityUnits")}
            />
            <FormError form={form} field="quantityUnits" />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Releasing..." : "Release"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const cancelSchema = z.object({
  orderId: z.string().uuid(),
  reason: z.string().trim().optional(),
});

function CancelOrderDialog({
  orderId,
  onCompleted,
}: {
  orderId: string;
  onCompleted: (
    action: () => Promise<{ ok: boolean; error?: string }>,
    successMessage?: string,
  ) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const form = useForm<z.infer<typeof cancelSchema>>({
    resolver: zodResolver(cancelSchema),
    defaultValues: {
      orderId,
      reason: "",
    },
  });

  const submit = form.handleSubmit((values) => {
    startTransition(async () => {
      const ok = await onCompleted(
        () =>
          cancelOrderAction({
            orderId,
            reason: values.reason ?? undefined,
          }),
        "Order cancelled.",
      );
      if (ok) {
        setOpen(false);
      }
    });
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="destructive" size="sm">
          Cancel Order
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cancel this order?</DialogTitle>
          <DialogDescription>
            All reservations will be released automatically and the order will move to{" "}
            <strong>cancelled</strong>.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <input type="hidden" value={orderId} {...form.register("orderId")} />
          <div className="space-y-2">
            <Label htmlFor="cancel-reason">Reason (optional)</Label>
            <Input
              id="cancel-reason"
              placeholder="Customer cancelled"
              {...form.register("reason")}
            />
            <FormError form={form} field="reason" />
          </div>
          <DialogFooter>
            <Button type="submit" variant="destructive" disabled={isPending}>
              {isPending ? "Cancelling..." : "Cancel order"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ComputeFulfilmentButton({ orderId }: { orderId: string }) {
  const [isPending, startTransition] = useTransition();

  const handleClick = () => {
    startTransition(async () => {
      const result = await computeFulfillmentAction({ orderId });
      if (result.ok && result.data) {
        toast({
          title: "Fulfilment status",
          description: `Shipped ${result.data.shippedUnits.toFixed(1)} of ${result.data.totalUnits.toFixed(
            1,
          )} units (${result.data.fulfilmentPct}% complete).`,
        });
      } else if (!result.ok) {
        toast({
          title: "Unable to compute fulfilment",
          description: result.error ?? "Unknown error",
          variant: "destructive",
        });
      }
    });
  };

  return (
    <Button variant="outline" size="sm" onClick={handleClick} disabled={isPending}>
      {isPending ? "Calculating..." : "Fulfilment"}
    </Button>
  );
}

function FormError({
  form,
  field,
}: {
  form: UseFormReturn<any>;
  field: string;
}) {
  const message = form.formState.errors[field]?.message;
  if (!message) return null;
  return <p className="text-xs text-destructive">{String(message)}</p>;
}
