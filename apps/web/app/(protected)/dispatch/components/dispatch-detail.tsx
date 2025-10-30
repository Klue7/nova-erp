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
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import {
  addPickAction,
  cancelShipmentAction,
  createPicklistAction,
  createShipmentAction,
  finalizeDispatchAction,
  removePickAction,
  setAddressAction,
  setCarrierAction,
  weighbridgeInAction,
  weighbridgeOutAction,
} from "../actions";

export type DispatchDetailProps = {
  shipment: ShipmentSummary | null;
  picks: PickItem[];
  availablePallets: AvailablePallet[];
  weighbridge: WeighbridgeInfo | null;
  events: DispatchEvent[];
};

export type ShipmentSummary = {
  id: string;
  code: string;
  status: string;
  customerCode: string | null;
  customerName: string | null;
  deliveryAddress: Record<string, unknown> | null;
  carrier: string | null;
  vehicleReg: string | null;
  trailerReg: string | null;
  sealNo: string | null;
  createdAt: string | null;
  dispatchedAt: string | null;
};

export type PickItem = {
  palletId: string;
  palletCode: string;
  productSku: string | null;
  grade: string | null;
  unitsPicked: number;
};

export type AvailablePallet = {
  palletId: string;
  code: string;
  productSku: string | null;
  grade: string | null;
  locationCode: string | null;
  unitsAvailable: number;
};

export type WeighbridgeInfo = {
  inGrossKg: number | null;
  inTareKg: number | null;
  outGrossKg: number | null;
  outTareKg: number | null;
  netKgEstimate: number | null;
};

export type DispatchEvent = {
  occurredAt: string;
  eventType: string;
  description: string;
};

type FormHook = UseFormReturn<any>;

function FormError({ form, field }: { form: FormHook; field: string }) {
  const message = form.formState.errors[field]?.message;
  if (!message) return null;
  return <p className="text-xs text-destructive">{String(message)}</p>;
}

const addressSchema = z.object({
  shipmentId: z.string().uuid(),
  addressLine1: z.string().trim().optional(),
  addressLine2: z.string().trim().optional(),
  city: z.string().trim().optional(),
  state: z.string().trim().optional(),
  postalCode: z.string().trim().optional(),
  country: z.string().trim().optional(),
});

const carrierSchema = z.object({
  shipmentId: z.string().uuid(),
  carrier: z.string().min(1, "Carrier is required"),
  vehicleReg: z.string().trim().optional(),
  trailerReg: z.string().trim().optional(),
  sealNo: z.string().trim().optional(),
});

export const pickSchema = z.object({
  shipmentId: z.string().uuid(),
  palletId: z.string().uuid({ message: "Select a pallet" }),
  quantityUnits: z
    .union([z.number(), z.string()])
    .transform((value) => Number(value))
    .refine((value) => Number.isFinite(value) && value > 0, {
      message: "Quantity must be greater than zero",
    }),
  productSku: z.string().trim().optional(),
  grade: z.string().trim().optional(),
  orderId: z.string().trim().optional(),
});

export const removePickSchema = z.object({
  shipmentId: z.string().uuid(),
  palletId: z.string().uuid({ message: "Select a pick" }),
  quantityUnits: z
    .union([z.number(), z.string()])
    .transform((value) => Number(value))
    .refine((value) => Number.isFinite(value) && value > 0, {
      message: "Quantity must be greater than zero",
    }),
  orderId: z.string().trim().optional(),
});

export const weighSchema = z.object({
  shipmentId: z.string().uuid(),
  grossKg: z
    .union([z.number(), z.string()])
    .transform((value) => Number(value))
    .refine((value) => Number.isFinite(value) && value > 0, {
      message: "Gross weight must be greater than zero",
    }),
  tareKg: z
    .union([z.number(), z.string(), z.null(), z.undefined()])
    .transform((value) => {
      if (value === undefined || value === null || value === "") return undefined;
      const num = typeof value === "string" ? Number(value) : value;
      return Number.isFinite(num) ? num : Number.NaN;
    })
    .refine((value) => value === undefined || Number.isFinite(value), {
      message: "Tare must be numeric",
    })
    .optional(),
});

const createShipmentSchema = z.object({
  code: z.string().min(1, "Code is required"),
  customerCode: z.string().trim().optional(),
  customerName: z.string().min(1, "Customer name is required"),
  addressLine1: z.string().trim().optional(),
  addressLine2: z.string().trim().optional(),
  city: z.string().trim().optional(),
  state: z.string().trim().optional(),
  postalCode: z.string().trim().optional(),
  country: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

export function DispatchDetail({
  shipment,
  picks,
  availablePallets,
  weighbridge,
  events,
}: DispatchDetailProps) {
  const router = useRouter();
  const [search, setSearch] = useState("");

  const filteredPallets = useMemo(() => {
    if (!search.trim()) return availablePallets.slice(0, 25);
    const term = search.trim().toLowerCase();
    return availablePallets
      .filter((pallet) =>
        [pallet.code, pallet.productSku, pallet.grade, pallet.locationCode]
          .filter(Boolean)
          .some((value) => value?.toLowerCase().includes(term)),
      )
      .slice(0, 25);
  }, [availablePallets, search]);

  if (!shipment) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Dispatch detail</CardTitle>
          <CardDescription>Plan a shipment to start dispatching pallets.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              No shipments yet. Create the first shipment to build a pick list and produce a delivery note.
            </p>
            <CreateShipmentDialog onComplete={() => router.refresh()} />
          </div>
        </CardContent>
      </Card>
    );
  }

  const isFinalised = shipment.status === "dispatched" || shipment.status === "cancelled";

  return (
    <Card className="space-y-6 p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-foreground">{shipment.code}</h2>
          <p className="text-sm text-muted-foreground">
            {shipment.customerName ?? "Customer unknown"}
            {shipment.customerCode ? ` • ${shipment.customerCode}` : ""}
          </p>
          <StatusBadge status={shipment.status} />
        </div>
        <div className="flex flex-wrap gap-2">
          <CreateShipmentDialog onComplete={() => router.refresh()} variant="outline" />
          <SetCarrierDialog shipment={shipment} disabled={isFinalised} onComplete={() => router.refresh()} />
          <SetAddressDialog shipment={shipment} disabled={isFinalised} onComplete={() => router.refresh()} />
          <CreatePicklistButton
            shipment={shipment}
            disabled={isFinalised || shipment.status !== "planned"}
            onComplete={() => router.refresh()}
          />
          <FinalizeDispatchButton shipment={shipment} disabled={isFinalised} onComplete={() => router.refresh()} />
          <CancelShipmentDialog shipment={shipment} disabled={isFinalised} onComplete={() => router.refresh()} />
          <Button variant="secondary" asChild>
            <Link href={`/dispatch/dn/${shipment.id}`} target="_blank">
              Print DN
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-lg border border-border/60 bg-card p-4">
          <header className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Pick list</h3>
              <p className="text-xs text-muted-foreground">
                Reserve pallets for this shipment and adjust quantities as needed.
              </p>
            </div>
            <div className="flex gap-2">
              <AddPickDialog
                shipment={shipment}
                pallets={availablePallets}
                disabled={isFinalised}
                onComplete={() => router.refresh()}
              />
              <RemovePickDialog
                shipment={shipment}
                picks={picks}
                disabled={isFinalised || picks.length === 0}
                onComplete={() => router.refresh()}
              />
            </div>
          </header>
          {picks.length === 0 ? (
            <p className="text-sm text-muted-foreground">No picks yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pallet</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Grade</TableHead>
                  <TableHead className="text-right">Units</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {picks.map((pick) => (
                  <TableRow key={pick.palletId}>
                    <TableCell className="font-medium text-foreground">{pick.palletCode}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {pick.productSku ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{pick.grade ?? "—"}</TableCell>
                    <TableCell className="text-right font-mono text-xs text-muted-foreground">
                      {pick.unitsPicked.toFixed(0)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>

        <section className="rounded-lg border border-border/60 bg-card p-4">
          <header className="mb-4">
            <h3 className="text-sm font-semibold text-foreground">Available pallets</h3>
            <p className="text-xs text-muted-foreground">
              Live inventory after reserved and shipped units are considered.
            </p>
          </header>
          <Input
            placeholder="Search by code, SKU, grade, or location"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="mb-3"
          />
          {filteredPallets.length === 0 ? (
            <p className="text-sm text-muted-foreground">No pallets match the filter.</p>
          ) : (
            <div className="max-h-72 overflow-y-auto rounded-md border border-border/40">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Pallet</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>Grade</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead className="text-right">Available</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredPallets.map((pallet) => (
                    <TableRow key={pallet.palletId}>
                      <TableCell className="font-medium text-foreground">{pallet.code}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {pallet.productSku ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{pallet.grade ?? "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{pallet.locationCode ?? "—"}</TableCell>
                      <TableCell className="text-right font-mono text-xs text-muted-foreground">
                        {pallet.unitsAvailable.toFixed(0)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      </div>

      <section className="rounded-lg border border-border/60 bg-card p-4">
        <header className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Weighbridge</h3>
            <p className="text-xs text-muted-foreground">
              Capture weigh-in and weigh-out to estimate net tonnage.
            </p>
          </div>
          <div className="flex gap-2">
            <WeighbridgeDialog
              mode="in"
              shipmentId={shipment.id}
              disabled={isFinalised}
              onComplete={() => router.refresh()}
            />
            <WeighbridgeDialog
              mode="out"
              shipmentId={shipment.id}
              disabled={isFinalised}
              onComplete={() => router.refresh()}
            />
          </div>
        </header>
        <div className="grid gap-4 text-sm md:grid-cols-4">
          <InfoTile label="Carrier" value={shipment.carrier ?? "Not set"} />
          <InfoTile label="Vehicle" value={shipment.vehicleReg ?? "—"} />
          <InfoTile label="Trailer" value={shipment.trailerReg ?? "—"} />
          <InfoTile label="Seal" value={shipment.sealNo ?? "—"} />
          <InfoTile label="Weigh-in gross (kg)" value={formatWeight(weighbridge?.inGrossKg)} />
          <InfoTile label="Weigh-in tare (kg)" value={formatWeight(weighbridge?.inTareKg)} />
          <InfoTile label="Weigh-out gross (kg)" value={formatWeight(weighbridge?.outGrossKg)} />
          <InfoTile
            label="Estimated net (kg)"
            value={formatWeight(weighbridge?.netKgEstimate) ?? "—"}
            highlight
          />
        </div>
      </section>

      <section className="rounded-lg border border-border/60 bg-card p-4">
        <header className="mb-4">
          <h3 className="text-sm font-semibold text-foreground">Delivery address</h3>
          <p className="text-xs text-muted-foreground">Used for delivery notes and driver paperwork.</p>
        </header>
        <AddressPreview address={shipment.deliveryAddress} />
      </section>

      <section className="rounded-lg border border-border/60 bg-card p-4">
        <header className="mb-4">
          <h3 className="text-sm font-semibold text-foreground">Recent events</h3>
        </header>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No events logged yet.</p>
        ) : (
          <ul className="space-y-2 text-xs text-muted-foreground">
            {events.map((event) => (
              <li key={`${event.eventType}-${event.occurredAt}`}>
                <span className="font-medium text-foreground">
                  {new Date(event.occurredAt).toLocaleString()}
                </span>
                {": "}
                {event.description}
              </li>
            ))}
          </ul>
        )}
      </section>
    </Card>
  );
}

function InfoTile({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-md border border-border/50 bg-muted/30 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={highlight ? "text-lg font-semibold text-foreground" : "text-sm text-foreground"}>{value}</p>
    </div>
  );
}

function formatWeight(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return value.toFixed(0);
}

function StatusBadge({ status }: { status: string }) {
  const label = status.replace(/_/g, " ");
  return (
    <span className="mt-2 inline-flex items-center rounded-full border border-border/50 px-3 py-1 text-xs capitalize text-muted-foreground">
      {label}
    </span>
  );
}

function deliveryAddressToDefaults(address: Record<string, unknown> | null) {
  return {
    addressLine1: (address?.line1 as string | undefined) ?? "",
    addressLine2: (address?.line2 as string | undefined) ?? "",
    city: (address?.city as string | undefined) ?? "",
    state: (address?.state as string | undefined) ?? "",
    postalCode: (address?.postalCode as string | undefined) ?? "",
    country: (address?.country as string | undefined) ?? "",
  };
}

function CreateShipmentDialog({
  onComplete,
  variant = "default",
}: {
  onComplete: () => void;
  variant?: "default" | "outline";
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const form = useForm<z.infer<typeof createShipmentSchema>>({
    resolver: zodResolver(createShipmentSchema),
    defaultValues: {
      code: "",
      customerCode: "",
      customerName: "",
      addressLine1: "",
      addressLine2: "",
      city: "",
      state: "",
      postalCode: "",
      country: "",
      notes: "",
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const result = await createShipmentAction(values);
      if (result.ok) {
        toast({ title: "Shipment created" });
        setOpen(false);
        form.reset();
        onComplete();
      } else {
        toast({ title: "Action failed", description: result.error, variant: "destructive" });
      }
    });
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant === "outline" ? "outline" : "default"}>Create shipment</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create shipment</DialogTitle>
          <DialogDescription>Set the shipment code, customer, and optional delivery address.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="shipment-code">Shipment code</Label>
            <Input id="shipment-code" {...form.register("code")} />
            <FormError form={form} field="code" />
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="customer-name">Customer name</Label>
              <Input id="customer-name" {...form.register("customerName")} />
              <FormError form={form} field="customerName" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="customer-code">Customer code</Label>
              <Input id="customer-code" {...form.register("customerCode")} />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="address-line1">Address line 1</Label>
            <Input id="address-line1" {...form.register("addressLine1")} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="address-line2">Address line 2</Label>
            <Input id="address-line2" {...form.register("addressLine2")} />
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="city">City</Label>
              <Input id="city" {...form.register("city")} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="state">State/Province</Label>
              <Input id="state" {...form.register("state")} />
            </div>
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="postal-code">Postal code</Label>
              <Input id="postal-code" {...form.register("postalCode")} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="country">Country</Label>
              <Input id="country" {...form.register("country")} />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="notes">Notes (optional)</Label>
            <Textarea id="notes" rows={3} {...form.register("notes")} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SetCarrierDialog({
  shipment,
  disabled,
  onComplete,
}: {
  shipment: ShipmentSummary;
  disabled: boolean;
  onComplete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const form = useForm<z.infer<typeof carrierSchema>>({
    resolver: zodResolver(carrierSchema),
    defaultValues: {
      shipmentId: shipment.id,
      carrier: shipment.carrier ?? "",
      vehicleReg: shipment.vehicleReg ?? "",
      trailerReg: shipment.trailerReg ?? "",
      sealNo: shipment.sealNo ?? "",
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const result = await setCarrierAction(values);
      if (result.ok) {
        toast({ title: "Carrier updated" });
        setOpen(false);
        onComplete();
      } else {
        toast({ title: "Action failed", description: result.error, variant: "destructive" });
      }
    });
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={disabled}>
          Set carrier
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Carrier details</DialogTitle>
          <DialogDescription>Record the transporter and truck identifiers.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <input type="hidden" value={shipment.id} {...form.register("shipmentId")} />
          <div className="grid gap-2">
            <Label htmlFor="carrier-name">Carrier</Label>
            <Input id="carrier-name" {...form.register("carrier")} />
            <FormError form={form} field="carrier" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="vehicle-reg">Vehicle registration</Label>
            <Input id="vehicle-reg" {...form.register("vehicleReg")} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="trailer-reg">Trailer registration</Label>
            <Input id="trailer-reg" {...form.register("trailerReg")} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="seal-no">Seal number</Label>
            <Input id="seal-no" {...form.register("sealNo")} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SetAddressDialog({
  shipment,
  disabled,
  onComplete,
}: {
  shipment: ShipmentSummary;
  disabled: boolean;
  onComplete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const form = useForm<z.infer<typeof addressSchema>>({
    resolver: zodResolver(addressSchema),
    defaultValues: {
      shipmentId: shipment.id,
      ...deliveryAddressToDefaults(shipment.deliveryAddress),
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const result = await setAddressAction(values);
      if (result.ok) {
        toast({ title: "Address updated" });
        setOpen(false);
        onComplete();
      } else {
        toast({ title: "Action failed", description: result.error, variant: "destructive" });
      }
    });
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={disabled}>
          Set address
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Delivery address</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <input type="hidden" value={shipment.id} {...form.register("shipmentId")} />
          <div className="grid gap-2">
            <Label htmlFor="addr-line1">Address line 1</Label>
            <Input id="addr-line1" {...form.register("addressLine1")} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="addr-line2">Address line 2</Label>
            <Input id="addr-line2" {...form.register("addressLine2")} />
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="addr-city">City</Label>
              <Input id="addr-city" {...form.register("city")} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="addr-state">State/Province</Label>
              <Input id="addr-state" {...form.register("state")} />
            </div>
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="addr-postal">Postal code</Label>
              <Input id="addr-postal" {...form.register("postalCode")} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="addr-country">Country</Label>
              <Input id="addr-country" {...form.register("country")} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CreatePicklistButton({
  shipment,
  disabled,
  onComplete,
}: {
  shipment: ShipmentSummary;
  disabled: boolean;
  onComplete: () => void;
}) {
  const [pending, startTransition] = useTransition();

  const onClick = () => {
    startTransition(async () => {
      const result = await createPicklistAction({ shipmentId: shipment.id });
      if (result.ok) {
        toast({ title: "Picklist created" });
        onComplete();
      } else {
        toast({ title: "Action failed", description: result.error, variant: "destructive" });
      }
    });
  };

  return (
    <Button variant="outline" disabled={disabled || pending} onClick={onClick}>
      {pending ? "Creating..." : "Create picklist"}
    </Button>
  );
}

function AddPickDialog({
  shipment,
  pallets,
  disabled,
  onComplete,
}: {
  shipment: ShipmentSummary;
  pallets: AvailablePallet[];
  disabled: boolean;
  onComplete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const form = useForm<z.infer<typeof pickSchema>>({
    resolver: zodResolver(pickSchema),
    defaultValues: {
      shipmentId: shipment.id,
      palletId: pallets[0]?.palletId ?? "",
      quantityUnits: 1,
      productSku: "",
      grade: "",
      orderId: "",
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const result = await addPickAction(values);
      if (result.ok) {
        toast({ title: "Pick added" });
        setOpen(false);
        form.reset({
          shipmentId: shipment.id,
          palletId: pallets[0]?.palletId ?? "",
          quantityUnits: 1,
          productSku: "",
          grade: "",
          orderId: "",
        });
        onComplete();
      } else {
        toast({ title: "Action failed", description: result.error, variant: "destructive" });
      }
    });
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={disabled || pallets.length === 0}>
          Add pick
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add pallet to picklist</DialogTitle>
        </DialogHeader>
        {pallets.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No pallets available with free inventory.
          </p>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <input type="hidden" value={shipment.id} {...form.register("shipmentId")} />
            <div className="grid gap-2">
              <Label htmlFor="pick-pallet">Pallet</Label>
              <select
                id="pick-pallet"
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                {...form.register("palletId")}
              >
                <option value="" disabled>
                  Select a pallet
                </option>
                {pallets.map((pallet) => (
                  <option key={pallet.palletId} value={pallet.palletId}>
                    {pallet.code} · {pallet.unitsAvailable.toFixed(0)} units available
                  </option>
                ))}
              </select>
              <FormError form={form} field="palletId" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="pick-quantity">Quantity (units)</Label>
              <Input id="pick-quantity" type="number" step="1" {...form.register("quantityUnits")} />
              <FormError form={form} field="quantityUnits" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="pick-order">Order reference (optional)</Label>
              <Input id="pick-order" {...form.register("orderId")} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Adding..." : "Add"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RemovePickDialog({
  shipment,
  picks,
  disabled,
  onComplete,
}: {
  shipment: ShipmentSummary;
  picks: PickItem[];
  disabled: boolean;
  onComplete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const form = useForm<z.infer<typeof removePickSchema>>({
    resolver: zodResolver(removePickSchema),
    defaultValues: {
      shipmentId: shipment.id,
      palletId: picks[0]?.palletId ?? "",
      quantityUnits: picks[0]?.unitsPicked ?? 1,
      orderId: "",
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const result = await removePickAction(values);
      if (result.ok) {
        toast({ title: "Pick updated" });
        setOpen(false);
        onComplete();
      } else {
        toast({ title: "Action failed", description: result.error, variant: "destructive" });
      }
    });
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={disabled}>
          Remove pick
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove from picklist</DialogTitle>
        </DialogHeader>
        {picks.length === 0 ? (
          <p className="text-sm text-muted-foreground">No picks to remove.</p>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <input type="hidden" value={shipment.id} {...form.register("shipmentId")} />
            <div className="grid gap-2">
              <Label htmlFor="remove-pallet">Pallet</Label>
              <select
                id="remove-pallet"
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                {...form.register("palletId")}
              >
                {picks.map((pick) => (
                  <option key={pick.palletId} value={pick.palletId}>
                    {pick.palletCode} · {pick.unitsPicked.toFixed(0)} units picked
                  </option>
                ))}
              </select>
              <FormError form={form} field="palletId" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="remove-qty">Quantity to remove</Label>
              <Input id="remove-qty" type="number" step="1" {...form.register("quantityUnits")} />
              <FormError form={form} field="quantityUnits" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="remove-order">Order reference (optional)</Label>
              <Input id="remove-order" {...form.register("orderId")} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Removing..." : "Remove"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function WeighbridgeDialog({
  shipmentId,
  mode,
  disabled,
  onComplete,
}: {
  shipmentId: string;
  mode: "in" | "out";
  disabled: boolean;
  onComplete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const form = useForm<z.infer<typeof weighSchema>>({
    resolver: zodResolver(weighSchema),
    defaultValues: {
      shipmentId,
      grossKg: 0,
      tareKg: undefined,
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const action = mode === "in" ? weighbridgeInAction : weighbridgeOutAction;
      const result = await action(values);
      if (result.ok) {
        toast({ title: mode === "in" ? "Weigh-in recorded" : "Weigh-out recorded" });
        setOpen(false);
        onComplete();
      } else {
        toast({ title: "Action failed", description: result.error, variant: "destructive" });
      }
    });
  });

  const label = mode === "in" ? "Weigh in" : "Weigh out";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={disabled}>
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <input type="hidden" value={shipmentId} {...form.register("shipmentId")} />
          <div className="grid gap-2">
            <Label htmlFor={`${mode}-gross`}>Gross weight (kg)</Label>
            <Input id={`${mode}-gross`} type="number" step="0.1" {...form.register("grossKg")} />
            <FormError form={form} field="grossKg" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${mode}-tare`}>Tare weight (kg)</Label>
            <Input id={`${mode}-tare`} type="number" step="0.1" {...form.register("tareKg")} />
            <FormError form={form} field="tareKg" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function FinalizeDispatchButton({
  shipment,
  disabled,
  onComplete,
}: {
  shipment: ShipmentSummary;
  disabled: boolean;
  onComplete: () => void;
}) {
  const [pending, startTransition] = useTransition();

  const onClick = () => {
    startTransition(async () => {
      const result = await finalizeDispatchAction({ shipmentId: shipment.id });
      if (result.ok) {
        toast({ title: "Shipment dispatched" });
        onComplete();
      } else {
        toast({ title: "Action failed", description: result.error, variant: "destructive" });
      }
    });
  };

  return (
    <Button variant="default" disabled={disabled || pending} onClick={onClick}>
      {pending ? "Dispatching..." : "Finalize dispatch"}
    </Button>
  );
}

function CancelShipmentDialog({
  shipment,
  disabled,
  onComplete,
}: {
  shipment: ShipmentSummary;
  disabled: boolean;
  onComplete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const form = useForm<{ reason: string }>({ defaultValues: { reason: "" } });

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const result = await cancelShipmentAction({
        shipmentId: shipment.id,
        reason: values.reason,
      });
      if (result.ok) {
        toast({ title: "Shipment cancelled" });
        setOpen(false);
        onComplete();
      } else {
        toast({ title: "Action failed", description: result.error, variant: "destructive" });
      }
    });
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="destructive" disabled={disabled}>
          Cancel shipment
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel shipment</DialogTitle>
          <DialogDescription>
            Cancelling will release all reserved units and mark the shipment as cancelled.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="cancel-reason">Reason (optional)</Label>
            <Textarea id="cancel-reason" rows={3} {...form.register("reason")} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Keep shipment
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Cancelling..." : "Cancel"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AddressPreview({ address }: { address: Record<string, unknown> | null }) {
  if (!address || Object.keys(address).length === 0) {
    return <p className="text-sm text-muted-foreground">No address captured.</p>;
  }
  const lines = [address.line1, address.line2, address.city, address.state, address.postalCode, address.country]
    .map((value) => (typeof value === "string" ? value : null))
    .filter(Boolean) as string[];
  return (
    <div className="space-y-1 text-sm text-foreground">
      {lines.map((line, index) => (
        <p key={`${line}-${index}`}>{line}</p>
      ))}
    </div>
  );
}
