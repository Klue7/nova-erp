"use client";

import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { acceptInviteAction } from "../actions";

const schema = z.object({
  token: z.string().min(10, "Enter a valid token string."),
});

type FormValues = z.infer<typeof schema>;

export function AcceptInviteCard() {
  const [isPending, startTransition] = useTransition();
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { token: "" },
  });

  function submit(values: FormValues) {
    startTransition(async () => {
      const result = await acceptInviteAction(values);
      if (result.ok) {
        toast({
          title: "Invite accepted",
          description: "Your active tenant has been switched.",
        });
        form.reset();
      } else {
        toast({
          title: "Unable to accept invite",
          description: result.error,
          variant: "destructive",
        });
      }
    });
  }

  return (
    <Card className="border-border/70">
      <CardHeader>
        <CardTitle className="text-base">Accept invite (developer helper)</CardTitle>
        <CardDescription>
          Paste an invite token to accept it as the current signed-in user.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-3" onSubmit={form.handleSubmit(submit)} noValidate>
          <div className="grid gap-2">
            <Label htmlFor="invite-token">Token</Label>
            <Input
              id="invite-token"
              placeholder="uuid-token-string"
              {...form.register("token")}
            />
            {form.formState.errors.token ? (
              <p className="text-xs text-destructive">
                {form.formState.errors.token.message}
              </p>
            ) : null}
          </div>
          <Button type="submit" size="sm" disabled={isPending}>
            {isPending ? "Accepting..." : "Accept invite"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
