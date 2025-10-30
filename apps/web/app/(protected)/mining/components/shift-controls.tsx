'use client';

import { useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";

import { endShiftAction, startShiftAction } from "../actions";

type VehicleOption = {
  id: string;
  code: string;
  description?: string | null;
};

type ActiveShift = {
  shiftId: string;
  vehicleCode: string;
  startedAt: string;
  totalTonnage: number;
  loadCount: number;
  avgMoisturePct: number | null;
  lastLoadAt: string | null;
};

const startShiftFormSchema = z.object({
  vehicleId: z.string().uuid("Select a vehicle."),
});

type StartShiftForm = z.infer<typeof startShiftFormSchema>;

export function ShiftControls({
  vehicles,
  activeShift,
}: {
  vehicles: VehicleOption[];
  activeShift: ActiveShift | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isEnding, startEndingTransition] = useTransition();

  const vehicleOptions = useMemo(
    () => vehicles.map((vehicle) => ({ value: vehicle.id, label: vehicle.code })),
    [vehicles],
  );

  const form = useForm<StartShiftForm>({
    resolver: zodResolver(startShiftFormSchema),
    defaultValues: {
      vehicleId: vehicleOptions[0]?.value ?? "",
    },
  });

  const handleStartShift = form.handleSubmit((values) => {
    startTransition(async () => {
      try {
        await startShiftAction(values);
        toast({
          title: "Shift started",
          description: `Vehicle ${vehicles.find((v) => v.id === values.vehicleId)?.code ?? values.vehicleId} assigned to you.`,
        });
        form.reset();
        router.refresh();
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unable to start shift.";
        toast({
          title: "Start failed",
          description: message,
          variant: "destructive",
        });
      }
    });
  });

  async function handleEndShift() {
    if (!activeShift) return;
    startEndingTransition(async () => {
      try {
        await endShiftAction({ shiftId: activeShift.shiftId });
        toast({
          title: "Shift completed",
          description: `Vehicle ${activeShift.vehicleCode} released.`,
        });
        router.refresh();
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unable to complete shift.";
        toast({
          title: "End failed",
          description: message,
          variant: "destructive",
        });
      }
    });
  }

  if (activeShift) {
    return (
      <div className="space-y-4">
        <div>
          <p className="text-sm font-medium text-foreground">
            Active shift — vehicle {activeShift.vehicleCode}
          </p>
          <p className="text-sm text-muted-foreground">
            Started {new Date(activeShift.startedAt).toLocaleString()}
          </p>
        </div>
        <div className="grid gap-2 rounded-md border border-border/60 bg-muted/20 p-3 text-sm">
          <DetailRow label="Loads logged" value={activeShift.loadCount.toString()} />
          <DetailRow
            label="Tonnage"
            value={`${formatNumber(activeShift.totalTonnage)} t`}
          />
          <DetailRow
            label="Avg moisture"
            value={
              activeShift.avgMoisturePct !== null &&
              activeShift.avgMoisturePct !== undefined
                ? `${formatNumber(activeShift.avgMoisturePct, 2)} %`
                : "—"
            }
          />
          <DetailRow
            label="Last load"
            value={
              activeShift.lastLoadAt
                ? new Date(activeShift.lastLoadAt).toLocaleTimeString()
                : "—"
            }
          />
        </div>
        <Button
          type="button"
          variant="destructive"
          onClick={handleEndShift}
          disabled={isEnding}
        >
          {isEnding ? "Ending shift…" : "End shift"}
        </Button>
      </div>
    );
  }

  if (vehicles.length === 0) {
    return (
      <div className="space-y-2">
        <p className="text-sm font-medium text-foreground">
          No vehicles available
        </p>
        <p className="text-sm text-muted-foreground">
          Create mining vehicles in the admin panel or seed demo data to begin
          assigning shifts.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleStartShift} className="space-y-4">
      <div className="grid gap-2">
        <Label htmlFor="vehicle-select">Vehicle</Label>
        <select
          id="vehicle-select"
          className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          disabled={isPending}
          {...form.register("vehicleId")}
        >
          {vehicleOptions.map((vehicle) => (
            <option key={vehicle.value} value={vehicle.value}>
              {vehicle.label}
            </option>
          ))}
        </select>
        {form.formState.errors.vehicleId ? (
          <p className="text-xs text-destructive">
            {form.formState.errors.vehicleId.message}
          </p>
        ) : null}
      </div>
      <Button type="submit" disabled={isPending}>
        {isPending ? "Starting shift…" : "Start shift"}
      </Button>
    </form>
  );
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-sm font-medium text-foreground">{value}</span>
    </div>
  );
}

function formatNumber(value: number, digits = 1) {
  return Number(value).toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}
