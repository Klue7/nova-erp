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
import { ROLE_OPTIONS } from "@/lib/roles";
import { inviteUserAction } from "../actions";

const inviteSchema = z.object({
  email: z.string().email("Enter a valid email address."),
  role: z.string().min(1, "Select a role."),
});

type FormValues = z.infer<typeof inviteSchema>;

export function InviteUserDialog({ tenantId }: { tenantId: string }) {
  const [open, setOpen] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const form = useForm<FormValues>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { email: "", role: "" },
  });

  function submit(values: FormValues) {
    startTransition(async () => {
      const result = await inviteUserAction({
        tenantId,
        email: values.email,
        role: values.role,
      });
      if (result.ok) {
        const link = result.data?.link ?? null;
        setInviteLink(link);
        toast({
          title: "Invite sent",
          description: "Share the invite link with the recipient.",
        });
        form.reset();
      } else {
        toast({
          title: "Unable to invite",
          description: result.error,
          variant: "destructive",
        });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">Invite user</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite a user</DialogTitle>
          <DialogDescription>
            Generate an invitation for a teammate to join this tenant. They will
            authenticate with Supabase Auth to accept the invite.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4 py-4"
          onSubmit={form.handleSubmit(submit)}
          noValidate
        >
          <div className="grid gap-2">
            <Label htmlFor="invite-email">Email address</Label>
            <Input
              id="invite-email"
              placeholder="operator@example.com"
              {...form.register("email")}
            />
            {form.formState.errors.email ? (
              <p className="text-xs text-destructive">
                {form.formState.errors.email.message}
              </p>
            ) : null}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="invite-role">Role</Label>
            <select
              id="invite-role"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none ring-offset-background transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              value={form.watch("role")}
              onChange={(event) => form.setValue("role", event.target.value)}
            >
              <option value="" disabled>
                Select a role
              </option>
              {ROLE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {form.formState.errors.role ? (
              <p className="text-xs text-destructive">
                {form.formState.errors.role.message}
              </p>
            ) : null}
          </div>
          {inviteLink ? (
            <div className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">Invite link</p>
              <p className="break-all">{inviteLink}</p>
            </div>
          ) : null}
          <DialogFooter className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setInviteLink(null);
                setOpen(false);
              }}
              disabled={isPending}
            >
              Close
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Inviting..." : "Send invite"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
