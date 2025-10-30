import { redirect } from "next/navigation";

import { LoginForm } from "@/components/login-form";
import { getUserProfile } from "@/lib/rbac";

export default async function LoginPage() {
  const { session } = await getUserProfile();

  if (session) {
    redirect("/dashboard");
  }

  return (
    <div className="relative flex min-h-[70vh] w-full items-center justify-center overflow-hidden px-6 py-24">
      <div
        aria-hidden
        className="landing-gradient pointer-events-none absolute inset-0 opacity-70"
      />
      <div className="relative z-10 w-full max-w-md rounded-2xl border border-border/70 bg-background/95 p-8 shadow-xl shadow-secondary/30 backdrop-blur">
        <div className="mb-6 space-y-2 text-center">
          <p className="text-xs uppercase tracking-[0.3em] text-primary">
            Nova Bricks ERP
          </p>
          <h1 className="text-3xl font-semibold text-foreground">
            Welcome back
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
