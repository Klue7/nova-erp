"use client";

import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { revokeInviteAction } from "../actions";

type InviteRow = {
  id: string;
  email: string;
  role: string;
  status: string;
  expires_at: string | null;
  created_at: string | null;
};

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function InvitesTable({ invites }: { invites: InviteRow[] }) {
  const [isPending, startTransition] = useTransition();

  function cancelInvite(id: string) {
    startTransition(async () => {
      const result = await revokeInviteAction({ id });
      if (result.ok) {
        toast({
          title: "Invite cancelled",
          description: "The invite cannot be used anymore.",
        });
      } else {
        toast({
          title: "Unable to cancel invite",
          description: result.error,
          variant: "destructive",
        });
      }
    });
  }

  if (invites.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No invites yet. Generate one to onboard new team members.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border/60">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Expires</TableHead>
            <TableHead>Created</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {invites.map((invite) => (
            <TableRow key={invite.id}>
              <TableCell className="font-medium">{invite.email}</TableCell>
              <TableCell>{invite.role}</TableCell>
              <TableCell className="capitalize">{invite.status}</TableCell>
              <TableCell>{formatDate(invite.expires_at)}</TableCell>
              <TableCell>{formatDate(invite.created_at)}</TableCell>
              <TableCell className="text-right">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={isPending || invite.status !== "pending"}
                  onClick={() => cancelInvite(invite.id)}
                >
                  Cancel
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
