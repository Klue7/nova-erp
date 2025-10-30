"use client";

import { useEffect, useState, useTransition } from "react";
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
  changeDieAction,
  completeRunAction,
  createRunAction,
  pauseRunAction,
  recordOutputAction,
  recordScrapAction,
  resumeRunAction,
  startRunAction,
} from "../actions";

type CrushRunOption = {
  id: string;
  code: string;
  availableTonnes: number;
};

type RunSummary = {
  id: string;
  code: string;
  status: string;
  dieCode?: string | null;
};

type Props = {
  crushRuns: CrushRunOption[];
  selectedRun: RunSummary | null;
};

export const createRunSchema = z.object({
  code: z.string().min(1, "Run code is required"),
  pressLine: z.string().trim().optional(),
  dieCode: z.string().trim().optional(),
  productSku: z.string().trim().optional(),
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
  crushRunId: z.string().uuid("Select a crushing run"),
  quantityTonnes: z
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
  reason: z.string().min(1, "Provide a reason"),
});

export const outputSchema = z.object({
  outputUnits: z
    .union([z.number(), z.string()])
    .transform((value) => Number(value))
    .refine((value) => Number.isFinite(value) && value >= 0, {
      message: "Output cannot be negative",
    }),
  meters: z
    .union([z.number(), z.string(), z.null(), z.undefined()])
    .transform((value) => {
      if (value === null || value === undefined) return undefined;
      const trimmed = typeof value === "string" ? value.trim() : value;
      if (trimmed === "") return undefined;
      const num = Number(trimmed);
      if (!Number.isFinite(num)) {
        throw new Error("Invalid meters value");
      }
      return num;
    })
    .optional(),
  weightTonnes: z
    .union([z.number(), z.string(), z.null(), z.undefined()])
    .transform((value) => {
      if (value === null || value === undefined) return undefined;
      const trimmed = typeof value === "string" ? value.trim() : value;
      if (trimmed === "") return undefined;
      const num = Number(trimmed);
      if (!Number.isFinite(num)) {
        throw new Error("Invalid weight value");
      }
      return num;
    })
    .optional(),
});

export const scrapSchema = z.object({
  scrapUnits: z
    .union([z.number(), z.string()])
    .transform((value) => Number(value))
    .refine((value) => Number.isFinite(value) && value > 0, {
      message: "Scrap must be greater than zero",
    }),
  reason: z.string().trim().optional(),
});

export const changeDieSchema = z.object({
  dieCode: z.string().min(1, "Die code is required"),
});

type ResultPromise = Promise<{ ok: boolean; error?: string }>;

export function ExtrusionActions({ crushRuns, selectedRun }: Props) {
  const router = useRouter();
  const disabled = !selectedRun;

  const handleResult = async (
    promise: ResultPromise,
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
      <CreateRunDialog onComplete={handleResult} />
      <AddInputDialog
        disabled={disabled}
        crushRuns={crushRuns}
        run={selectedRun}
        onComplete={handleResult}
      />
      <StartRunDialog
        disabled={disabled || selectedRun?.status !== "planned"}
        run={selectedRun}
        onComplete={handleResult}
      />
      <PauseRunDialog
        disabled={disabled || selectedRun?.status !== "active"}
        run={selectedRun}
        onComplete={handleResult}
      />
      <ResumeRunDialog
        disabled={disabled || selectedRun?.status !== "paused"}
        run={selectedRun}
        onComplete={handleResult}
      />
      <RecordOutputDialog
        disabled={disabled || selectedRun?.status !== "active"}
        run={selectedRun}
        onComplete={handleResult}
      />
      <RecordScrapDialog
        disabled={disabled}
        run={selectedRun}
        onComplete={handleResult}
      />
      <ChangeDieDialog
        disabled={disabled}
        run={selectedRun}
        onComplete={handleResult}
      />
      <CompleteRunDialog
        disabled={disabled || selectedRun?.status !== "active"}
        run={selectedRun}
        onComplete={handleResult}
      />
      <CancelRunDialog
        disabled={
          disabled ||
          selectedRun?.status === "completed" ||
          selectedRun?.status === "cancelled"
        }
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
    result: ResultPromise,
    successMessage: string,
  ) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const form = useForm<z.infer<typeof createRunSchema>>({
    resolver: zodResolver(createRunSchema),
    defaultValues: {
      code: "",
      pressLine: "",
      dieCode: "",
      productSku: "",
      targetUnits: undefined,
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const ok = await onComplete(
        createRunAction(values),
        `Extrusion run ${values.code} planned`,
      );
      if (ok) {
        form.reset({
          code: "",
          pressLine: "",
          dieCode: "",
          productSku: "",
          targetUnits: undefined,
        });
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
          <DialogTitle>Create extrusion run</DialogTitle>
          <DialogDescription>
            Define extrusion metadata before consuming crushed output.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="run-code">Run code</Label>
            <Input id="run-code" {...form.register("code")} />
            <FormError form={form} field="code" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="run-press">Press line</Label>
            <Input id="run-press" {...form.register("pressLine")} />
            <FormError form={form} field="pressLine" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="run-die">Die code</Label>
            <Input id="run-die" {...form.register("dieCode")} />
            <FormError form={form} field="dieCode" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="run-sku">Product SKU</Label>
            <Input id="run-sku" {...form.register("productSku")} />
            <FormError form={form} field="productSku" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="run-target">Target units</Label>
            <Input
              id="run-target"
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
            <Button type="submit" disabled={isPending}>
              {isPending ? "Creating..." : "Create"}
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
  crushRuns,
  onComplete,
}: {
  disabled: boolean;
  run: RunSummary | null;
  crushRuns: CrushRunOption[];
  onComplete: (
    result: ResultPromise,
    successMessage: string,
  ) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const form = useForm<z.infer<typeof addInputSchema>>({
    resolver: zodResolver(addInputSchema),
    defaultValues: {
      crushRunId: crushRuns[0]?.id ?? "",
      quantityTonnes: 0,
      reference: "",
    },
  });

  useEffect(() => {
    if (!open) {
      form.reset({
        crushRunId: crushRuns[0]?.id ?? "",
        quantityTonnes: 0,
        reference: "",
      });
    }
  }, [open, crushRuns, form]);

  const onSubmit = form.handleSubmit((values) => {
    if (!run) return;
    startTransition(async () => {
      const ok = await onComplete(
        addInputAction({
          runId: run.id,
          crushRunId: values.crushRunId,
          quantityTonnes: Number(values.quantityTonnes),
          reference: values.reference ? values.reference : undefined,
        }),
        `Input logged for ${run.code}`,
      );
      if (ok) {
        form.reset({
          crushRunId: crushRuns[0]?.id ?? "",
          quantityTonnes: 0,
          reference: "",
        });
        setOpen(false);
      }
    });
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          disabled={disabled || crushRuns.length === 0}
        >
          Add Input
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add crushed input</DialogTitle>
          <DialogDescription>
            Consume crushed output for {run?.code ?? ""}.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="input-crush-run">Crushing run</Label>
            <select
              id="input-crush-run"
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              {...form.register("crushRunId")}
            >
              <option value="" disabled>
                Select a run
              </option>
              {crushRuns.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.code} • {option.availableTonnes.toFixed(2)} t avail.
                </option>
              ))}
            </select>
            <FormError form={form} field="crushRunId" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="input-quantity">Quantity (t)</Label>
            <Input
              id="input-quantity"
              type="number"
              step="0.1"
              {...form.register("quantityTonnes")}
            />
            <FormError form={form} field="quantityTonnes" />
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
            <Button type="submit" disabled={isPending || crushRuns.length === 0}>
              {isPending ? "Logging..." : "Log input"}
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
    result: ResultPromise,
    successMessage: string,
  ) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const confirm = () => {
    if (!run) return;
    startTransition(async () => {
      const ok = await onComplete(
        startRunAction({ runId: run.id }),
        `${run.code} started`,
      );
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
          <DialogDescription>
            Begin extrusion run {run?.code ?? ""}.
          </DialogDescription>
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

function PauseRunDialog({
  disabled,
  run,
  onComplete,
}: {
  disabled: boolean;
  run: RunSummary | null;
  onComplete: (
    result: ResultPromise,
    successMessage: string,
  ) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const form = useForm<z.infer<typeof pauseSchema>>({
    resolver: zodResolver(pauseSchema),
    defaultValues: {
      minutes: 0,
      reason: "",
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    if (!run) return;
    startTransition(async () => {
      const ok = await onComplete(
        pauseRunAction({
          runId: run.id,
          minutes: Number(values.minutes),
          reason: values.reason,
        }),
        `${run.code} paused`,
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
          Pause Run
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pause run</DialogTitle>
          <DialogDescription>
            Record downtime for {run?.code ?? ""}.
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
            <Button type="submit" disabled={isPending}>
              {isPending ? "Pausing..." : "Pause"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ResumeRunDialog({
  disabled,
  run,
  onComplete,
}: {
  disabled: boolean;
  run: RunSummary | null;
  onComplete: (
    result: ResultPromise,
    successMessage: string,
  ) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const confirm = () => {
    if (!run) return;
    startTransition(async () => {
      const ok = await onComplete(
        resumeRunAction({ runId: run.id }),
        `${run.code} resumed`,
      );
      if (ok) {
        setOpen(false);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={disabled}>
          Resume Run
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Resume run</DialogTitle>
          <DialogDescription>
            Restart extrusion run {run?.code ?? ""}.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={confirm} disabled={isPending}>
            {isPending ? "Resuming..." : "Resume"}
          </Button>
        </DialogFooter>
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
    result: ResultPromise,
    successMessage: string,
  ) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const form = useForm<z.infer<typeof outputSchema>>({
    resolver: zodResolver(outputSchema),
    defaultValues: {
      outputUnits: 0,
      meters: undefined,
      weightTonnes: undefined,
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    if (!run) return;
    startTransition(async () => {
      const ok = await onComplete(
        recordOutputAction({
          runId: run.id,
          outputUnits: Number(values.outputUnits),
          meters: values.meters ?? undefined,
          weightTonnes: values.weightTonnes ?? undefined,
        }),
        `Output recorded for ${run.code}`,
      );
      if (ok) {
        form.reset({ outputUnits: 0, meters: undefined, weightTonnes: undefined });
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
          <DialogDescription>
            Capture production for {run?.code ?? ""}.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="output-units">Output units</Label>
            <Input
              id="output-units"
              type="number"
              step="1"
              {...form.register("outputUnits")}
            />
            <FormError form={form} field="outputUnits" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="output-meters">Meters (optional)</Label>
            <Input
              id="output-meters"
              type="number"
              step="0.01"
              {...form.register("meters")}
            />
            <FormError form={form} field="meters" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="output-weight">Weight (t, optional)</Label>
            <Input
              id="output-weight"
              type="number"
              step="0.01"
              {...form.register("weightTonnes")}
            />
            <FormError form={form} field="weightTonnes" />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Recording..." : "Record"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RecordScrapDialog({
  disabled,
  run,
  onComplete,
}: {
  disabled: boolean;
  run: RunSummary | null;
  onComplete: (
    result: ResultPromise,
    successMessage: string,
  ) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const form = useForm<z.infer<typeof scrapSchema>>({
    resolver: zodResolver(scrapSchema),
    defaultValues: {
      scrapUnits: 0,
      reason: "",
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    if (!run) return;
    startTransition(async () => {
      const ok = await onComplete(
        recordScrapAction({
          runId: run.id,
          scrapUnits: Number(values.scrapUnits),
          reason: values.reason ? values.reason : undefined,
        }),
        `Scrap logged for ${run.code}`,
      );
      if (ok) {
        form.reset({ scrapUnits: 0, reason: "" });
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
            Capture scrap for {run?.code ?? ""}.
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
            <Button type="submit" disabled={isPending}>
              {isPending ? "Recording..." : "Record"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ChangeDieDialog({
  disabled,
  run,
  onComplete,
}: {
  disabled: boolean;
  run: RunSummary | null;
  onComplete: (
    result: ResultPromise,
    successMessage: string,
  ) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const form = useForm<z.infer<typeof changeDieSchema>>({
    resolver: zodResolver(changeDieSchema),
    defaultValues: {
      dieCode: run?.dieCode ?? "",
    },
  });

  useEffect(() => {
    form.reset({ dieCode: run?.dieCode ?? "" });
  }, [run, form]);

  const onSubmit = form.handleSubmit((values) => {
    if (!run) return;
    startTransition(async () => {
      const ok = await onComplete(
        changeDieAction({
          runId: run.id,
          dieCode: values.dieCode,
        }),
        `Die updated for ${run.code}`,
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
          Change Die
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Update die</DialogTitle>
          <DialogDescription>
            Set the active die for {run?.code ?? ""}.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="die-code">Die code</Label>
            <Input id="die-code" {...form.register("dieCode")} />
            <FormError form={form} field="dieCode" />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Updating..." : "Update"}
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
    result: ResultPromise,
    successMessage: string,
  ) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const confirm = () => {
    if (!run) return;
    startTransition(async () => {
      const ok = await onComplete(
        completeRunAction({ runId: run.id }),
        `${run.code} completed`,
      );
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
          <DialogDescription>
            Mark extrusion run {run?.code ?? ""} as completed.
          </DialogDescription>
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
    result: ResultPromise,
    successMessage: string,
  ) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const form = useForm<{ reason: string }>({
    defaultValues: { reason: "" },
  });

  const confirm = () => {
    if (!run) return;
    const reason = form.getValues("reason")?.trim();
    startTransition(async () => {
      const ok = await onComplete(
        cancelRunAction({
          runId: run.id,
          reason: reason ? reason : undefined,
        }),
        `${run.code} cancelled`,
      );
      if (ok) {
        form.reset({ reason: "" });
        setOpen(false);
      }
    });
  };

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
          <DialogDescription>
            Cancel extrusion run {run?.code ?? ""}. This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="cancel-reason">Reason (optional)</Label>
            <Input id="cancel-reason" {...form.register("reason")} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            No
          </Button>
          <Button onClick={confirm} disabled={isPending} variant="destructive">
            {isPending ? "Cancelling..." : "Cancel run"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FormError({
  form,
  field,
}: {
  form:
    | ReturnType<typeof useForm<z.infer<typeof createRunSchema>>>
    | ReturnType<typeof useForm<z.infer<typeof addInputSchema>>>
    | ReturnType<typeof useForm<z.infer<typeof pauseSchema>>>
    | ReturnType<typeof useForm<z.infer<typeof outputSchema>>>
    | ReturnType<typeof useForm<z.infer<typeof scrapSchema>>>
    | ReturnType<typeof useForm<z.infer<typeof changeDieSchema>>>
    | ReturnType<typeof useForm<{ reason: string }>>;
  field: string;
}) {
  const errors = form.formState.errors as Record<string, { message?: unknown }>;
  const message = errors[field]?.message;
  if (!message) return null;
  return <p className="text-xs text-destructive">{String(message)}</p>;
}
