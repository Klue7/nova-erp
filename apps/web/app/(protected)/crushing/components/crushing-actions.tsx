"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
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
  cancelRunAction,
  completeRunAction,
  createRunAction,
  logDowntimeAction,
  recordOutputAction,
  startRunAction,
} from "../actions";

type MixBatchOption = {
  id: string;
  code: string;
  availableTonnes: number;
  completedAt: string | null;
};

type RunSummary = {
  id: string;
  code: string;
  status: string;
};

type Props = {
  mixBatches: MixBatchOption[];
  selectedRun: RunSummary | null;
};

const createRunSchema = z.object({
  code: z.string().min(1, "Run code is required"),
  targetTPH: z
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

const addInputSchema = z.object({
  mixBatchId: z.string().uuid("Select a mix batch"),
  quantityTonnes: z
    .union([z.number(), z.string()])
    .transform((value) => Number(value))
    .refine((value) => Number.isFinite(value) && value > 0, {
      message: "Quantity must be greater than zero",
    }),
  reference: z.string().trim().optional(),
});

const downtimeSchema = z.object({
  minutes: z
    .union([z.number(), z.string()])
    .transform((value) => Number(value))
    .refine((value) => Number.isFinite(value) && value > 0, {
      message: "Minutes must be greater than zero",
    }),
  reason: z.string().min(1, "Provide a reason"),
});

const outputSchema = z.object({
  outputTonnes: z
    .union([z.number(), z.string()])
    .transform((value) => Number(value))
    .refine((value) => Number.isFinite(value) && value >= 0, {
      message: "Output cannot be negative",
    }),
  finesPct: z
    .union([z.number(), z.string(), z.null(), z.undefined()])
    .transform((value) => {
      if (value === null || value === undefined) return undefined;
      const trimmed = typeof value === "string" ? value.trim() : value;
      if (trimmed === "") return undefined;
      const num = Number(trimmed);
      if (!Number.isFinite(num)) {
        throw new Error("Invalid fines percentage");
      }
      return num;
    })
    .optional(),
});

const cancelSchema = z.object({ reason: z.string().trim().optional() });

export function CrushingActions({ mixBatches, selectedRun }: Props) {
  const router = useRouter();
  const disabled = !selectedRun;

  const handleResult = async (
    promise: Promise<{ ok: boolean; error?: string }>,
    successMessage: string,
  ) => {
    const result = await promise;
    if (result.ok) {
      toast({ title: successMessage });
      router.refresh();
    } else {
      toast({
        title: "Action failed",
        description: result.error ?? "Unknown error",
        variant: "destructive",
      });
    }
    return result.ok;
  };

  return (
    <div className="flex flex-wrap gap-3">
      <CreateRunDialog onComplete={handleResult} />
      <AddInputDialog
        disabled={disabled}
        run={selectedRun}
        mixBatches={mixBatches}
        onComplete={handleResult}
      />
      <StartRunDialog
        disabled={disabled || selectedRun?.status !== "planned"}
        run={selectedRun}
        onComplete={handleResult}
      />
      <DowntimeDialog
        disabled={disabled || selectedRun?.status !== "active"}
        run={selectedRun}
        onComplete={handleResult}
      />
      <RecordOutputDialog
        disabled={disabled || selectedRun?.status !== "active"}
        run={selectedRun}
        onComplete={handleResult}
      />
      <CompleteRunDialog
        disabled={disabled || selectedRun?.status !== "active"}
        run={selectedRun}
        onComplete={handleResult}
      />
      <CancelRunDialog
        disabled={disabled || selectedRun?.status === "completed"}
        run={selectedRun}
        onComplete={handleResult}
      />
    </div>
  );
}

function CreateRunDialog({
  onComplete,
}: {
  onComplete: (
    result: Promise<{ ok: boolean; error?: string }>,
    successMessage: string,
  ) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const form = useForm<z.infer<typeof createRunSchema>>({
    resolver: zodResolver(createRunSchema),
    defaultValues: {
      code: "",
      targetTPH: undefined,
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const ok = await onComplete(
        createRunAction(values),
        `Run ${values.code} planned`,
      );
      if (ok) {
        form.reset();
        setOpen(false);
      }
    });
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Create Run</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create crushing run</DialogTitle>
          <DialogDescription>Plan a new crushing run.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="run-code">Run code</Label>
            <Input id="run-code" placeholder="CR-2025-001" {...form.register("code")} />
            {form.formState.errors.code ? (
              <p className="text-xs text-destructive">
                {form.formState.errors.code.message}
              </p>
            ) : null}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="run-target">Target TPH</Label>
            <Input id="run-target" type="number" step="0.1" {...form.register("targetTPH")} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving..." : "Create run"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AddInputDialog({
  disabled,
  run,
  mixBatches,
  onComplete,
}: {
  disabled: boolean;
  run: RunSummary | null;
  mixBatches: MixBatchOption[];
  onComplete: (
    result: Promise<{ ok: boolean; error?: string }>,
    successMessage: string,
  ) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const form = useForm<z.infer<typeof addInputSchema>>({
    resolver: zodResolver(addInputSchema),
    defaultValues: {
      mixBatchId: mixBatches[0]?.id ?? "",
      quantityTonnes: 0,
      reference: "",
    },
  });

  useEffect(() => {
    if (mixBatches.length > 0) {
      form.setValue("mixBatchId", mixBatches[0].id);
    }
  }, [mixBatches, form]);

  const onSubmit = form.handleSubmit((values) => {
    if (!run) return;
    startTransition(async () => {
      const payload = {
        runId: run.id,
        mixBatchId: values.mixBatchId,
        quantityTonnes: Number(values.quantityTonnes),
        reference: values.reference ?? undefined,
      };
      const ok = await onComplete(
        addInputAction(payload),
        `${values.quantityTonnes} t added to ${run.code}`,
      );
      if (ok) {
        form.reset({
          mixBatchId: mixBatches[0]?.id ?? "",
          quantityTonnes: 0,
          reference: "",
        });
        setOpen(false);
      }
    });
  });

  const options = useMemo(() => mixBatches, [mixBatches]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={disabled || mixBatches.length === 0}>
          Add Input
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add mix batch input</DialogTitle>
          <DialogDescription>
            Pull tonnage from a completed mix batch into run {run?.code ?? ""}.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="mix-batch">Mix batch</Label>
            <select
              id="mix-batch"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
              {...form.register("mixBatchId")}
            >
              {options.map((batch) => (
                <option key={batch.id} value={batch.id}>
                  {batch.code} • avail {batch.availableTonnes.toFixed(2)} t
                </option>
              ))}
            </select>
            {form.formState.errors.mixBatchId ? (
              <p className="text-xs text-destructive">
                {form.formState.errors.mixBatchId.message}
              </p>
            ) : null}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="mix-qty">Quantity (t)</Label>
            <Input id="mix-qty" type="number" step="0.1" {...form.register("quantityTonnes")} />
            {form.formState.errors.quantityTonnes ? (
              <p className="text-xs text-destructive">
                {form.formState.errors.quantityTonnes.message}
              </p>
            ) : null}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="mix-ref">Reference</Label>
            <Input id="mix-ref" {...form.register("reference")} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Adding..." : "Add input"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function StartRunDialog({
  disabled,
  run,
  onComplete,
}: {
  disabled: boolean;
  run: RunSummary | null;
  onComplete: (
    result: Promise<{ ok: boolean; error?: string }>,
    successMessage: string,
  ) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const confirm = () => {
    if (!run) return;
    startTransition(async () => {
      const ok = await onComplete(startRunAction({ runId: run.id }), `${run.code} started`);
      if (ok) {
        setOpen(false);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={disabled}>
          Start Run
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Start run</DialogTitle>
          <DialogDescription>Begin crushing run {run?.code ?? ""}.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={confirm} disabled={isPending}>
            {isPending ? "Starting..." : "Start"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DowntimeDialog({
  disabled,
  run,
  onComplete,
}: {
  disabled: boolean;
  run: RunSummary | null;
  onComplete: (
    result: Promise<{ ok: boolean; error?: string }>,
    successMessage: string,
  ) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const form = useForm<z.infer<typeof downtimeSchema>>({
    resolver: zodResolver(downtimeSchema),
    defaultValues: {
      minutes: 0,
      reason: "",
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    if (!run) return;
    startTransition(async () => {
      const ok = await onComplete(
        logDowntimeAction({
          runId: run.id,
          minutes: Number(values.minutes),
          reason: values.reason,
        }),
        `Downtime logged for ${run.code}`,
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
          Log Downtime
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Log downtime</DialogTitle>
          <DialogDescription>Capture downtime minutes for {run?.code ?? ""}.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="downtime-minutes">Minutes</Label>
            <Input
              id="downtime-minutes"
              type="number"
              step="1"
              {...form.register("minutes")}
            />
            {form.formState.errors.minutes ? (
              <p className="text-xs text-destructive">
                {form.formState.errors.minutes.message}
              </p>
            ) : null}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="downtime-reason">Reason</Label>
            <Input id="downtime-reason" {...form.register("reason")} />
            {form.formState.errors.reason ? (
              <p className="text-xs text-destructive">
                {form.formState.errors.reason.message}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving..." : "Log downtime"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RecordOutputDialog({
  disabled,
  run,
  onComplete,
}: {
  disabled: boolean;
  run: RunSummary | null;
  onComplete: (
    result: Promise<{ ok: boolean; error?: string }>,
    successMessage: string,
  ) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const form = useForm<z.infer<typeof outputSchema>>({
    resolver: zodResolver(outputSchema),
    defaultValues: {
      outputTonnes: 0,
      finesPct: undefined,
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    if (!run) return;
    startTransition(async () => {
      const ok = await onComplete(
        recordOutputAction({
          runId: run.id,
          outputTonnes: Number(values.outputTonnes),
          finesPct:
            values.finesPct === undefined || values.finesPct === null
              ? undefined
              : Number(values.finesPct),
        }),
        `Output logged for ${run.code}`,
      );
      if (ok) {
        form.reset({ outputTonnes: 0, finesPct: undefined });
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
          <DialogTitle>Record output</DialogTitle>
          <DialogDescription>Log production output for {run?.code ?? ""}.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="output-tonnes">Output (t)</Label>
            <Input
              id="output-tonnes"
              type="number"
              step="0.1"
              {...form.register("outputTonnes")}
            />
            {form.formState.errors.outputTonnes ? (
              <p className="text-xs text-destructive">
                {form.formState.errors.outputTonnes.message}
              </p>
            ) : null}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="output-fines">Fines %</Label>
            <Input
              id="output-fines"
              type="number"
              step="0.1"
              {...form.register("finesPct")}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Recording..." : "Record output"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CompleteRunDialog({
  disabled,
  run,
  onComplete,
}: {
  disabled: boolean;
  run: RunSummary | null;
  onComplete: (
    result: Promise<{ ok: boolean; error?: string }>,
    successMessage: string,
  ) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const confirm = () => {
    if (!run) return;
    startTransition(async () => {
      const ok = await onComplete(completeRunAction({ runId: run.id }), `${run.code} completed`);
      if (ok) {
        setOpen(false);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={disabled}>
          Complete Run
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Complete run</DialogTitle>
          <DialogDescription>Mark {run?.code ?? ""} as completed.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={confirm} disabled={isPending}>
            {isPending ? "Completing..." : "Complete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CancelRunDialog({
  disabled,
  run,
  onComplete,
}: {
  disabled: boolean;
  run: RunSummary | null;
  onComplete: (
    result: Promise<{ ok: boolean; error?: string }>,
    successMessage: string,
  ) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const form = useForm<z.infer<typeof cancelSchema>>({
    resolver: zodResolver(cancelSchema),
    defaultValues: {
      reason: "",
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    if (!run) return;
    startTransition(async () => {
      const ok = await onComplete(
        cancelRunAction({ runId: run.id, reason: values.reason ?? undefined }),
        `${run.code} cancelled`,
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
        <Button variant="outline" disabled={disabled}>
          Cancel Run
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel run</DialogTitle>
          <DialogDescription>Cancel crushing run {run?.code ?? ""}.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="cancel-reason">Reason</Label>
            <Input id="cancel-reason" {...form.register("reason")} />
          </div>
          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => setOpen(false)}>
              Keep run
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Cancelling..." : "Cancel run"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
