"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { updateTenantSettingsAction } from "../actions";

type Settings = Record<string, unknown>;

export function TenantSettingsCard({
  tenantId,
  initialSettings,
}: {
  tenantId: string;
  initialSettings: Settings | null;
}) {
  const [value, setValue] = useState(
    JSON.stringify(initialSettings ?? {}, null, 2),
  );
  const [isPending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      try {
        const parsed =
          value.trim().length === 0 ? {} : (JSON.parse(value) as Settings);
        const result = await updateTenantSettingsAction({
          tenantId,
          settings: parsed,
        });
        if (result.ok) {
          toast({
            title: "Settings updated",
            description: "Tenant preferences saved successfully.",
          });
        } else {
          toast({
            title: "Unable to update settings",
            description: result.error,
            variant: "destructive",
          });
        }
      } catch (error) {
        toast({
          title: "Invalid JSON",
          description:
            error instanceof Error ? error.message : "Unable to parse JSON payload.",
          variant: "destructive",
        });
      }
    });
  }

  return (
    <Card className="border-border/70">
      <CardHeader>
        <CardTitle className="text-base">Tenant settings</CardTitle>
        <CardDescription>
          Store tenant-level preferences or feature flags. Values are saved as JSON.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-2">
          <Label htmlFor="tenant-settings">Settings JSON</Label>
          <Textarea
            id="tenant-settings"
            rows={8}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            spellCheck={false}
          />
        </div>
        <Button onClick={save} disabled={isPending}>
          {isPending ? "Saving..." : "Save settings"}
        </Button>
      </CardContent>
    </Card>
  );
}
