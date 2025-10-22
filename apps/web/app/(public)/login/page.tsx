import { redirect } from "next/navigation";

import { LoginForm } from "@/components/login-form";
import { getUserProfile } from "@/lib/rbac";

export default async function LoginPage() {
  const { session } = await getUserProfile();

  if (session) {
    redirect("/dashboard");
  }

  return (
    <div className="flex min-h-[70vh] w-full items-center justify-center px-6 py-16">
      <div className="w-full max-w-md rounded-2xl border border-border/70 bg-background p-8 shadow-lg">
        <div className="mb-6 space-y-2 text-center">
          <h1 className="text-2xl font-semibold text-foreground">
            Sign in to Nova Bricks ERP
          </h1>
          <p className="text-sm text-muted-foreground">
            Access role-based dashboards and production workflows.
          </p>
        </div>
        <LoginForm />
      </div>
    </div>
  );
}
