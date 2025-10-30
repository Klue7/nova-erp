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
  cancelBatchAction,
  completeBatchAction,
  createBatchAction,
  pauseBatchAction,
  recordFuelUsageAction,
  recordOutputAction,
  recordZoneTempAction,
  resumeBatchAction,
  startBatchAction,
} from "../actions";

type DryLoadOption = {
  id: string;
  code: string;
  availableUnits: number;
};

type BatchSummary = {
  id: string;
  code: string;
  status: string;
};

type Props = {
  dryLoads: DryLoadOption[];
  selectedBatch: BatchSummary | null;
};

type ActionResult = Promise<{ ok: boolean; error?: string }>;

export const createBatchSchema = z.object({
  code: z.string().min(1, "Batch code is required"),
  kilnCode: z.string().trim().optional(),
  firingCurveCode: z.string().trim().optional(),
  targetUnits: z
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
  dryLoadId: z.string().uuid("Select a dry load"),
  quantityUnits: z
    .union([z.number(), z.string()])
    .transform((value) => Number(value))
    .refine((value) => Number.isFinite(value) && value > 0, {
      message: "Quantity must be greater than zero",
    }),
  reference: z.string().trim().optional(),
});

export const pauseSchema = z.object({
  minutes: z
    .union([z.number(), z.string()])
    .transform((value) => Number(value))
    .refine((value) => Number.isFinite(value) && value > 0, {
      message: "Minutes must be greater than zero",
    }),
  reason: z.string().min(1, "Reason is required"),
});

export const zoneTempSchema = z.object({
  zone: z.string().min(1, "Zone is required"),
  temperatureC: z
    .union([z.number(), z.string()])
    .transform((value) => Number(value))
    .refine((value) => Number.isFinite(value) && value > 0, {
      message: "Temperature must be greater than zero",
    }),
});

export const fuelSchema = z.object({
  fuelType: z.string().min(1, "Fuel type is required"),
  amount: z
    .union([z.number(), z.string()])
    .transform((value) => Number(value))
    .refine((value) => Number.isFinite(value) && value > 0, {
      message: "Amount must be greater than zero",
    }),
  unit: z.string().min(1, "Unit is required"),
});

export const outputSchema = z.object({
  firedUnits: z
    .union([z.number(), z.string()])
    .transform((value) => Number(value))
    .refine((value) => Number.isFinite(value) && value >= 0, {
      message: "Fired units cannot be negative",
    }),
  shrinkagePct: z
    .union([z.number(), z.string(), z.null(), z.undefined()])
    .transform((value) => {
      if (value === null || value === undefined) return undefined;
      const trimmed = typeof value === "string" ? value.trim() : value;
      if (trimmed === "") return undefined;
      const num = Number(trimmed);
      if (!Number.isFinite(num)) {
        throw new Error("Invalid shrinkage percent");
      }
      return num;
    })
    .optional(),
});

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

export function KilnActions({ dryLoads, selectedBatch }: Props) {
  const router = useRouter();

  const handleResult = async (
    promise: ActionResult,
    successMessage: string,
  ) => {
    const result = await promise;
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
      <CreateBatchDialog onComplete={handleResult} />
      <AddInputDialog
        dryLoads={dryLoads}
        selectedBatch={selectedBatch}
        onComplete={handleResult}
      />
      <StartBatchButton
        selectedBatch={selectedBatch}
        onComplete={handleResult}
      />
      <PauseBatchDialog
        selectedBatch={selectedBatch}
        onComplete={handleResult}
      />
      <ResumeBatchButton
        selectedBatch={selectedBatch}
        onComplete={handleResult}
      />
      <RecordZoneTempDialog
        selectedBatch={selectedBatch}
        onComplete={handleResult}
      />
      <RecordFuelDialog
        selectedBatch={selectedBatch}
        onComplete={handleResult}
      />
      <RecordOutputDialog
        selectedBatch={selectedBatch}
        onComplete={handleResult}
      />
      <CompleteBatchButton
        selectedBatch={selectedBatch}
        onComplete={handleResult}
      />
      <CancelBatchDialog
        selectedBatch={selectedBatch}
        onComplete={handleResult}
      />
    </div>
  );
}

function CreateBatchDialog({
  onComplete,
}: {
  onComplete: (
    result: ActionResult,
    successMessage: string,
  ) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const form = useForm<z.infer<typeof createBatchSchema>>({
    resolver: zodResolver(createBatchSchema),
    defaultValues: {
      code: "",
      kilnCode: "",
      firingCurveCode: "",
      targetUnits: undefined,
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const ok = await onComplete(
        createBatchAction(values),
        `Kiln batch ${values.code} planned`,
      );
      if (ok) {
        form.reset({
          code: "",
          kilnCode: "",
          firingCurveCode: "",
          targetUnits: undefined,
        });
        setOpen(false);
      }
    });
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Create Batch</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Plan kiln batch</DialogTitle>
          <DialogDescription>
            Define kiln, firing curve, and optional target units.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="batch-code">Batch code</Label>
            <Input id="batch-code" {...form.register("code")} />
            <FormError form={form} field="code" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="batch-kiln">Kiln code</Label>
            <Input id="batch-kiln" {...form.register("kilnCode")} />
            <FormError form={form} field="kilnCode" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="batch-curve">Firing curve</Label>
            <Input id="batch-curve" {...form.register("firingCurveCode")} />
            <FormError form={form} field="firingCurveCode" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="batch-target">Target units</Label>
            <Input
              id="batch-target"
              type="number"
              step="1"
              {...form.register("targetUnits")}
            />
            <FormError form={form} field="targetUnits" />
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
              {pending ? "Planning..." : "Plan batch"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AddInputDialog({
  dryLoads,
  selectedBatch,
  onComplete,
}: {
  dryLoads: DryLoadOption[];
  selectedBatch: BatchSummary | null;
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
      dryLoadId: dryLoads[0]?.id ?? "",
      quantityUnits: 0,
      reference: "",
    },
  });

  useEffect(() => {
    if (!open) {
      form.reset({
        dryLoadId: dryLoads[0]?.id ?? "",
        quantityUnits: 0,
        reference: "",
      });
    }
  }, [open, dryLoads, form]);

  const disabled =
    !selectedBatch ||
    dryLoads.length === 0 ||
    !["planned", "active"].includes(selectedBatch.status);

  const onSubmit = form.handleSubmit((values) => {
    if (!selectedBatch) return;
    startTransition(async () => {
      const ok = await onComplete(
        addInputAction({
          batchId: selectedBatch.id,
          dryLoadId: values.dryLoadId,
          quantityUnits: Number(values.quantityUnits),
          reference: values.reference ?? "",
        }),
        `${values.quantityUnits} units added to ${selectedBatch.code}`,
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
          Add Input
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add dry load input</DialogTitle>
          <DialogDescription>
            Assign dried units to {selectedBatch?.code ?? "batch"}.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="input-dry-load">Dry load</Label>
            <select
              id="input-dry-load"
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              {...form.register("dryLoadId")}
            >
              <option value="" disabled>
                Select dry load
              </option>
              {dryLoads.map((load) => (
                <option key={load.id} value={load.id}>
                  {load.code} • {load.availableUnits.toFixed(0)} units
                </option>
              ))}
            </select>
            <FormError form={form} field="dryLoadId" />
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
              disabled={pending || dryLoads.length === 0}
            >
              {pending ? "Logging..." : "Log input"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function StartBatchButton({
  selectedBatch,
  onComplete,
}: {
  selectedBatch: BatchSummary | null;
  onComplete: (
    result: ActionResult,
    successMessage: string,
  ) => Promise<boolean>;
}) {
  const [pending, startTransition] = useTransition();
  const disabled =
    !selectedBatch || selectedBatch.status !== "planned" || pending;

  const start = () => {
    if (!selectedBatch) return;
    startTransition(async () => {
      await onComplete(
        startBatchAction({ batchId: selectedBatch.id }),
        `${selectedBatch.code} started`,
      );
    });
  };

  return (
    <Button variant="outline" disabled={disabled} onClick={start}>
      {pending ? "Starting..." : "Start Batch"}
    </Button>
  );
}

function PauseBatchDialog({
  selectedBatch,
  onComplete,
}: {
  selectedBatch: BatchSummary | null;
  onComplete: (
    result: ActionResult,
    successMessage: string,
  ) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const form = useForm<z.infer<typeof pauseSchema>>({
    resolver: zodResolver(pauseSchema),
    defaultValues: {
      minutes: 0,
      reason: "",
    },
  });

  const disabled = !selectedBatch || selectedBatch.status !== "active";

  const onSubmit = form.handleSubmit((values) => {
    if (!selectedBatch) return;
    startTransition(async () => {
      const ok = await onComplete(
        pauseBatchAction({
          batchId: selectedBatch.id,
          minutes: Number(values.minutes),
          reason: values.reason,
        }),
        `${selectedBatch.code} paused`,
      );
      if (ok) {
        form.reset({ minutes: 0, reason: "" });
        setOpen(false);
      }
    });
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={disabled}>
          Pause Batch
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Log downtime</DialogTitle>
          <DialogDescription>
            Record downtime minutes for {selectedBatch?.code ?? ""}.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="pause-minutes">Minutes</Label>
            <Input
              id="pause-minutes"
              type="number"
              step="1"
              {...form.register("minutes")}
            />
            <FormError form={form} field="minutes" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="pause-reason">Reason</Label>
            <Input id="pause-reason" {...form.register("reason")} />
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
              {pending ? "Pausing..." : "Pause"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ResumeBatchButton({
  selectedBatch,
  onComplete,
}: {
  selectedBatch: BatchSummary | null;
  onComplete: (
    result: ActionResult,
    successMessage: string,
  ) => Promise<boolean>;
}) {
  const [pending, startTransition] = useTransition();
  const disabled =
    !selectedBatch || selectedBatch.status !== "paused" || pending;

  const resume = () => {
    if (!selectedBatch) return;
    startTransition(async () => {
      await onComplete(
        resumeBatchAction({ batchId: selectedBatch.id }),
        `${selectedBatch.code} resumed`,
      );
    });
  };

  return (
    <Button variant="outline" disabled={disabled} onClick={resume}>
      {pending ? "Resuming..." : "Resume"}
    </Button>
  );
}

function RecordZoneTempDialog({
  selectedBatch,
  onComplete,
}: {
  selectedBatch: BatchSummary | null;
  onComplete: (
    result: ActionResult,
    successMessage: string,
  ) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const form = useForm<z.infer<typeof zoneTempSchema>>({
    resolver: zodResolver(zoneTempSchema),
    defaultValues: {
      zone: "",
      temperatureC: 0,
    },
  });

  const disabled = !selectedBatch;

  const onSubmit = form.handleSubmit((values) => {
    if (!selectedBatch) return;
    startTransition(async () => {
      const ok = await onComplete(
        recordZoneTempAction({
          batchId: selectedBatch.id,
          zone: values.zone,
          temperatureC: Number(values.temperatureC),
        }),
        `Temperature logged for ${selectedBatch.code}`,
      );
      if (ok) {
        form.reset({ zone: "", temperatureC: 0 });
        setOpen(false);
      }
    });
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={disabled}>
          Record Zone Temp
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record zone temperature</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="zone-name">Zone</Label>
            <Input id="zone-name" {...form.register("zone")} />
            <FormError form={form} field="zone" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="zone-temp">Temperature (°C)</Label>
            <Input
              id="zone-temp"
              type="number"
              step="1"
              {...form.register("temperatureC")}
            />
            <FormError form={form} field="temperatureC" />
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

function RecordFuelDialog({
  selectedBatch,
  onComplete,
}: {
  selectedBatch: BatchSummary | null;
  onComplete: (
    result: ActionResult,
    successMessage: string,
  ) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const form = useForm<z.infer<typeof fuelSchema>>({
    resolver: zodResolver(fuelSchema),
    defaultValues: {
      fuelType: "",
      amount: 0,
      unit: "kg",
    },
  });

  const disabled = !selectedBatch;

  const onSubmit = form.handleSubmit((values) => {
    if (!selectedBatch) return;
    startTransition(async () => {
      const ok = await onComplete(
        recordFuelUsageAction({
          batchId: selectedBatch.id,
          fuelType: values.fuelType,
          amount: Number(values.amount),
          unit: values.unit,
        }),
        `Fuel usage logged for ${selectedBatch.code}`,
      );
      if (ok) {
        form.reset({ fuelType: "", amount: 0, unit: "kg" });
        setOpen(false);
      }
    });
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={disabled}>
          Record Fuel
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record fuel usage</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="fuel-type">Fuel type</Label>
            <Input id="fuel-type" {...form.register("fuelType")} />
            <FormError form={form} field="fuelType" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="fuel-amount">Amount</Label>
            <Input
              id="fuel-amount"
              type="number"
              step="0.1"
              {...form.register("amount")}
            />
            <FormError form={form} field="amount" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="fuel-unit">Unit</Label>
            <Input id="fuel-unit" {...form.register("unit")} />
            <FormError form={form} field="unit" />
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

function RecordOutputDialog({
  selectedBatch,
  onComplete,
}: {
  selectedBatch: BatchSummary | null;
  onComplete: (
    result: ActionResult,
    successMessage: string,
  ) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const form = useForm<z.infer<typeof outputSchema>>({
    resolver: zodResolver(outputSchema),
    defaultValues: {
      firedUnits: 0,
      shrinkagePct: undefined,
    },
  });

  const disabled = !selectedBatch;

  const onSubmit = form.handleSubmit((values) => {
    if (!selectedBatch) return;
    startTransition(async () => {
      const ok = await onComplete(
        recordOutputAction({
          batchId: selectedBatch.id,
          firedUnits: Number(values.firedUnits),
          shrinkagePct: values.shrinkagePct ?? undefined,
        }),
        `Output logged for ${selectedBatch.code}`,
      );
      if (ok) {
        form.reset({ firedUnits: 0, shrinkagePct: undefined });
        setOpen(false);
      }
    });
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={disabled}>
          Record Output
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record kiln output</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="output-units">Fired units</Label>
            <Input
              id="output-units"
              type="number"
              step="1"
              {...form.register("firedUnits")}
            />
            <FormError form={form} field="firedUnits" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="output-shrinkage">Shrinkage %</Label>
            <Input
              id="output-shrinkage"
              type="number"
              step="0.1"
              {...form.register("shrinkagePct")}
            />
            <FormError form={form} field="shrinkagePct" />
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

function CompleteBatchButton({
  selectedBatch,
  onComplete,
}: {
  selectedBatch: BatchSummary | null;
  onComplete: (
    result: ActionResult,
    successMessage: string,
  ) => Promise<boolean>;
}) {
  const [pending, startTransition] = useTransition();
  const disabled =
    !selectedBatch || selectedBatch.status !== "active" || pending;

  const complete = () => {
    if (!selectedBatch) return;
    startTransition(async () => {
      await onComplete(
        completeBatchAction({ batchId: selectedBatch.id }),
        `${selectedBatch.code} completed`,
      );
    });
  };

  return (
    <Button variant="outline" disabled={disabled} onClick={complete}>
      {pending ? "Completing..." : "Complete Batch"}
    </Button>
  );
}

function CancelBatchDialog({
  selectedBatch,
  onComplete,
}: {
  selectedBatch: BatchSummary | null;
  onComplete: (
    result: ActionResult,
    successMessage: string,
  ) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [reason, setReason] = useState("");

  const disabled =
    !selectedBatch ||
    selectedBatch.status === "completed" ||
    selectedBatch.status === "cancelled";

  const confirm = () => {
    if (!selectedBatch) return;
    startTransition(async () => {
      const ok = await onComplete(
        cancelBatchAction({
          batchId: selectedBatch.id,
          reason,
        }),
        `${selectedBatch.code} cancelled`,
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
          Cancel Batch
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel batch</DialogTitle>
          <DialogDescription>
            This marks the batch as cancelled and cannot be undone.
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
            Keep batch
          </Button>
          <Button
            variant="destructive"
            onClick={confirm}
            disabled={pending}
          >
            {pending ? "Cancelling..." : "Cancel batch"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
