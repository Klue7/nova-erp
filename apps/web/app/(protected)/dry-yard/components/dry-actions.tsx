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
  cancelLoadAction,
  completeLoadAction,
  createLoadAction,
  createRackAction,
  moveLoadAction,
  recordMoistureAction,
  recordScrapAction,
  startLoadAction,
} from "../actions";

type RackOption = {
  id: string;
  code: string;
  bay?: string | null;
  capacityUnits: number;
  occupiedUnits: number;
};

type ExtrusionOption = {
  id: string;
  code: string;
  availableUnits: number;
};

type LoadSummary = {
  id: string;
  code: string;
  status: string;
  rackId: string | null;
  inputUnits: number;
  latestMoisturePct: number | null;
};

type Props = {
  racks: RackOption[];
  extrusionOptions: ExtrusionOption[];
  selectedLoad: LoadSummary | null;
};

export const createRackSchema = z.object({
  code: z.string().min(1, "Rack code is required"),
  bay: z.string().trim().optional(),
  capacityUnits: z
    .union([z.number(), z.string()])
    .transform((value) => Number(value))
    .refine(
      (value) => Number.isFinite(value) && value > 0,
      "Capacity must be greater than zero",
    ),
  status: z.string().trim().optional(),
});

export const createLoadSchema = z.object({
  code: z.string().min(1, "Load code is required"),
  rackId: z.string().uuid("Select a rack"),
  targetMoisturePct: z
    .union([z.number(), z.string(), z.null(), z.undefined()])
    .transform((value) => {
      if (value === null || value === undefined) return undefined;
      const trimmed = typeof value === "string" ? value.trim() : value;
      if (trimmed === "") return undefined;
      const num = Number(trimmed);
      return Number.isFinite(num) ? num : undefined;
    })
    .optional(),
});

export const addInputSchema = z.object({
  extrusionRunId: z.string().uuid("Select an extrusion run"),
  quantityUnits: z
    .union([z.number(), z.string()])
    .transform((value) => Number(value))
    .refine(
      (value) => Number.isFinite(value) && value > 0,
      "Quantity must be greater than zero",
    ),
  reference: z.string().trim().optional(),
});

export const moistureSchema = z.object({
  moisturePct: z
    .union([z.number(), z.string()])
    .transform((value) => Number(value))
    .refine(
      (value) => Number.isFinite(value) && value >= 0 && value <= 100,
      "Moisture must be between 0 and 100",
    ),
  method: z.string().trim().optional(),
});

export const moveLoadSchema = z.object({
  toRackId: z.string().uuid("Select a destination rack"),
});

export const scrapSchema = z.object({
  scrapUnits: z
    .union([z.number(), z.string()])
    .transform((value) => Number(value))
    .refine(
      (value) => Number.isFinite(value) && value > 0,
      "Scrap must be greater than zero",
    ),
  reason: z.string().trim().optional(),
});

type ActionResult = Promise<{ ok: boolean; error?: string }>;

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

export function DryActions({
  racks,
  extrusionOptions,
  selectedLoad,
}: Props) {
  const router = useRouter();

  const handleResult = async (
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
      <CreateRackDialog onComplete={handleResult} />
      <CreateLoadDialog racks={racks} onComplete={handleResult} />
      <AddInputDialog
        selectedLoad={selectedLoad}
        extrusionOptions={extrusionOptions}
        onComplete={handleResult}
      />
      <StartLoadButton
        selectedLoad={selectedLoad}
        onComplete={handleResult}
      />
      <RecordMoistureDialog
        selectedLoad={selectedLoad}
        onComplete={handleResult}
      />
      <MoveLoadDialog
        racks={racks}
        selectedLoad={selectedLoad}
        onComplete={handleResult}
      />
      <RecordScrapDialog
        selectedLoad={selectedLoad}
        onComplete={handleResult}
      />
      <CompleteLoadButton
        selectedLoad={selectedLoad}
        onComplete={handleResult}
      />
      <CancelLoadDialog
        selectedLoad={selectedLoad}
        onComplete={handleResult}
      />
    </div>
  );
}

function CreateRackDialog({
  onComplete,
}: {
  onComplete: (
    result: ActionResult,
    successMessage: string,
  ) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const form = useForm<z.infer<typeof createRackSchema>>({
    resolver: zodResolver(createRackSchema),
    defaultValues: {
      code: "",
      bay: "",
      capacityUnits: 0,
      status: "active",
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const ok = await onComplete(
        createRackAction(values),
        `Rack ${values.code} created`,
      );
      if (ok) {
        form.reset({
          code: "",
          bay: "",
          capacityUnits: 0,
          status: "active",
        });
        setOpen(false);
      }
    });
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Create Rack</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create drying rack</DialogTitle>
          <DialogDescription>Register a rack and capacity.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="rack-code">Rack code</Label>
            <Input id="rack-code" {...form.register("code")} />
            <FormError form={form} field="code" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="rack-bay">Bay (optional)</Label>
            <Input id="rack-bay" {...form.register("bay")} />
            <FormError form={form} field="bay" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="rack-capacity">Capacity (units)</Label>
            <Input
              id="rack-capacity"
              type="number"
              step="1"
              {...form.register("capacityUnits")}
            />
            <FormError form={form} field="capacityUnits" />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
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

function CreateLoadDialog({
  racks,
  onComplete,
}: {
  racks: RackOption[];
  onComplete: (
    result: ActionResult,
    successMessage: string,
  ) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const form = useForm<z.infer<typeof createLoadSchema>>({
    resolver: zodResolver(createLoadSchema),
    defaultValues: {
      code: "",
      rackId: racks[0]?.id ?? "",
      targetMoisturePct: undefined,
    },
  });

  useEffect(() => {
    form.reset({
      code: "",
      rackId: racks[0]?.id ?? "",
      targetMoisturePct: undefined,
    });
  }, [racks, form]);

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const ok = await onComplete(
        createLoadAction(values),
        `Dry load ${values.code} planned`,
      );
      if (ok) {
        form.reset({
          code: "",
          rackId: racks[0]?.id ?? "",
          targetMoisturePct: undefined,
        });
        setOpen(false);
      }
    });
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary">Create Load</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Plan dry load</DialogTitle>
          <DialogDescription>
            Assign a rack and optional target moisture.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="load-code">Load code</Label>
            <Input id="load-code" {...form.register("code")} />
            <FormError form={form} field="code" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="load-rack">Rack</Label>
            <select
              id="load-rack"
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              {...form.register("rackId")}
            >
              <option value="" disabled>
                Select rack
              </option>
              {racks.map((rack) => (
                <option key={rack.id} value={rack.id}>
                  {rack.code} ({rack.capacityUnits.toFixed(0)} units)
                </option>
              ))}
            </select>
            <FormError form={form} field="rackId" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="load-target">Target moisture %</Label>
            <Input
              id="load-target"
              type="number"
              step="0.1"
              {...form.register("targetMoisturePct")}
            />
            <FormError form={form} field="targetMoisturePct" />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending || racks.length === 0}>
              {pending ? "Planning..." : "Plan load"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AddInputDialog({
  selectedLoad,
  extrusionOptions,
  onComplete,
}: {
  selectedLoad: LoadSummary | null;
  extrusionOptions: ExtrusionOption[];
  onComplete: (
    result: ActionResult,
    successMessage: string,
  ) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const form = useForm<z.infer<typeof addInputSchema>>({
    resolver: zodResolver(addInputSchema),
    defaultValues: {
      extrusionRunId: extrusionOptions[0]?.id ?? "",
      quantityUnits: 0,
      reference: "",
    },
  });

  useEffect(() => {
    if (!open) {
      form.reset({
        extrusionRunId: extrusionOptions[0]?.id ?? "",
        quantityUnits: 0,
        reference: "",
      });
    }
  }, [open, extrusionOptions, form]);

  const disabled =
    !selectedLoad ||
    !["planned", "active"].includes(selectedLoad.status) ||
    extrusionOptions.length === 0;

  const onSubmit = form.handleSubmit((values) => {
    if (!selectedLoad) return;
    startTransition(async () => {
      const ok = await onComplete(
        addInputAction({
          loadId: selectedLoad.id,
          extrusionRunId: values.extrusionRunId,
          quantityUnits: Number(values.quantityUnits),
          reference: values.reference ?? "",
        }),
        `${values.quantityUnits} units added to ${selectedLoad.code}`,
      );
      if (ok) {
        form.reset({
          extrusionRunId: extrusionOptions[0]?.id ?? "",
          quantityUnits: 0,
          reference: "",
        });
        setOpen(false);
      }
    });
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={disabled}>
          Add Input
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add extrusion input</DialogTitle>
          <DialogDescription>
            Allocate units from extrusion runs to this load.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="input-run">Extrusion run</Label>
            <select
              id="input-run"
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              {...form.register("extrusionRunId")}
            >
              <option value="" disabled>
                Select run
              </option>
              {extrusionOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.code} • {option.availableUnits.toFixed(0)} available
                </option>
              ))}
            </select>
            <FormError form={form} field="extrusionRunId" />
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
            <Label htmlFor="input-reference">Reference</Label>
            <Input id="input-reference" {...form.register("reference")} />
            <FormError form={form} field="reference" />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={pending || extrusionOptions.length === 0}
            >
              {pending ? "Logging..." : "Log input"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function StartLoadButton({
  selectedLoad,
  onComplete,
}: {
  selectedLoad: LoadSummary | null;
  onComplete: (
    result: ActionResult,
    successMessage: string,
  ) => Promise<boolean>;
}) {
  const [pending, startTransition] = useTransition();
  const disabled =
    !selectedLoad ||
    selectedLoad.status !== "planned" ||
    pending;

  const start = () => {
    if (!selectedLoad) return;
    startTransition(async () => {
      await onComplete(
        startLoadAction({ loadId: selectedLoad.id }),
        `${selectedLoad.code} started`,
      );
    });
  };

  return (
    <Button variant="outline" disabled={disabled} onClick={start}>
      {pending ? "Starting..." : "Start Load"}
    </Button>
  );
}

function RecordMoistureDialog({
  selectedLoad,
  onComplete,
}: {
  selectedLoad: LoadSummary | null;
  onComplete: (
    result: ActionResult,
    successMessage: string,
  ) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const form = useForm<z.infer<typeof moistureSchema>>({
    resolver: zodResolver(moistureSchema),
    defaultValues: {
      moisturePct: selectedLoad?.latestMoisturePct ?? 0,
      method: "",
    },
  });

  useEffect(() => {
    form.reset({
      moisturePct: selectedLoad?.latestMoisturePct ?? 0,
      method: "",
    });
  }, [selectedLoad, form]);

  const disabled =
    !selectedLoad || !["planned", "active"].includes(selectedLoad.status);

  const onSubmit = form.handleSubmit((values) => {
    if (!selectedLoad) return;
    startTransition(async () => {
      const ok = await onComplete(
        recordMoistureAction({
          loadId: selectedLoad.id,
          moisturePct: Number(values.moisturePct),
          method: values.method ?? "",
        }),
        `Moisture logged for ${selectedLoad.code}`,
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
          Record Moisture
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record moisture</DialogTitle>
          <DialogDescription>
            Capture the latest reading for {selectedLoad?.code}.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="moisture-value">Moisture %</Label>
            <Input
              id="moisture-value"
              type="number"
              step="0.1"
              {...form.register("moisturePct")}
            />
            <FormError form={form} field="moisturePct" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="moisture-method">Method</Label>
            <Input id="moisture-method" {...form.register("method")} />
            <FormError form={form} field="method" />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
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

function MoveLoadDialog({
  racks,
  selectedLoad,
  onComplete,
}: {
  racks: RackOption[];
  selectedLoad: LoadSummary | null;
  onComplete: (
    result: ActionResult,
    successMessage: string,
  ) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const form = useForm<z.infer<typeof moveLoadSchema>>({
    resolver: zodResolver(moveLoadSchema),
    defaultValues: {
      toRackId: "",
    },
  });

  useEffect(() => {
    if (selectedLoad && open) {
      const defaultRack = racks.find((rack) => rack.id !== selectedLoad.rackId);
      form.reset({
        toRackId: defaultRack?.id ?? "",
      });
    }
  }, [selectedLoad, racks, open, form]);

  const disabled =
    !selectedLoad ||
    selectedLoad.status === "completed" ||
    selectedLoad.status === "cancelled" ||
    racks.filter((rack) => rack.id !== selectedLoad.rackId).length === 0;

  const onSubmit = form.handleSubmit((values) => {
    if (!selectedLoad) return;
    startTransition(async () => {
      const ok = await onComplete(
        moveLoadAction({
          loadId: selectedLoad.id,
          toRackId: values.toRackId,
        }),
        `${selectedLoad.code} moved`,
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
          Move Load
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move load</DialogTitle>
          <DialogDescription>
            Reassign {selectedLoad?.code ?? "load"} to a different rack.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="move-rack">Destination rack</Label>
            <select
              id="move-rack"
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              {...form.register("toRackId")}
            >
              <option value="" disabled>
                Select rack
              </option>
              {racks
                .filter((rack) => rack.id !== selectedLoad?.rackId)
                .map((rack) => {
                  const remaining =
                    rack.capacityUnits - rack.occupiedUnits;
                  return (
                    <option key={rack.id} value={rack.id}>
                      {rack.code} • {remaining.toFixed(0)} units free
                    </option>
                  );
                })}
            </select>
            <FormError form={form} field="toRackId" />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
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

function RecordScrapDialog({
  selectedLoad,
  onComplete,
}: {
  selectedLoad: LoadSummary | null;
  onComplete: (
    result: ActionResult,
    successMessage: string,
  ) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const form = useForm<z.infer<typeof scrapSchema>>({
    resolver: zodResolver(scrapSchema),
    defaultValues: {
      scrapUnits: 0,
      reason: "",
    },
  });

  useEffect(() => {
    if (!open) {
      form.reset({ scrapUnits: 0, reason: "" });
    }
  }, [open, form]);

  const disabled = !selectedLoad;

  const onSubmit = form.handleSubmit((values) => {
    if (!selectedLoad) return;
    startTransition(async () => {
      const ok = await onComplete(
        recordScrapAction({
          loadId: selectedLoad.id,
          scrapUnits: Number(values.scrapUnits),
          reason: values.reason ?? "",
        }),
        `Scrap logged for ${selectedLoad.code}`,
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
          Record Scrap
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record scrap</DialogTitle>
          <DialogDescription>
            Capture scrap generated from {selectedLoad?.code}.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="scrap-units">Scrap units</Label>
            <Input
              id="scrap-units"
              type="number"
              step="1"
              {...form.register("scrapUnits")}
            />
            <FormError form={form} field="scrapUnits" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="scrap-reason">Reason</Label>
            <Input id="scrap-reason" {...form.register("reason")} />
            <FormError form={form} field="reason" />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
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

function CompleteLoadButton({
  selectedLoad,
  onComplete,
}: {
  selectedLoad: LoadSummary | null;
  onComplete: (
    result: ActionResult,
    successMessage: string,
  ) => Promise<boolean>;
}) {
  const [pending, startTransition] = useTransition();
  const disabled =
    !selectedLoad || selectedLoad.status !== "active" || pending;

  const complete = () => {
    if (!selectedLoad) return;
    startTransition(async () => {
      await onComplete(
        completeLoadAction({ loadId: selectedLoad.id }),
        `${selectedLoad.code} completed`,
      );
    });
  };

  return (
    <Button variant="outline" disabled={disabled} onClick={complete}>
      {pending ? "Completing..." : "Complete Load"}
    </Button>
  );
}

function CancelLoadDialog({
  selectedLoad,
  onComplete,
}: {
  selectedLoad: LoadSummary | null;
  onComplete: (
    result: ActionResult,
    successMessage: string,
  ) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [reason, setReason] = useState("");

  const disabled =
    !selectedLoad ||
    selectedLoad.status === "completed" ||
    selectedLoad.status === "cancelled";

  const confirm = () => {
    if (!selectedLoad) return;
    startTransition(async () => {
      const ok = await onComplete(
        cancelLoadAction({
          loadId: selectedLoad.id,
          reason,
        }),
        `${selectedLoad.code} cancelled`,
      );
      if (ok) {
        setReason("");
        setOpen(false);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="destructive" disabled={disabled}>
          Cancel Load
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel load</DialogTitle>
          <DialogDescription>
            This action marks the load as cancelled and cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="cancel-reason">Reason (optional)</Label>
            <Input
              id="cancel-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Keep load
          </Button>
          <Button
            variant="destructive"
            onClick={confirm}
            disabled={pending}
          >
            {pending ? "Cancelling..." : "Cancel load"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
