"use client";

import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/hooks/use-toast";
import { switchActiveTenantAction } from "../actions";

type Membership = {
  tenantId: string;
  code: string | null;
  name: string | null;
  role: string;
  created_at: string | null;
};

export function TenantSwitcher({
  memberships,
  activeTenantId,
}: {
  memberships: Membership[];
  activeTenantId: string;
}) {
  const [isPending, startTransition] = useTransition();

  function handleSwitch(tenantId: string) {
    startTransition(async () => {
      const result = await switchActiveTenantAction({ tenantId });
      if (result.ok) {
        toast({
          title: "Tenant switched",
          description: "Reloading dashboards for the selected tenant.",
        });
      } else {
        toast({
          title: "Unable to switch tenant",
          description: result.error,
          variant: "destructive",
        });
      }
    });
  }

  return (
    <Card className="border-border/70">
      <CardHeader>
        <CardTitle className="text-base">My tenants</CardTitle>
        <CardDescription>
          Switch the active tenant context for dashboards and event logging.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {memberships.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            You are not a member of any other tenants yet.
          </p>
        ) : (
          memberships.map((membership, index) => (
            <div key={membership.tenantId}>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="font-medium text-foreground">
                    {membership.name ?? membership.code ?? membership.tenantId}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Role: {membership.role} · Since{" "}
                    {membership.created_at
                      ? new Intl.DateTimeFormat(undefined, {
                          dateStyle: "medium",
                        }).format(new Date(membership.created_at))
                      : "unknown"}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant={
                    membership.tenantId === activeTenantId ? "secondary" : "outline"
                  }
                  disabled={
                    isPending || membership.tenantId === activeTenantId
                  }
                  onClick={() => handleSwitch(membership.tenantId)}
                >
                  {membership.tenantId === activeTenantId
                    ? "Active"
                    : isPending
                      ? "Switching..."
                      : "Switch"}
                </Button>
              </div>
              {index < memberships.length - 1 ? (
                <Separator className="my-3" />
              ) : null}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
