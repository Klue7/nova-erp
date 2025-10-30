import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import OnboardingForm from "./onboarding-form";
import type { OnboardingActionState } from "./types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ROLE_OPTIONS, getDefaultRouteForRole, guardRoute } from "@/lib/rbac";
import { createServerSupabaseClient } from "@/utils/supabase/server";

async function completeOnboarding(
  _prevState: OnboardingActionState,
  formData: FormData,
): Promise<OnboardingActionState> {
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
    redirect(
      getDefaultRouteForRole(profile.role, {
        isPlatformAdmin: profile.is_platform_admin,
      }),
    );
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
