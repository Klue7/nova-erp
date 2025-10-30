"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { type UseFormReturn, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

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
  adjustAction,
  createStockpileAction,
  recordQualityAction,
  recordReceiptAction,
  takeSampleAction,
  transferOutAction,
} from "../actions";

type StockpileOption = {
  id: string;
  code: string;
  name?: string | null;
};

type DialogProps = {
  stockpiles: StockpileOption[];
};

type GenericForm = UseFormReturn<any>;

const createStockpileSchema = z.object({
  code: z.string().min(1, "Code is required."),
  name: z.string().trim().optional(),
  location: z.string().trim().optional(),
  materialType: z.string().trim().optional(),
});

const receiptSchema = z.object({
  stockpileId: z.string().uuid("Select a stockpile."),
  quantityTonnes: z.number().positive("Quantity must be greater than zero."),
  reference: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

const transferSchema = receiptSchema.extend({
  toStockpileId: z
    .union([z.string().uuid(), z.literal(""), z.null(), z.undefined()])
    .transform((value) => (value ? value : undefined)),
});

const adjustSchema = z.object({
  stockpileId: z.string().uuid("Select a stockpile."),
  quantityTonnes: z.number().positive("Quantity must be greater than zero."),
  direction: z.enum(["increase", "decrease"]),
  reason: z.string().min(2, "Provide a reason."),
});

const qualitySchema = z.object({
  stockpileId: z.string().uuid("Select a stockpile."),
  moisturePct: z
    .number({ invalid_type_error: "Enter a moisture percentage." })
    .min(0, "Moisture must be at least 0%.")
    .max(100, "Moisture cannot exceed 100%."),
});

const sampleSchema = z.object({
  stockpileId: z.string().uuid("Select a stockpile."),
});

export function StockpileActions({ stockpiles }: DialogProps) {
  return (
    <div className="flex flex-wrap gap-3">
      <CreateStockpileDialog />
      <RecordReceiptDialog stockpiles={stockpiles} />
      <TransferOutDialog stockpiles={stockpiles} />
      <AdjustDialog stockpiles={stockpiles} />
      <TakeSampleDialog stockpiles={stockpiles} />
      <RecordQualityDialog stockpiles={stockpiles} />
    </div>
  );
}

function CreateStockpileDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const form = useForm<z.infer<typeof createStockpileSchema>>({
    resolver: zodResolver(createStockpileSchema),
    defaultValues: {
      code: "",
      name: "",
      location: "",
      materialType: "",
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      try {
        await createStockpileAction(values);
        toast({
          title: "Stockpile saved",
          description: `Stockpile ${values.code} is ready to use.`,
        });
        form.reset();
        setOpen(false);
        router.refresh();
      } catch (error) {
        toast({
          title: "Unable to save stockpile",
          description:
            error instanceof Error ? error.message : "Please try again.",
          variant: "destructive",
        });
      }
    });
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Create Stockpile</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create stockpile</DialogTitle>
          <DialogDescription>
            Define a stockpile code and optional metadata for tracking.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="stockpile-code">Code</Label>
            <Input
              id="stockpile-code"
              placeholder="SP-001"
              {...form.register("code")}
            />
            {form.formState.errors.code ? (
              <p className="text-xs text-destructive">
                {form.formState.errors.code.message}
              </p>
            ) : null}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="stockpile-name">Name</Label>
            <Input
              id="stockpile-name"
              placeholder="Primary clay stockpile"
              {...form.register("name")}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="stockpile-location">Location</Label>
            <Input
              id="stockpile-location"
              placeholder="North yard"
              {...form.register("location")}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="stockpile-material">Material type</Label>
            <Input
              id="stockpile-material"
              placeholder="Clay"
              {...form.register("materialType")}
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving..." : "Save stockpile"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RecordReceiptDialog({ stockpiles }: DialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const disabled = stockpiles.length === 0;

  const form = useForm<z.infer<typeof receiptSchema>>({
    resolver: zodResolver(receiptSchema),
    defaultValues: {
      stockpileId: stockpiles[0]?.id ?? "",
      quantityTonnes: 0,
      reference: "",
      notes: "",
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      try {
        await recordReceiptAction({
          ...values,
          quantityTonnes: Number(values.quantityTonnes),
        });
        toast({
          title: "Receipt recorded",
          description: `Added ${values.quantityTonnes} t to stockpile.`,
        });
        form.reset({
          stockpileId: stockpiles[0]?.id ?? "",
          quantityTonnes: 0,
          reference: "",
          notes: "",
        });
        setOpen(false);
        router.refresh();
      } catch (error) {
        toast({
          title: "Unable to record receipt",
          description:
            error instanceof Error ? error.message : "Please try again.",
          variant: "destructive",
        });
      }
    });
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={disabled}>
          Record Receipt
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record stockpile receipt</DialogTitle>
          <DialogDescription>
            Capture inbound tonnage delivered to a stockpile.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <StockpileSelect form={form} stockpiles={stockpiles} />
          <NumberField
            label="Quantity (tonnes)"
            fieldName="quantityTonnes"
            placeholder="150"
            form={form}
          />
          <TextField
            label="Reference"
            fieldName="reference"
            placeholder="GRN-10045"
            form={form}
          />
          <TextField
            label="Notes"
            fieldName="notes"
            placeholder="Delivered by fleet A"
            form={form}
          />
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Recording..." : "Record receipt"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TransferOutDialog({ stockpiles }: DialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const disabled = stockpiles.length === 0;

  const form = useForm<z.infer<typeof transferSchema>>({
    resolver: zodResolver(transferSchema),
    defaultValues: {
      stockpileId: stockpiles[0]?.id ?? "",
      quantityTonnes: 0,
      toStockpileId: undefined,
      reference: "",
      notes: "",
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      try {
        await transferOutAction({
          ...values,
          quantityTonnes: Number(values.quantityTonnes),
        });
        toast({
          title: "Transfer recorded",
          description: `Moved ${values.quantityTonnes} t from source stockpile.`,
        });
        form.reset({
          stockpileId: stockpiles[0]?.id ?? "",
          quantityTonnes: 0,
          toStockpileId: undefined,
          reference: "",
          notes: "",
        });
        setOpen(false);
        router.refresh();
      } catch (error) {
        toast({
          title: "Unable to transfer",
          description:
            error instanceof Error ? error.message : "Please try again.",
          variant: "destructive",
        });
      }
    });
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={disabled}>
          Transfer Out
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Transfer material out</DialogTitle>
          <DialogDescription>
            Log outbound tonnage from one stockpile and optionally track the
            receiving stockpile.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <StockpileSelect form={form} stockpiles={stockpiles} />
          <NumberField
            label="Quantity (tonnes)"
            fieldName="quantityTonnes"
            placeholder="100"
            form={form}
          />
          <div className="grid gap-2">
            <Label htmlFor="to-stockpile">To stockpile (optional)</Label>
            <select
              id="to-stockpile"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
              {...form.register("toStockpileId")}
            >
              <option value="">None</option>
              {stockpiles
                .filter((sp) => sp.id !== form.watch("stockpileId"))
                .map((stockpile) => (
                  <option key={stockpile.id} value={stockpile.id}>
                    {stockpile.code}
                    {stockpile.name ? ` – ${stockpile.name}` : ""}
                  </option>
                ))}
            </select>
          </div>
          <TextField
            label="Reference"
            fieldName="reference"
            placeholder="Work order / ticket"
            form={form}
          />
          <TextField
            label="Notes"
            fieldName="notes"
            placeholder="Shift note"
            form={form}
          />
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Transferring..." : "Transfer out"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AdjustDialog({ stockpiles }: DialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const disabled = stockpiles.length === 0;

  const form = useForm<z.infer<typeof adjustSchema>>({
    resolver: zodResolver(adjustSchema),
    defaultValues: {
      stockpileId: stockpiles[0]?.id ?? "",
      quantityTonnes: 0,
      direction: "increase",
      reason: "",
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      try {
        await adjustAction({
          ...values,
          quantityTonnes: Number(values.quantityTonnes),
        });
        toast({
          title: "Adjustment posted",
          description: `Adjustment ${values.direction === "increase" ? "+" : "-"}${values.quantityTonnes} t recorded.`,
        });
        form.reset({
          stockpileId: stockpiles[0]?.id ?? "",
          quantityTonnes: 0,
          direction: "increase",
          reason: "",
        });
        setOpen(false);
        router.refresh();
      } catch (error) {
        toast({
          title: "Unable to adjust stockpile",
          description:
            error instanceof Error ? error.message : "Please try again.",
          variant: "destructive",
        });
      }
    });
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={disabled}>
          Adjust
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adjust stockpile balance</DialogTitle>
          <DialogDescription>
            Apply a manual true-up for shrinkage, sampling or corrections.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <StockpileSelect form={form} stockpiles={stockpiles} />
          <NumberField
            label="Quantity (tonnes)"
            fieldName="quantityTonnes"
            placeholder="5"
            form={form}
          />
          <div className="grid gap-2">
            <Label htmlFor="direction">Direction</Label>
            <select
              id="direction"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
              {...form.register("direction")}
            >
              <option value="increase">Increase</option>
              <option value="decrease">Decrease</option>
            </select>
          </div>
          <TextField
            label="Reason"
            fieldName="reason"
            placeholder="Moisture loss"
            form={form}
          />
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Posting..." : "Apply adjustment"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TakeSampleDialog({ stockpiles }: DialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const disabled = stockpiles.length === 0;

  const form = useForm<z.infer<typeof sampleSchema>>({
    resolver: zodResolver(sampleSchema),
    defaultValues: {
      stockpileId: stockpiles[0]?.id ?? "",
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      try {
        await takeSampleAction(values);
        toast({
          title: "Sample recorded",
          description: "Sampling activity logged for the stockpile.",
        });
        form.reset({
          stockpileId: stockpiles[0]?.id ?? "",
        });
        setOpen(false);
        router.refresh();
      } catch (error) {
        toast({
          title: "Unable to log sample",
          description:
            error instanceof Error ? error.message : "Please try again.",
          variant: "destructive",
        });
      }
    });
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={disabled}>
          Take Sample
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Log sampling activity</DialogTitle>
          <DialogDescription>
            Record that a sample was taken for lab analysis.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <StockpileSelect form={form} stockpiles={stockpiles} />
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Recording..." : "Log sample"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RecordQualityDialog({ stockpiles }: DialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const disabled = stockpiles.length === 0;

  const form = useForm<z.infer<typeof qualitySchema>>({
    resolver: zodResolver(qualitySchema),
    defaultValues: {
      stockpileId: stockpiles[0]?.id ?? "",
      moisturePct: 0,
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      try {
        await recordQualityAction({
          ...values,
          moisturePct: Number(values.moisturePct),
        });
        toast({
          title: "Quality recorded",
          description: `Latest moisture sample ${values.moisturePct}% saved.`,
        });
        form.reset({
          stockpileId: stockpiles[0]?.id ?? "",
          moisturePct: 0,
        });
        setOpen(false);
        router.refresh();
      } catch (error) {
        toast({
          title: "Unable to record quality",
          description:
            error instanceof Error ? error.message : "Please try again.",
          variant: "destructive",
        });
      }
    });
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={disabled}>
          Record Quality
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record moisture</DialogTitle>
          <DialogDescription>
            Capture the latest moisture percentage for a stockpile.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <StockpileSelect form={form} stockpiles={stockpiles} />
          <div className="grid gap-2">
            <Label htmlFor="moisturePct">Moisture %</Label>
            <Input
              id="moisturePct"
              type="number"
              step="0.1"
              min={0}
              max={100}
              {...form.register("moisturePct", { valueAsNumber: true })}
            />
            {form.formState.errors.moisturePct ? (
              <p className="text-xs text-destructive">
                {form.formState.errors.moisturePct.message}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving..." : "Record moisture"}
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
  return (
    <div className="grid gap-2">
      <Label htmlFor="stockpileId">Stockpile</Label>
      <select
        id="stockpileId"
        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
        {...form.register("stockpileId")}
      >
        {stockpiles.map((stockpile) => (
          <option key={stockpile.id} value={stockpile.id}>
            {stockpile.code}
            {stockpile.name ? ` – ${stockpile.name}` : ""}
          </option>
        ))}
      </select>
      {form.formState.errors.stockpileId ? (
        <p className="text-xs text-destructive">
          {String(form.formState.errors.stockpileId.message ?? "")}
        </p>
      ) : null}
    </div>
  );
}

function NumberField({
  label,
  fieldName,
  placeholder,
  form,
}: {
  label: string;
  fieldName: "quantityTonnes";
  placeholder: string;
  form: GenericForm;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={fieldName}>{label}</Label>
      <Input
        id={fieldName}
        type="number"
        step="0.1"
        min={0}
        placeholder={placeholder}
        {...form.register(fieldName, { valueAsNumber: true })}
      />
      {form.formState.errors[fieldName] ? (
        <p className="text-xs text-destructive">
          {form.formState.errors[fieldName]?.message as string}
        </p>
      ) : null}
    </div>
  );
}

function TextField({
  label,
  fieldName,
  placeholder,
  form,
}: {
  label: string;
  fieldName: string;
  placeholder: string;
  form: GenericForm;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={fieldName}>{label}</Label>
      <Input
        id={fieldName}
        placeholder={placeholder}
        {...form.register(fieldName)}
      />
    </div>
  );
}
