"use client";

import { useEffect, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";

import { recordLoadAction } from "../actions";

type StockpileOption = {
  id: string;
  code: string;
  name?: string | null;
};

const loadFormSchema = z.object({
  shiftId: z.string().uuid(),
  stockpileId: z.string().uuid("Select a stockpile."),
  tonnage: z.coerce
    .number({ invalid_type_error: "Enter a tonnage." })
    .positive("Tonnage must be greater than zero."),
  moisturePct: z
    .preprocess((value) => {
      if (value === "" || value === null || value === undefined) {
        return undefined;
      }
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : value;
    }, z.union([
      z
        .number({ invalid_type_error: "Moisture must be a number." })
        .min(0, "Moisture must be between 0 and 100%.")
        .max(100, "Moisture must be between 0 and 100%."),
      z.undefined(),
    ]))
    .optional(),
  notes: z
    .string()
    .trim()
    .max(500, "Notes should be shorter than 500 characters.")
    .optional(),
});

type LoadFormValues = z.infer<typeof loadFormSchema>;

export function LoadRecorder({
  activeShiftId,
  stockpiles,
}: {
  activeShiftId: string | null;
  stockpiles: StockpileOption[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const stockpileOptions = useMemo(
    () => stockpiles.map((stockpile) => ({ value: stockpile.id, label: stockpile.code })),
    [stockpiles],
  );

  const stockpileLabelMap = useMemo(() => {
    const map = new Map<string, string>();
    stockpiles.forEach((stockpile) => {
      map.set(stockpile.id, stockpile.code);
    });
    return map;
  }, [stockpiles]);

  const form = useForm<LoadFormValues>({
    resolver: zodResolver(loadFormSchema),
    defaultValues: {
      shiftId: activeShiftId ?? "",
      stockpileId: stockpileOptions[0]?.value ?? "",
      tonnage: 0,
      moisturePct: undefined,
      notes: "",
    },
  });

  useEffect(() => {
    if (activeShiftId) {
      form.setValue("shiftId", activeShiftId);
    }
  }, [activeShiftId, form]);

  if (!activeShiftId) {
    return (
      <div className="space-y-2">
        <p className="text-sm font-medium text-foreground">
          Start a shift to log loads
        </p>
        <p className="text-sm text-muted-foreground">
          Assign a vehicle first; load capture will unlock once you have an active shift.
        </p>
      </div>
    );
  }

  if (stockpiles.length === 0) {
    return (
      <div className="space-y-2">
        <p className="text-sm font-medium text-foreground">
          No stockpiles found
        </p>
        <p className="text-sm text-muted-foreground">
          Create stockpiles before recording loads. Visit the stockpile module to add one.
        </p>
      </div>
    );
  }

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      try {
        const result = await recordLoadAction({
          shiftId: values.shiftId,
          stockpileId: values.stockpileId,
          tonnage: values.tonnage,
          moisturePct:
            typeof values.moisturePct === "number" ? values.moisturePct : undefined,
          notes: values.notes?.length ? values.notes : undefined,
        });
        if (!result.ok) {
          throw new Error(result.error);
        }
        toast({
          title: "Load logged",
          description: `Recorded ${values.tonnage.toLocaleString(undefined, {
            maximumFractionDigits: 2,
            minimumFractionDigits: 0,
          })} tonnes to stockpile ${
            stockpileLabelMap.get(values.stockpileId) ?? values.stockpileId
          }.`,
        });
        form.reset({
          shiftId: activeShiftId,
          stockpileId: values.stockpileId,
          tonnage: 0,
          moisturePct: undefined,
          notes: "",
        });
        router.refresh();
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unable to record load.";
        toast({
          title: "Log failed",
          description: message,
          variant: "destructive",
        });
      }
    });
  });

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <input type="hidden" value={activeShiftId} {...form.register("shiftId")} />
      <div className="grid gap-2">
        <Label htmlFor="log-stockpile">Stockpile</Label>
        <select
          id="log-stockpile"
          className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          disabled={isPending}
          {...form.register("stockpileId")}
        >
          {stockpileOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {form.formState.errors.stockpileId ? (
          <p className="text-xs text-destructive">
            {form.formState.errors.stockpileId.message}
          </p>
        ) : null}
      </div>
      <div className="grid gap-2">
        <Label htmlFor="log-tonnage">Tonnage</Label>
        <Input
          id="log-tonnage"
          type="number"
          step="0.1"
          min="0"
          placeholder="e.g. 32.5"
          disabled={isPending}
          {...form.register("tonnage")}
        />
        {form.formState.errors.tonnage ? (
          <p className="text-xs text-destructive">
            {form.formState.errors.tonnage.message}
          </p>
        ) : null}
      </div>
      <div className="grid gap-2">
        <Label htmlFor="log-moisture">Moisture % (optional)</Label>
        <Input
          id="log-moisture"
          type="number"
          step="0.1"
          min="0"
          max="100"
          placeholder="e.g. 8.4"
          disabled={isPending}
          {...form.register("moisturePct")}
        />
        {form.formState.errors.moisturePct ? (
          <p className="text-xs text-destructive">
            {form.formState.errors.moisturePct.message}
          </p>
        ) : null}
      </div>
      <div className="grid gap-2">
        <Label htmlFor="log-notes">Notes (optional)</Label>
        <Textarea
          id="log-notes"
          placeholder="e.g. Load from pit 3, moderate moisture."
          disabled={isPending}
          {...form.register("notes")}
        />
        {form.formState.errors.notes ? (
          <p className="text-xs text-destructive">
            {form.formState.errors.notes.message}
          </p>
        ) : null}
      </div>
      <Button type="submit" disabled={isPending}>
        {isPending ? "Logging…" : "Log load"}
      </Button>
    </form>
  );
}
