"use client";

import { useState, useTransition } from "react";
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
import { createTenantAction } from "../actions";

const createTenantSchema = z.object({
  code: z.string().min(2, "Tenant code must be at least 2 characters."),
  name: z.string().min(2, "Tenant name must be at least 2 characters."),
});

type FormValues = z.infer<typeof createTenantSchema>;

export function CreateTenantDialog() {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const form = useForm<FormValues>({
    resolver: zodResolver(createTenantSchema),
    defaultValues: { code: "", name: "" },
  });

  function submit(values: FormValues) {
    startTransition(async () => {
      const result = await createTenantAction(values);
      if (result.ok) {
        toast({
          title: "Tenant created",
          description: `${values.name} is now available.`,
        });
        form.reset();
        setOpen(false);
      } else {
        toast({
          title: "Unable to create tenant",
          description: result.error,
          variant: "destructive",
        });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">Create tenant</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create new tenant</DialogTitle>
          <DialogDescription>
            Provision a new tenant container. You will automatically receive
            administrator access.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4 py-4"
          onSubmit={form.handleSubmit(submit)}
          noValidate
        >
          <div className="grid gap-2">
            <Label htmlFor="tenant-code">Tenant code</Label>
            <Input
              id="tenant-code"
              autoFocus
              placeholder="acme-bricks"
              {...form.register("code")}
            />
            {form.formState.errors.code ? (
              <p className="text-xs text-destructive">
                {form.formState.errors.code.message}
              </p>
            ) : null}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="tenant-name">Tenant name</Label>
            <Input
              id="tenant-name"
              placeholder="Acme Bricks"
              {...form.register("name")}
            />
            {form.formState.errors.name ? (
              <p className="text-xs text-destructive">
                {form.formState.errors.name.message}
              </p>
            ) : null}
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
            <Button type="submit" disabled={isPending}>
              {isPending ? "Creating..." : "Create tenant"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
