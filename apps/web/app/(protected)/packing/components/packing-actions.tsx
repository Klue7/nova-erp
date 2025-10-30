"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm, type UseFormReturn } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

import { Button } from "@/components/ui/button";
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
import { toast } from "@/hooks/use-toast";
import {
  addInputAction,
  cancelPalletAction,
  closePalletAction,
  createLocationAction,
  createPalletAction,
  gradePalletAction,
  movePalletAction,
  printLabelAction,
  releaseReservationAction,
  reserveUnitsAction,
  scrapUnitsAction,
} from "../actions";

type LocationOption = {
  id: string;
  code: string;
  type?: string | null;
  status: string;
  capacityPallets?: number | null;
};

type KilnOption = {
  id: string;
  code: string;
  availableUnits: number;
};

type PalletSummary = {
  id: string;
  code: string;
  status: string;
  productSku: string;
  grade: string;
  unitsAvailable: number;
  locationId: string | null;
};

type Props = {
  locations: LocationOption[];
  kilnOptions: KilnOption[];
  selectedPallet: PalletSummary | null;
};

type ActionResult = Promise<{ ok: boolean; error?: string }>;

export const createLocationSchema = z.object({
  code: z.string().min(1, "Location code is required"),
  type: z.string().trim().optional(),
  capacityPallets: z
    .union([z.number(), z.string(), z.null(), z.undefined()])
    .transform((value) => {
      if (value === null || value === undefined) return undefined;
      const trimmed = typeof value === "string" ? value.trim() : value;
      if (trimmed === "") return undefined;
      const num = Number(trimmed);
      return Number.isFinite(num) ? num : undefined;
    })
    .optional(),
  status: z.string().trim().optional(),
});

export const createPalletSchema = z.object({
  code: z.string().min(1, "Pallet code is required"),
  productSku: z.string().min(1, "Product SKU is required"),
  grade: z.string().min(1, "Grade is required"),
  capacityUnits: z
    .union([z.number(), z.string(), z.null(), z.undefined()])
    .transform((value) => {
      if (value === null || value === undefined) return undefined;
      const trimmed = typeof value === "string" ? value.trim() : value;
      if (trimmed === "") return undefined;
      const num = Number(trimmed);
      return Number.isFinite(num) ? num : undefined;
    })
    .optional(),
  locationId: z
    .union([z.string().uuid(), z.literal(""), z.null(), z.undefined()])
    .transform((value) => {
      if (!value || value === "") return undefined;
      return value;
    })
    .optional(),
});

const positiveQuantitySchema = z
  .union([z.number(), z.string()])
  .transform((value) => Number(value))
  .refine((value) => Number.isFinite(value) && value > 0, {
    message: "Quantity must be greater than zero",
  });

export const addInputSchema = z.object({
  kilnBatchId: z.string().uuid("Select a kiln batch"),
  quantityUnits: positiveQuantitySchema,
  reference: z.string().trim().optional(),
});

export const gradeSchema = z.object({
  grade: z.string().min(1, "Grade is required"),
});

export const moveSchema = z.object({
  toLocationId: z.string().uuid("Select a destination"),
});

export const reserveSchema = z.object({
  orderId: z.string().min(1, "Order reference is required"),
  quantityUnits: positiveQuantitySchema,
});

export const releaseSchema = reserveSchema;

export const scrapSchema = z.object({
  scrapUnits: positiveQuantitySchema,
  reason: z.string().trim().optional(),
});

export function PackingActions({
  locations,
  kilnOptions,
  selectedPallet,
}: Props) {
  const router = useRouter();

  const handle = async (
    resultPromise: ActionResult,
    successMessage: string,
  ) => {
    const result = await resultPromise;
    if (result.ok) {
      toast({ title: successMessage });
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

  return (
    <div className="flex flex-wrap gap-3">
      <CreateLocationDialog onComplete={handle} />
      <CreatePalletDialog locations={locations} onComplete={handle} />
      <AddInputDialog
        kilnOptions={kilnOptions}
        selectedPallet={selectedPallet}
        onComplete={handle}
      />
      <GradePalletDialog
        selectedPallet={selectedPallet}
        onComplete={handle}
      />
      <MovePalletDialog
        locations={locations}
        selectedPallet={selectedPallet}
        onComplete={handle}
      />
      <PrintLabelButton selectedPallet={selectedPallet} onComplete={handle} />
      <ReserveUnitsDialog
        selectedPallet={selectedPallet}
        onComplete={handle}
      />
      <ReleaseReservationDialog
        selectedPallet={selectedPallet}
        onComplete={handle}
      />
      <ScrapUnitsDialog
        selectedPallet={selectedPallet}
        onComplete={handle}
      />
      <ClosePalletButton selectedPallet={selectedPallet} onComplete={handle} />
      <CancelPalletDialog selectedPallet={selectedPallet} onComplete={handle} />
    </div>
  );
}

type FormHook = UseFormReturn<any>;

function FormError({ form, field }: { form: FormHook; field: string }) {
  const error = form.formState.errors[field]?.message;
  if (!error) return null;
  return <p className="text-xs text-destructive">{String(error)}</p>;
}

function CreateLocationDialog({
  onComplete,
}: {
  onComplete: (
    result: ActionResult,
    success: string,
  ) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const form = useForm<z.infer<typeof createLocationSchema>>({
    resolver: zodResolver(createLocationSchema),
    defaultValues: {
      code: "",
      type: "",
      capacityPallets: undefined,
      status: "active",
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const ok = await onComplete(
        createLocationAction(values),
        `Location ${values.code} saved`,
      );
      if (ok) {
        form.reset({ code: "", type: "", capacityPallets: undefined, status: "active" });
        setOpen(false);
      }
    });
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Create Location</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create packing location</DialogTitle>
          <DialogDescription>
            Define a staging or warehouse location for pallets.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="location-code">Code</Label>
            <Input id="location-code" {...form.register("code")} />
            <FormError form={form} field="code" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="location-type">Type</Label>
            <Input id="location-type" placeholder="staging" {...form.register("type")} />
            <FormError form={form} field="type" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="location-capacity">Capacity (pallets)</Label>
            <Input
              id="location-capacity"
              type="number"
              step="1"
              {...form.register("capacityPallets")}
            />
            <FormError form={form} field="capacityPallets" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="location-status">Status</Label>
            <Input id="location-status" {...form.register("status")} />
            <FormError form={form} field="status" />
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

function CreatePalletDialog({
  locations,
  onComplete,
}: {
  locations: LocationOption[];
  onComplete: (
    result: ActionResult,
    success: string,
  ) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const form = useForm<z.infer<typeof createPalletSchema>>({
    resolver: zodResolver(createPalletSchema),
    defaultValues: {
      code: "",
      productSku: "",
      grade: "A",
      capacityUnits: undefined,
      locationId: locations[0]?.id ?? undefined,
    },
  });

  useEffect(() => {
    form.setValue("locationId", locations[0]?.id ?? undefined);
  }, [locations, form]);

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const ok = await onComplete(
        createPalletAction({
          ...values,
          locationId: values.locationId ?? null,
        }),
        `Pallet ${values.code} created`,
      );
      if (ok) {
        form.reset({
          code: "",
          productSku: "",
          grade: "A",
          capacityUnits: undefined,
          locationId: locations[0]?.id ?? undefined,
        });
        setOpen(false);
      }
    });
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary">Create Pallet</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create pallet</DialogTitle>
          <DialogDescription>
            Register a new pallet with product and grade details.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="pallet-code">Code</Label>
            <Input id="pallet-code" {...form.register("code")} />
            <FormError form={form} field="code" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="pallet-sku">Product SKU</Label>
            <Input id="pallet-sku" {...form.register("productSku")} />
            <FormError form={form} field="productSku" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="pallet-grade">Grade</Label>
            <Input id="pallet-grade" {...form.register("grade")} />
            <FormError form={form} field="grade" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="pallet-capacity">Capacity (units)</Label>
            <Input
              id="pallet-capacity"
              type="number"
              step="1"
              {...form.register("capacityUnits")}
            />
            <FormError form={form} field="capacityUnits" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="pallet-location">Location</Label>
            <select
              id="pallet-location"
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              {...form.register("locationId")}
            >
              <option value="">No location</option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.code}
                </option>
              ))}
            </select>
            <FormError form={form} field="locationId" />
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

function AddInputDialog({
  kilnOptions,
  selectedPallet,
  onComplete,
}: {
  kilnOptions: KilnOption[];
  selectedPallet: PalletSummary | null;
  onComplete: (
    result: ActionResult,
    success: string,
  ) => Promise<boolean>;
}) {
  const disabled = !selectedPallet;
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const form = useForm<z.infer<typeof addInputSchema>>({
    resolver: zodResolver(addInputSchema),
    defaultValues: {
      kilnBatchId: kilnOptions[0]?.id ?? "",
      quantityUnits: undefined,
      reference: "",
    },
  });

  useEffect(() => {
    form.reset({
      kilnBatchId: kilnOptions[0]?.id ?? "",
      quantityUnits: undefined,
      reference: "",
    });
  }, [kilnOptions, form]);

  const onSubmit = form.handleSubmit((values) => {
    if (!selectedPallet) return;
    startTransition(async () => {
      const ok = await onComplete(
        addInputAction({
          palletId: selectedPallet.id,
          kilnBatchId: values.kilnBatchId,
          quantityUnits: values.quantityUnits,
          reference: values.reference ?? undefined,
        }),
        `Added units to ${selectedPallet.code}`,
      );
      if (ok) {
        form.reset({
          kilnBatchId: kilnOptions[0]?.id ?? "",
          quantityUnits: undefined,
          reference: "",
        });
        setOpen(false);
      }
    });
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={disabled || kilnOptions.length === 0}>
          Add Input
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add kiln output</DialogTitle>
          <DialogDescription>
            Feed fired units from a kiln batch into the pallet.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="input-batch">Kiln batch</Label>
            <select
              id="input-batch"
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              disabled={kilnOptions.length === 0}
              {...form.register("kilnBatchId")}
            >
              <option value="" disabled>
                Select batch
              </option>
              {kilnOptions.map((batch) => (
                <option key={batch.id} value={batch.id}>
                  {batch.code} ({batch.availableUnits.toFixed(0)} units)
                </option>
              ))}
            </select>
            <FormError form={form} field="kilnBatchId" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="input-quantity">Quantity (units)</Label>
            <Input
              id="input-quantity"
              type="number"
              step="1"
              {...form.register("quantityUnits")}
            />
            <FormError form={form} field="quantityUnits" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="input-reference">Reference (optional)</Label>
            <Input id="input-reference" {...form.register("reference")} />
            <FormError form={form} field="reference" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || kilnOptions.length === 0}>
              {pending ? "Recording..." : "Add"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function GradePalletDialog({
  selectedPallet,
  onComplete,
}: {
  selectedPallet: PalletSummary | null;
  onComplete: (
    result: ActionResult,
    success: string,
  ) => Promise<boolean>;
}) {
  const disabled = !selectedPallet;
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const form = useForm<z.infer<typeof gradeSchema>>({
    resolver: zodResolver(gradeSchema),
    defaultValues: {
      grade: selectedPallet?.grade ?? "A",
    },
  });

  useEffect(() => {
    form.reset({ grade: selectedPallet?.grade ?? "A" });
  }, [selectedPallet, form]);

  const onSubmit = form.handleSubmit((values) => {
    if (!selectedPallet) return;
    startTransition(async () => {
      const ok = await onComplete(
        gradePalletAction({ palletId: selectedPallet.id, grade: values.grade }),
        `Pallet ${selectedPallet.code} graded`,
      );
      if (ok) {
        setOpen(false);
      }
    });
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={disabled}>
          Update Grade
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Update pallet grade</DialogTitle>
          <DialogDescription>Set the inspected grade.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="pallet-grade-update">Grade</Label>
            <Input id="pallet-grade-update" {...form.register("grade")} />
            <FormError form={form} field="grade" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Updating..." : "Update"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MovePalletDialog({
  locations,
  selectedPallet,
  onComplete,
}: {
  locations: LocationOption[];
  selectedPallet: PalletSummary | null;
  onComplete: (
    result: ActionResult,
    success: string,
  ) => Promise<boolean>;
}) {
  const disabled = !selectedPallet || locations.length === 0;
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const form = useForm<z.infer<typeof moveSchema>>({
    resolver: zodResolver(moveSchema),
    defaultValues: {
      toLocationId: locations[0]?.id ?? "",
    },
  });

  useEffect(() => {
    form.reset({
      toLocationId: selectedPallet?.locationId ?? locations[0]?.id ?? "",
    });
  }, [locations, selectedPallet, form]);

  const onSubmit = form.handleSubmit((values) => {
    if (!selectedPallet) return;
    startTransition(async () => {
      const ok = await onComplete(
        movePalletAction({
          palletId: selectedPallet.id,
          toLocationId: values.toLocationId,
        }),
        `Moved ${selectedPallet.code}`,
      );
      if (ok) {
        setOpen(false);
      }
    });
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={disabled}>
          Move Pallet
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move pallet</DialogTitle>
          <DialogDescription>Select the destination location.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="move-location">Location</Label>
            <select
              id="move-location"
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              {...form.register("toLocationId")}
            >
              <option value="" disabled>
                Select location
              </option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.code}
                </option>
              ))}
            </select>
            <FormError form={form} field="toLocationId" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Moving..." : "Move"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PrintLabelButton({
  selectedPallet,
  onComplete,
}: {
  selectedPallet: PalletSummary | null;
  onComplete: (
    result: ActionResult,
    success: string,
  ) => Promise<boolean>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const disabled = !selectedPallet;

  const onClick = () => {
    if (!selectedPallet) return;
    startTransition(async () => {
      const ok = await onComplete(
        printLabelAction({ palletId: selectedPallet.id, labelType: "standard" }),
        `Label logged for ${selectedPallet.code}`,
      );
      if (ok) {
        router.push(`/packing/label/${selectedPallet.id}`);
      }
    });
  };

  return (
    <Button variant="outline" disabled={disabled || pending} onClick={onClick}>
      {pending ? "Opening label..." : "Print Label"}
    </Button>
  );
}

function ReserveUnitsDialog({
  selectedPallet,
  onComplete,
}: {
  selectedPallet: PalletSummary | null;
  onComplete: (
    result: ActionResult,
    success: string,
  ) => Promise<boolean>;
}) {
  const disabled = !selectedPallet;
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const form = useForm<z.infer<typeof reserveSchema>>({
    resolver: zodResolver(reserveSchema),
    defaultValues: {
      orderId: "",
      quantityUnits: undefined,
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    if (!selectedPallet) return;
    startTransition(async () => {
      const ok = await onComplete(
        reserveUnitsAction({
          palletId: selectedPallet.id,
          orderId: values.orderId,
          quantityUnits: values.quantityUnits,
        }),
        `Reserved units on ${selectedPallet.code}`,
      );
      if (ok) {
        form.reset({ orderId: "", quantityUnits: undefined });
        setOpen(false);
      }
    });
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={disabled}>
          Reserve Units
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reserve pallet units</DialogTitle>
          <DialogDescription>Allocate units to an order.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="reserve-order">Order reference</Label>
            <Input id="reserve-order" {...form.register("orderId")} />
            <FormError form={form} field="orderId" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="reserve-qty">Quantity (units)</Label>
            <Input
              id="reserve-qty"
              type="number"
              step="1"
              {...form.register("quantityUnits")}
            />
            <FormError form={form} field="quantityUnits" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Reserving..." : "Reserve"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ReleaseReservationDialog({
  selectedPallet,
  onComplete,
}: {
  selectedPallet: PalletSummary | null;
  onComplete: (
    result: ActionResult,
    success: string,
  ) => Promise<boolean>;
}) {
  const disabled = !selectedPallet;
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const form = useForm<z.infer<typeof releaseSchema>>({
    resolver: zodResolver(releaseSchema),
    defaultValues: {
      orderId: "",
      quantityUnits: undefined,
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    if (!selectedPallet) return;
    startTransition(async () => {
      const ok = await onComplete(
        releaseReservationAction({
          palletId: selectedPallet.id,
          orderId: values.orderId,
          quantityUnits: values.quantityUnits,
        }),
        `Released units on ${selectedPallet.code}`,
      );
      if (ok) {
        form.reset({ orderId: "", quantityUnits: undefined });
        setOpen(false);
      }
    });
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={disabled}>
          Release Reservation
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Release reservation</DialogTitle>
          <DialogDescription>Return reserved units to inventory.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="release-order">Order reference</Label>
            <Input id="release-order" {...form.register("orderId")} />
            <FormError form={form} field="orderId" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="release-qty">Quantity (units)</Label>
            <Input
              id="release-qty"
              type="number"
              step="1"
              {...form.register("quantityUnits")}
            />
            <FormError form={form} field="quantityUnits" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Releasing..." : "Release"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ScrapUnitsDialog({
  selectedPallet,
  onComplete,
}: {
  selectedPallet: PalletSummary | null;
  onComplete: (
    result: ActionResult,
    success: string,
  ) => Promise<boolean>;
}) {
  const disabled = !selectedPallet;
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const form = useForm<z.infer<typeof scrapSchema>>({
    resolver: zodResolver(scrapSchema),
    defaultValues: {
      scrapUnits: undefined,
      reason: "",
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    if (!selectedPallet) return;
    startTransition(async () => {
      const ok = await onComplete(
        scrapUnitsAction({
          palletId: selectedPallet.id,
          scrapUnits: values.scrapUnits,
          reason: values.reason ?? undefined,
        }),
        `Scrap recorded on ${selectedPallet.code}`,
      );
      if (ok) {
        form.reset({ scrapUnits: undefined, reason: "" });
        setOpen(false);
      }
    });
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={disabled}>
          Record Scrap
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record scrap units</DialogTitle>
          <DialogDescription>Capture damaged or lost units.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="scrap-qty">Quantity (units)</Label>
            <Input
              id="scrap-qty"
              type="number"
              step="1"
              {...form.register("scrapUnits")}
            />
            <FormError form={form} field="scrapUnits" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="scrap-reason">Reason (optional)</Label>
            <Input id="scrap-reason" {...form.register("reason")} />
            <FormError form={form} field="reason" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Recording..." : "Record"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ClosePalletButton({
  selectedPallet,
  onComplete,
}: {
  selectedPallet: PalletSummary | null;
  onComplete: (
    result: ActionResult,
    success: string,
  ) => Promise<boolean>;
}) {
  const [pending, startTransition] = useTransition();
  const disabled = !selectedPallet || selectedPallet.status !== "open";

  const onClick = () => {
    if (!selectedPallet) return;
    startTransition(async () => {
      const ok = await onComplete(
        closePalletAction({ palletId: selectedPallet.id }),
        `Pallet ${selectedPallet.code} closed`,
      );
      if (ok) {
        // no-op
      }
    });
  };

  return (
    <Button variant="secondary" disabled={disabled || pending} onClick={onClick}>
      {pending ? "Closing..." : "Close Pallet"}
    </Button>
  );
}

function CancelPalletDialog({
  selectedPallet,
  onComplete,
}: {
  selectedPallet: PalletSummary | null;
  onComplete: (
    result: ActionResult,
    success: string,
  ) => Promise<boolean>;
}) {
  const disabled = !selectedPallet;
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const form = useForm<{
    reason: string;
  }>({
    defaultValues: { reason: "" },
  });

  const onSubmit = form.handleSubmit((values) => {
    if (!selectedPallet) return;
    startTransition(async () => {
      const ok = await onComplete(
        cancelPalletAction({
          palletId: selectedPallet.id,
          reason: values.reason || undefined,
        }),
        `Pallet ${selectedPallet.code} cancelled`,
      );
      if (ok) {
        form.reset({ reason: "" });
        setOpen(false);
      }
    });
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="destructive" disabled={disabled}>
          Cancel Pallet
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel pallet</DialogTitle>
          <DialogDescription>
            Cancelling marks the pallet as not usable for packing.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="cancel-reason">Reason (optional)</Label>
            <Input id="cancel-reason" {...form.register("reason")} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Keep Pallet
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Cancelling..." : "Cancel Pallet"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
