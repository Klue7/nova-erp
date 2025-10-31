"use client";

import { useMemo, useState, useTransition } from "react";
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
  createVehicleAction,
  endShiftAction,
  logLoadAction,
  startShiftAction,
} from "../actions";

type VehicleOption = {
  id: string;
  code: string;
  type: string | null;
  capacityTonnes: number | null;
  status: string;
};

type StockpileOption = {
  id: string;
  code: string;
  availableTonnes: number;
};

type StartShiftDialogProps = {
  vehicles: VehicleOption[];
};

type LogLoadDialogProps = {
  shiftId: string | null;
  stockpiles: StockpileOption[];
};

type EndShiftButtonProps = {
  shiftId: string | null;
};

const decimalSchema = z
  .string()
  .trim()
  .refine((value) => value === "" || !Number.isNaN(Number(value)), {
    message: "Enter a numeric value",
  });

function formatTonnes(value: number) {
  return value.toLocaleString(undefined, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  });
}

export function CreateVehicleDialog() {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [type, setType] = useState("");
  const [capacity, setCapacity] = useState("");
  const [isPending, startTransition] = useTransition();
  const [errors, setErrors] = useState<{ code?: string; capacity?: string }>({});

  function resetForm() {
    setCode("");
    setType("");
    setCapacity("");
    setErrors({});
  }

  function submit() {
    setErrors({});

    if (!code.trim()) {
      setErrors({ code: "Vehicle code is required." });
      return;
    }

    const parsedCapacity = decimalSchema.safeParse(capacity);
    if (!parsedCapacity.success) {
      setErrors({ capacity: parsedCapacity.error.errors[0]?.message });
      return;
    }

    const numericCapacity = capacity.trim() === "" ? undefined : Number(capacity);

    startTransition(async () => {
      const result = await createVehicleAction({
        code,
        type,
        capacityTonnes: numericCapacity,
      });

      if (result.ok) {
        toast({
          title: "Vehicle saved",
          description: "The vehicle is ready for shifts.",
        });
        resetForm();
        setOpen(false);
      } else {
        toast({
          title: "Unable to save vehicle",
          description: result.error,
          variant: "destructive",
        });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : setOpen(false))}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Register vehicle
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add mining vehicle</DialogTitle>
          <DialogDescription>
            Register a haul truck, loader, or other mining vehicle for shift scheduling.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="vehicle-code">Vehicle code</Label>
            <Input
              id="vehicle-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="ADT-01"
              disabled={isPending}
            />
            {errors.code ? (
              <p className="text-xs text-destructive">{errors.code}</p>
            ) : null}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="vehicle-type">Type (optional)</Label>
            <Input
              id="vehicle-type"
              value={type}
              onChange={(event) => setType(event.target.value)}
              placeholder="Articulated dump truck"
              disabled={isPending}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="vehicle-capacity">Capacity (tonnes, optional)</Label>
            <Input
              id="vehicle-capacity"
              value={capacity}
              onChange={(event) => setCapacity(event.target.value)}
              placeholder="30"
              inputMode="decimal"
              disabled={isPending}
            />
            {errors.capacity ? (
              <p className="text-xs text-destructive">{errors.capacity}</p>
            ) : null}
          </div>
        </div>
        <DialogFooter className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              resetForm();
              setOpen(false);
            }}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={isPending}>
            {isPending ? "Saving..." : "Save vehicle"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function StartShiftDialog({ vehicles }: StartShiftDialogProps) {
  const [open, setOpen] = useState(false);
  const [vehicleId, setVehicleId] = useState("");
  const [isPending, startTransition] = useTransition();

  const options = useMemo(
    () =>
      vehicles
        .filter((vehicle) => vehicle.status === "active")
        .map((vehicle) => ({
          id: vehicle.id,
          label: vehicle.code,
          capacity: vehicle.capacityTonnes ?? undefined,
        })),
    [vehicles],
  );

  function submit() {
    if (!vehicleId) {
      toast({
        title: "Select a vehicle",
        description: "Choose a vehicle to start a shift.",
        variant: "destructive",
      });
      return;
    }

    startTransition(async () => {
      const result = await startShiftAction({ vehicleId });

      if (result.ok) {
        toast({
          title: "Shift started",
          description: "The vehicle is now in an active shift.",
        });
        setVehicleId("");
        setOpen(false);
      } else {
        toast({
          title: "Unable to start shift",
          description: result.error,
          variant: "destructive",
        });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : setOpen(false))}>
      <DialogTrigger asChild>
        <Button size="sm" disabled={options.length === 0}>
          Start shift
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Start haul shift</DialogTitle>
          <DialogDescription>
            Select an available vehicle to begin tracking loads.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="start-shift-vehicle">Vehicle</Label>
            <select
              id="start-shift-vehicle"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none ring-offset-background transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              value={vehicleId}
              onChange={(event) => setVehicleId(event.target.value)}
              disabled={isPending || options.length === 0}
            >
              <option value="" disabled>
                {options.length === 0
                  ? "No available vehicles"
                  : "Select a vehicle"}
              </option>
              {options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                  {option.capacity ? ` (${option.capacity} t)` : ""}
                </option>
              ))}
            </select>
          </div>
        </div>
        <DialogFooter className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={isPending || !vehicleId}>
            {isPending ? "Starting..." : "Start shift"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function LogLoadDialog({ shiftId, stockpiles }: LogLoadDialogProps) {
  const [open, setOpen] = useState(false);
  const [materialType, setMaterialType] = useState("");
  const [quantity, setQuantity] = useState("");
  const [stockpileId, setStockpileId] = useState("");
  const [isPending, startTransition] = useTransition();

  const options = useMemo(
    () =>
      stockpiles.map((item) => ({
        id: item.id,
        label: item.code,
        available: item.availableTonnes,
      })),
    [stockpiles],
  );

  function resetForm() {
    setMaterialType("");
    setQuantity("");
    setStockpileId("");
  }

  function submit() {
    if (!shiftId) {
      toast({
        title: "No active shift",
        description: "Start a shift before logging loads.",
        variant: "destructive",
      });
      return;
    }
    if (!materialType.trim()) {
      toast({
        title: "Material type required",
        description: "Enter the material hauled.",
        variant: "destructive",
      });
      return;
    }
    const parsedQuantity = Number(quantity);
    if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
      toast({
        title: "Invalid quantity",
        description: "Enter a positive tonnage.",
        variant: "destructive",
      });
      return;
    }
    if (!stockpileId) {
      toast({
        title: "Select a stockpile",
        description: "Choose the destination stockpile.",
        variant: "destructive",
      });
      return;
    }

    startTransition(async () => {
      const result = await logLoadAction({
        shiftId,
        materialType,
        quantityTonnes: parsedQuantity,
        stockpileId,
      });

      if (result.ok) {
        toast({
          title: "Load recorded",
          description: "The stockpile balance has been updated.",
        });
        resetForm();
        setOpen(false);
      } else {
        toast({
          title: "Unable to log load",
          description: result.error,
          variant: "destructive",
        });
      }
    });
  }

  const disabled = !shiftId || options.length === 0;

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : setOpen(false))}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary" disabled={disabled}>
          Log load
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Log haul load</DialogTitle>
          <DialogDescription>
            Capture material picked at the pit and dumped to a stockpile.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="load-material">Material</Label>
            <Input
              id="load-material"
              value={materialType}
              onChange={(event) => setMaterialType(event.target.value)}
              placeholder="Clay A"
              disabled={isPending || disabled}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="load-quantity">Quantity (tonnes)</Label>
            <Input
              id="load-quantity"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              placeholder="30"
              inputMode="decimal"
              disabled={isPending || disabled}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="load-stockpile">Destination stockpile</Label>
            <select
              id="load-stockpile"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none ring-offset-background transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              value={stockpileId}
              onChange={(event) => setStockpileId(event.target.value)}
              disabled={isPending || disabled}
            >
              <option value="" disabled>
                {options.length === 0
                  ? "No stockpiles available"
                  : "Select stockpile"}
              </option>
              {options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label} ({formatTonnes(option.available)} t available)
                </option>
              ))}
            </select>
          </div>
        </div>
        <DialogFooter className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              resetForm();
              setOpen(false);
            }}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={isPending || disabled}>
            {isPending ? "Logging..." : "Log load"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function EndShiftButton({ shiftId }: EndShiftButtonProps) {
  const [isPending, startTransition] = useTransition();

  if (!shiftId) {
    return (
      <Button size="sm" variant="ghost" disabled>
        No active shift
      </Button>
    );
  }

  function submit() {
    startTransition(async () => {
      const result = await endShiftAction({ shiftId });

      if (result.ok) {
        toast({
          title: "Shift closed",
          description: "The haul shift has been ended.",
        });
      } else {
        toast({
          title: "Unable to end shift",
          description: result.error,
          variant: "destructive",
        });
      }
    });
  }

  return (
    <Button
      size="sm"
      variant="destructive"
      onClick={submit}
      disabled={isPending}
    >
      {isPending ? "Ending..." : "End shift"}
    </Button>
  );
}

