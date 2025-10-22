import { redirect } from "next/navigation";

import {
  getDefaultRouteForRole,
  guardRoute,
} from "@/lib/rbac";

export default async function DashboardPage() {
  const { profile } = await guardRoute();

  const destination = getDefaultRouteForRole(profile?.role);

  if (destination !== "/dashboard") {
    redirect(destination);
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-foreground">
        Admin dashboard coming soon
      </h1>
      <p className="text-muted-foreground">
        You&apos;re signed in as an administrator. Role-targeted dashboards for
        administrators, finance, and viewers will be introduced in a later
        milestone.
      </p>
    </div>
  );
}
