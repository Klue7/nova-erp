import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { useFormState, useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ROLE_OPTIONS, getDefaultRouteForRole, guardRoute } from "@/lib/rbac";
import { createServerSupabaseClient } from "@/utils/supabase/server";

type ActionState = {
  error?: string | null;
};

async function completeOnboarding(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  "use server";

  const fullName = (formData.get("full_name") as string | null)?.trim() ?? null;
  const roleValue = formData.get("role") as string | null;

  if (!roleValue) {
    return { error: "Select a role to continue." };
  }

  const role = ROLE_OPTIONS.find((option) => option.value === roleValue)?.value;

  if (!role) {
    return { error: "Select a valid role to continue." };
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    redirect("/login");
  }

  const metadataTenant = session.user.user_metadata?.tenant_id;
  const tenantId =
    typeof metadataTenant === "string" && metadataTenant.length > 0
      ? metadataTenant
      : session.user.id;

  const { error } = await supabase
    .from("profiles")
    .upsert(
      {
        id: session.user.id,
        role,
        tenant_id: tenantId,
        full_name: fullName,
      },
      { onConflict: "id" },
    );

  if (error) {
    console.error("onboarding.upsert", error);
    return { error: "Unable to save profile. Please try again." };
  }

  revalidatePath("/dashboard");
  revalidatePath("/mining");

  redirect(getDefaultRouteForRole(role));
}

export default async function OnboardingPage() {
  const { session, profile } = await guardRoute({ requireProfile: false });

  if (!session) {
    redirect("/login");
  }

  if (profile) {
    redirect(getDefaultRouteForRole(profile.role));
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/10 px-6 py-16">
      <div className="w-full max-w-xl">
        <Card className="border-border/70">
          <CardHeader className="space-y-3">
            <CardTitle className="text-2xl text-foreground">
              Complete your profile
            </CardTitle>
            <CardDescription className="text-sm text-muted-foreground">
              We&apos;ll use your profile to unlock the right dashboards and
              enforce tenant-aware access controls.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <OnboardingForm action={completeOnboarding} />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function OnboardingForm({
  action,
}: {
  action: typeof completeOnboarding;
}) {
  "use client";

  const initialState: ActionState = { error: null };
  const [state, formAction] = useFormState(action, initialState);

  function SubmitButton() {
    const { pending } = useFormStatus();
    return (
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Saving..." : "Save and continue"}
      </Button>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <div className="grid gap-2">
        <Label htmlFor="full_name">
          Full name{" "}
          <span className="text-xs text-muted-foreground">(optional)</span>
        </Label>
        <Input
          id="full_name"
          name="full_name"
          placeholder="Jane Operator"
          autoComplete="name"
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="role">Role</Label>
        <select
          id="role"
          name="role"
          required
          defaultValue=""
          className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none ring-offset-background transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
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
      </div>
      {state.error ? (
        <p className="text-sm text-destructive">{state.error}</p>
      ) : null}
      <SubmitButton />
      <p className="text-xs text-muted-foreground">
        Roles define which dashboards, quick actions, and modules become
        available after sign-in. Administrators can update assignments later
        from Supabase.
      </p>
    </form>
  );
}
