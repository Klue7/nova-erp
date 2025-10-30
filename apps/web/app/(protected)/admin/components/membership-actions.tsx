"use client";

import { useEffect, useState, useTransition } from "react";
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
import {
  addMembershipAction,
  assignRoleAction,
  removeMembershipAction,
  revokeRoleAction,
} from "../actions";

type MembershipAction = "add" | "remove" | "assign" | "revoke";

const actionMap: Record<
  MembershipAction,
  typeof addMembershipAction | typeof removeMembershipAction
> = {
  add: addMembershipAction,
  remove: removeMembershipAction,
  assign: assignRoleAction,
  revoke: revokeRoleAction,
};

const titles: Record<MembershipAction, string> = {
  add: "Add membership",
  remove: "Remove membership",
  assign: "Assign role",
  revoke: "Revoke role",
};

const descriptions: Record<MembershipAction, string> = {
  add: "Link a user to this tenant with the specified role.",
  remove:
    "Remove an existing tenant membership. The user may lose access immediately.",
  assign:
    "Grant an additional role to a user within this tenant. Users can hold multiple roles.",
  revoke:
    "Remove a specific role while keeping other tenant memberships intact.",
};

const schema = z.object({
  tenantId: z.string().uuid(),
  userId: z.string().uuid("Enter a valid user ID"),
  role: z.string().min(1, "Select a role"),
});

type FormValues = z.infer<typeof schema>;

export function MembershipActionDialog({
  tenantId,
  action,
}: {
  tenantId: string;
  action: MembershipAction;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { tenantId, userId: "", role: "" },
  });
  useEffect(() => {
    form.register("tenantId");
    form.setValue("tenantId", tenantId);
  }, [form, tenantId]);

  function submit(values: FormValues) {
    startTransition(async () => {
      const handler = actionMap[action];
      const result = await handler({
        tenantId: values.tenantId,
        userId: values.userId,
        role: values.role,
      });
      if (result.ok) {
        toast({
          title: `${titles[action]} succeeded`,
          description: "Changes will appear after refresh.",
        });
        form.reset({ tenantId, userId: "", role: "" });
        setOpen(false);
      } else {
        toast({
          title: `${titles[action]} failed`,
          description: result.error,
          variant: "destructive",
        });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant={action === "remove" || action === "revoke" ? "outline" : "secondary"}>
          {titles[action]}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{titles[action]}</DialogTitle>
          <DialogDescription>{descriptions[action]}</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4 py-4" onSubmit={form.handleSubmit(submit)} noValidate>
          <div className="grid gap-2">
            <Label htmlFor={`${action}-user-id`}>User ID</Label>
            <Input
              id={`${action}-user-id`}
              placeholder="UUID from Supabase Auth"
              {...form.register("userId")}
            />
            {form.formState.errors.userId ? (
              <p className="text-xs text-destructive">
                {form.formState.errors.userId.message}
              </p>
            ) : null}
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${action}-role`}>Role</Label>
            <select
              id={`${action}-role`}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none ring-offset-background transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              value={form.watch("role")}
              onChange={(event) => form.setValue("role", event.target.value)}
            >
              <option value="" disabled>
                Select role
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
              {isPending ? "Saving..." : titles[action]}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
