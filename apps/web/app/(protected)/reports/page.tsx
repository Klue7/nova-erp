import { redirect } from "next/navigation";

import ReportsDashboard from "./components/reports-dashboard";
import {
  getDailyThroughput,
  getExecToday,
  getOrderDispatchLeadTimes,
  getQualityToday,
  getWipSummary,
} from "@/lib/reports.server";
import { getReportingWindow } from "@/lib/reports";
import { getDefaultRouteForRole, guardRoute } from "@/lib/rbac";

export default async function ReportsPage() {
  const { profile } = await guardRoute({
    requiredRole: ["admin", "finance", "viewer", "platform_admin"],
  });

  if (!profile) {
    redirect(getDefaultRouteForRole(null));
  }

  if (
    !profile.is_platform_admin &&
    !["admin", "finance", "viewer"].includes(profile.role)
  ) {
    redirect("/dashboard?toast=access-denied");
  }

  const window = getReportingWindow();

  // Fetch a generous lookback window to support client-side filtering.
  const rangeStart = window.minAvailable;
  const rangeEnd = window.defaultTo;

  const [execToday, throughput, wip, quality, leadTimes] = await Promise.all([
    getExecToday(),
    getDailyThroughput({ from: rangeStart, to: rangeEnd }),
    getWipSummary(),
    getQualityToday(),
    getOrderDispatchLeadTimes({ from: rangeStart, to: rangeEnd }),
  ]);

  return (
    <ReportsDashboard
      defaultFrom={window.defaultFrom}
      defaultTo={window.defaultTo}
      minDate={rangeStart}
      maxDate={rangeEnd}
      execToday={execToday}
      throughput={throughput}
      wip={wip}
      quality={quality}
      leadTimes={leadTimes}
    />
  );
}
