"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
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
  addComponentAction,
  cancelBatchAction,
  completeBatchAction,
  createBatchAction,
  removeComponentAction,
  startBatchAction,
} from "../actions";

type StockpileOption = {
  id: string;
  code: string;
  name?: string | null;
  availableTonnes: number;
};

type ComponentOption = {
  stockpileId: string;
  stockpileCode: string;
  remainingTonnes: number;
};

type BatchSummary = {
  id: string;
  code: string;
  status: string;
};

type Props = {
  stockpiles: StockpileOption[];
  componentOptions: ComponentOption[];
  selectedBatch: BatchSummary | null;
};

const quantitiesSchema = z
  .union([z.number(), z.string()])
  .transform((value) => Number(value))
  .refine((value) => Number.isFinite(value) && value > 0, {
    message: "Quantity must be greater than zero",
  });

const createBatchSchema = z.object({
  code: z.string().min(1, "Batch code is required"),
  targetOutputTonnes: z
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

const addComponentSchema = z.object({
  stockpileId: z.string().uuid("Select a stockpile"),
  quantityTonnes: quantitiesSchema,
  materialType: z.string().min(1, "Material type is required"),
  reference: z.string().trim().optional(),
});

const removeComponentSchema = z.object({
  stockpileId: z.string().uuid("Select a stockpile"),
  quantityTonnes: quantitiesSchema,
  reference: z.string().trim().optional(),
});

const completeBatchSchema = z.object({
  outputTonnes: z
    .union([z.number(), z.string(), z.null(), z.undefined()])
    .transform((value) => {
      if (value === null || value === undefined) return undefined;
      const trimmed = typeof value === "string" ? value.trim() : value;
      if (trimmed === "") return undefined;
      const num = Number(trimmed);
      return Number.isFinite(num) ? num : undefined;
    })
    .optional(),
  moisturePct: z
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

const cancelBatchSchema = z.object({
  reason: z.string().trim().optional(),
});

type GenericForm = UseFormReturn<Record<string, unknown>>;

export function MixingActions({
  stockpiles,
  componentOptions,
  selectedBatch,
}: Props) {
  const disabled = !selectedBatch;
  const router = useRouter();

  const handleResult = (result: Awaited<ReturnType<typeof createBatchAction>>) => {
    if (result.ok) {
      router.refresh();
      return true;
    }
    toast({
      title: "Action failed",
      description: result.error,
      variant: "destructive",
    });
    return false;
  };

  return (
    <div className="flex flex-wrap gap-3">
      <CreateBatchDialog onComplete={handleResult} />
      <AddComponentDialog
        disabled={disabled}
        batch={selectedBatch}
        stockpiles={stockpiles}
        onComplete={handleResult}
      />
      <RemoveComponentDialog
        disabled={disabled || componentOptions.length === 0}
        batch={selectedBatch}
        components={componentOptions}
        onComplete={handleResult}
      />
      <StartBatchDialog
        disabled={disabled || selectedBatch?.status !== "planned"}
        batch={selectedBatch}
        onComplete={handleResult}
      />
      <CompleteBatchDialog
        disabled={disabled || selectedBatch?.status !== "active"}
        batch={selectedBatch}
        onComplete={handleResult}
      />
      <CancelBatchDialog
        disabled={disabled || selectedBatch?.status === "completed"}
        batch={selectedBatch}
        onComplete={handleResult}
      />
    </div>
  );
}

function formError(form: GenericForm, field: string) {
  const message = form.formState.errors[field]?.message;
  return message ? (
    <p className="text-xs text-destructive">{String(message)}</p>
  ) : null;
}

function CreateBatchDialog({
  onComplete,
}: {
  onComplete: (result: Awaited<ReturnType<typeof createBatchAction>>) => boolean;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const form = useForm<z.infer<typeof createBatchSchema>>({
    resolver: zodResolver(createBatchSchema),
    defaultValues: {
      code: "",
      targetOutputTonnes: undefined,
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const result = await createBatchAction(values);
      if (onComplete(result)) {
        toast({
          title: "Batch created",
          description: `Mix batch ${values.code} is now planned.`,
        });
        form.reset();
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
          <DialogTitle>Create mixing batch</DialogTitle>
          <DialogDescription>
            Define batch metadata before scheduling inputs.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="batch-code">Batch code</Label>
            <Input id="batch-code" placeholder="MB-2025-001" {...form.register("code")} />
            {formError(form, "code")}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="batch-target">Target output (t)</Label>
            <Input
              id="batch-target"
              type="number"
              step="0.1"
              {...form.register("targetOutputTonnes")}
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Creating..." : "Create batch"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AddComponentDialog({
  disabled,
  batch,
  stockpiles,
  onComplete,
}: {
  disabled: boolean;
  batch: BatchSummary | null;
  stockpiles: StockpileOption[];
  onComplete: (result: Awaited<ReturnType<typeof addComponentAction>>) => boolean;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const form = useForm<z.infer<typeof addComponentSchema>>({
    resolver: zodResolver(addComponentSchema),
    defaultValues: {
      stockpileId: stockpiles[0]?.id ?? "",
      quantityTonnes: 0,
      materialType: "",
      reference: "",
    },
  });

  useEffect(() => {
    if (stockpiles.length > 0) {
      form.setValue("stockpileId", stockpiles[0].id);
    }
  }, [stockpiles, form]);

  const onSubmit = form.handleSubmit((values) => {
    if (!batch) return;
    startTransition(async () => {
      const payload = {
        batchId: batch.id,
        stockpileId: values.stockpileId,
        quantityTonnes: Number(values.quantityTonnes),
        materialType: values.materialType,
        reference: values.reference ?? undefined,
      };
      const result = await addComponentAction(payload);
      if (onComplete(result)) {
        toast({
          title: "Component added",
          description: `${values.quantityTonnes} t added from stockpile`,
        });
        form.reset({
          stockpileId: stockpiles[0]?.id ?? "",
          quantityTonnes: 0,
          materialType: "",
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
          Add Component
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add component</DialogTitle>
          <DialogDescription>
            Withdraw material from a stockpile and associate it with the batch.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <StockpileSelect form={form} stockpiles={stockpiles} />
          <div className="grid gap-2">
            <Label htmlFor="component-qty">Quantity (t)</Label>
            <Input
              id="component-qty"
              type="number"
              step="0.1"
              {...form.register("quantityTonnes")}
            />
            {formError(form, "quantityTonnes")}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="component-material">Material type</Label>
            <Input
              id="component-material"
              placeholder="Clay A"
              {...form.register("materialType")}
            />
            {formError(form, "materialType")}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="component-ref">Reference</Label>
            <Input id="component-ref" {...form.register("reference")} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Adding..." : "Add component"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RemoveComponentDialog({
  disabled,
  batch,
  components,
  onComplete,
}: {
  disabled: boolean;
  batch: BatchSummary | null;
  components: ComponentOption[];
  onComplete: (result: Awaited<ReturnType<typeof removeComponentAction>>) => boolean;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const form = useForm<z.infer<typeof removeComponentSchema>>({
    resolver: zodResolver(removeComponentSchema),
    defaultValues: {
      stockpileId: components[0]?.stockpileId ?? "",
      quantityTonnes: 0,
      reference: "",
    },
  });

  useEffect(() => {
    if (components.length > 0) {
      form.setValue("stockpileId", components[0].stockpileId);
    }
  }, [components, form]);

  const onSubmit = form.handleSubmit((values) => {
    if (!batch) return;
    startTransition(async () => {
      const payload = {
        batchId: batch.id,
        stockpileId: values.stockpileId,
        quantityTonnes: Number(values.quantityTonnes),
        reference: values.reference ?? undefined,
      };
      const result = await removeComponentAction(payload);
      if (onComplete(result)) {
        toast({
          title: "Component removed",
          description: `${values.quantityTonnes} t returned to stockpile`,
        });
        form.reset({
          stockpileId: components[0]?.stockpileId ?? "",
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
        <Button variant="outline" disabled={disabled}>
          Remove Component
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove component</DialogTitle>
          <DialogDescription>
            Return material to stockpile inventory.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="remove-stockpile">Stockpile</Label>
            <select
              id="remove-stockpile"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
              {...form.register("stockpileId")}
            >
              {components.map((component) => (
                <option key={component.stockpileId} value={component.stockpileId}>
                  {component.stockpileCode}
                  {component.remainingTonnes > 0
                    ? ` • In batch: ${component.remainingTonnes.toFixed(2)} t`
                    : ""}
                </option>
              ))}
            </select>
            {formError(form, "stockpileId")}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="remove-qty">Quantity (t)</Label>
            <Input id="remove-qty" type="number" step="0.1" {...form.register("quantityTonnes")} />
            {formError(form, "quantityTonnes")}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="remove-ref">Reference</Label>
            <Input id="remove-ref" {...form.register("reference")} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Removing..." : "Remove component"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function StartBatchDialog({
  disabled,
  batch,
  onComplete,
}: {
  disabled: boolean;
  batch: BatchSummary | null;
  onComplete: (result: Awaited<ReturnType<typeof startBatchAction>>) => boolean;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const onConfirm = () => {
    if (!batch) return;
    startTransition(async () => {
      const result = await startBatchAction({ batchId: batch.id });
      if (onComplete(result)) {
        toast({
          title: "Batch started",
          description: `${batch.code} is now active.`,
        });
        setOpen(false);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={disabled}>
          Start Batch
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Start batch</DialogTitle>
          <DialogDescription>
            Begin processing for batch {batch?.code ?? ""}.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={isPending}>
            {isPending ? "Starting..." : "Start batch"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CompleteBatchDialog({
  disabled,
  batch,
  onComplete,
}: {
  disabled: boolean;
  batch: BatchSummary | null;
  onComplete: (result: Awaited<ReturnType<typeof completeBatchAction>>) => boolean;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const form = useForm<z.infer<typeof completeBatchSchema>>({
    resolver: zodResolver(completeBatchSchema),
    defaultValues: {
      outputTonnes: undefined,
      moisturePct: undefined,
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    if (!batch) return;
    startTransition(async () => {
      const payload = {
        batchId: batch.id,
        outputTonnes: values.outputTonnes ?? undefined,
        moisturePct: values.moisturePct ?? undefined,
      };
      const result = await completeBatchAction(payload);
      if (onComplete(result)) {
        toast({
          title: "Batch completed",
          description: `${batch.code} marked as completed.`,
        });
        form.reset();
        setOpen(false);
      }
    });
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={disabled}>
          Complete Batch
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Complete batch</DialogTitle>
          <DialogDescription>
            Record actual output and moisture for {batch?.code ?? ""}.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="completed-output">Output (t)</Label>
            <Input
              id="completed-output"
              type="number"
              step="0.1"
              {...form.register("outputTonnes")}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="completed-moisture">Moisture %</Label>
            <Input
              id="completed-moisture"
              type="number"
              step="0.1"
              {...form.register("moisturePct")}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Completing..." : "Complete batch"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CancelBatchDialog({
  disabled,
  batch,
  onComplete,
}: {
  disabled: boolean;
  batch: BatchSummary | null;
  onComplete: (result: Awaited<ReturnType<typeof cancelBatchAction>>) => boolean;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const form = useForm<z.infer<typeof cancelBatchSchema>>({
    resolver: zodResolver(cancelBatchSchema),
    defaultValues: {
      reason: "",
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    if (!batch) return;
    startTransition(async () => {
      const result = await cancelBatchAction({
        batchId: batch.id,
        reason: values.reason ?? undefined,
      });
      if (onComplete(result)) {
        toast({
          title: "Batch cancelled",
          description: `${batch.code} marked as cancelled.`,
        });
        form.reset();
        setOpen(false);
      }
    });
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={disabled}>
          Cancel Batch
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel batch</DialogTitle>
          <DialogDescription>
            Cancel batch {batch?.code ?? ""} and release reserved inputs.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="cancel-reason">Reason</Label>
            <Input id="cancel-reason" {...form.register("reason")} />
          </div>
          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => setOpen(false)}>
              Keep batch
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Cancelling..." : "Cancel batch"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function StockpileSelect({
  form,
  stockpiles,
}: {
  form: GenericForm;
  stockpiles: StockpileOption[];
}) {
  const options = useMemo(() => stockpiles, [stockpiles]);
  return (
    <div className="grid gap-2">
      <Label htmlFor="component-stockpile">Stockpile</Label>
      <select
        id="component-stockpile"
        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
        {...form.register("stockpileId")}
      >
        {options.map((stockpile) => (
          <option key={stockpile.id} value={stockpile.id}>
            {stockpile.code}
            {stockpile.name ? ` • ${stockpile.name}` : ""}
            {` (avail ${stockpile.availableTonnes.toFixed(2)} t)`}
          </option>
        ))}
      </select>
      {formError(form, "stockpileId")}
    </div>
  );
}
