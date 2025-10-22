import Link from "next/link";
import { ChevronRight, ShieldCheck, Workflow } from "lucide-react";

import { LandingHero } from "@/components/landing/landing-hero";
import { QuickActions } from "@/components/landing/quick-actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MODULE_LINKS } from "@/lib/navigation";

const PRODUCTION_FLOW = MODULE_LINKS.filter(
  (link) => link.href !== "/dashboard",
);

const PLATFORM_PILLARS = [
  {
    title: "Event-driven core",
    description:
      "Append-only events with Supabase Postgres provide complete traceability for compliance and investigations.",
    icon: Workflow,
  },
  {
    title: "Tenant-first security",
    description:
      "Row-Level Security guarantees each tenant sees only their data, while RBAC sculpts every route and action.",
    icon: ShieldCheck,
  },
  {
    title: "Composable UI kit",
    description:
      "shadcn/ui primitives paired with Tailwind deliver consistent layouts, theming, and accessibility out-of-the-box.",
    icon: ChevronRight,
  },
];

export default function LandingPage() {
  return (
    <>
      <LandingHero />
      <section
        id="modules"
        className="w-full border-b border-border/60 bg-background py-16"
      >
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6">
          <div className="space-y-4 text-left">
            <p className="text-sm font-medium uppercase tracking-wide text-primary">
              Production Flow
            </p>
            <h2 className="text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
              Every stage, one data fabric
            </h2>
            <p className="max-w-3xl text-base text-muted-foreground">
              Operators hand-offs stay in sync—from blasting schedules to
              dispatch paperwork. Each module emits events that hydrate read
              models for dashboards, alerts, and reporting.
            </p>
          </div>
          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            {PRODUCTION_FLOW.map((module) => (
              <Card key={module.href} className="border-border/70">
                <CardHeader className="flex flex-row items-start justify-between space-y-0">
                  <div className="flex items-center gap-3">
                    <module.icon
                      className="h-10 w-10 rounded-lg bg-primary/10 p-2 text-primary"
                      aria-hidden
                    />
                    <div>
                      <CardTitle className="text-xl text-foreground">
                        {module.label}
                      </CardTitle>
                      <p className="text-sm text-muted-foreground">
                        {module.description}
                      </p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <Link
                    href="/login"
                    className="inline-flex items-center text-sm font-medium text-primary hover:text-primary/80"
                  >
                    Preview workflows
                    <ChevronRight className="ml-1 h-4 w-4" aria-hidden />
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>
      <QuickActions />
      <section
        id="platform"
        className="w-full bg-background py-16 md:py-20"
      >
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6">
          <div className="space-y-4 text-left">
            <p className="text-sm font-medium uppercase tracking-wide text-primary">
              Platform
            </p>
            <h2 className="text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
              Built for cloud-first operators
            </h2>
            <p className="max-w-3xl text-base text-muted-foreground">
              Nova Bricks ERP layers secure Supabase Auth, event-sourced
              persistence, and responsive UI primitives to keep teams aligned.
            </p>
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            {PLATFORM_PILLARS.map((pillar) => (
              <Card
                key={pillar.title}
                className="border-border/70 bg-muted/30"
              >
                <CardHeader>
                  <pillar.icon
                    className="h-10 w-10 text-primary"
                    aria-hidden
                  />
                  <CardTitle className="text-xl text-foreground">
                    {pillar.title}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    {pillar.description}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
