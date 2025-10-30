import type { ComponentType } from "react";
import Link from "next/link";
import {
  BarChart3,
  FileText,
  PackagePlus,
  ShoppingCart,
  Truck,
  Users,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type QuickAction = {
  title: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
};

const ACTIONS: QuickAction[] = [
  {
    title: "Create Invoice",
    description: "Raise billing documents tied to dispatched loads.",
    icon: FileText,
  },
  {
    title: "Add Customer",
    description: "Capture new buyer details with tenant-aware defaults.",
    icon: Users,
  },
  {
    title: "Add Product",
    description: "Register SKUs across bricks, tiles, and aggregates.",
    icon: PackagePlus,
  },
  {
    title: "Sales Order",
    description: "Launch guided order flows with credit checks.",
    icon: ShoppingCart,
  },
  {
    title: "Purchase Order",
    description: "Issue supplier POs with approval routing.",
    icon: Truck,
  },
  {
    title: "View Reports",
    description: "Unlock dashboards for production and finance teams.",
    icon: BarChart3,
  },
];

export function QuickActions() {
  return (
    <section
      id="quick-actions"
      className="w-full border-y border-border/60 bg-gradient-to-b from-background via-background to-muted/40 py-16"
    >
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6">
        <div className="flex flex-col items-start gap-4 text-left">
          <p className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium uppercase tracking-wide text-primary">
            <span className="h-2 w-2 rounded-full bg-primary" />
            Quick Actions
          </p>
          <h2 className="text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
            Move faster with curated workflows
          </h2>
          <p className="max-w-3xl text-base text-muted-foreground">
            Operators jump straight into repeatable, role-tuned processes. All
            actions respect tenant boundaries, audit trails, and feature flags.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
          {ACTIONS.map((action) => (
            <Card
              key={action.title}
              className="group flex flex-col justify-between border border-border/70 bg-card/95 shadow-sm shadow-secondary/20 transition hover:-translate-y-1 hover:border-primary/60 hover:shadow-xl hover:shadow-primary/20"
            >
              <CardHeader>
                <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-primary/30 bg-primary/10 text-primary shadow-inner shadow-primary/20 transition group-hover:border-primary/50 group-hover:bg-primary/20">
                  <action.icon className="h-5 w-5" aria-hidden />
                </div>
                <CardTitle className="mt-4 text-xl text-foreground">
                  {action.title}
                </CardTitle>
                <CardDescription>{action.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <Button asChild className="w-full bg-secondary text-secondary-foreground hover:bg-secondary/90">
                  <Link href="/login">Open workflow</Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
