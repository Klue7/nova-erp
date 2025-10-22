import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";

const HERO_STATS = [
  { label: "Sites orchestrated", value: "28+" },
  { label: "Events processed daily", value: "1.2M" },
  { label: "Downtime reduction", value: "18%" },
];

const HERO_DASHBOARD_IMAGE = "/images/landing/dashboard-preview.png";
const HERO_PIPELINE_IMAGE = "/images/landing/pipeline-overview.png";

export function LandingHero() {
  return (
    <section
      id="hero"
      className="relative w-full overflow-hidden border-b border-border/60"
    >
      <div
        aria-hidden
        className="landing-gradient pointer-events-none absolute inset-0"
      />
      <div className="relative z-10 mx-auto flex max-w-6xl flex-col items-center gap-10 px-6 pb-24 pt-28 text-center sm:pt-32">
        <div className="flex items-center gap-2 rounded-full border border-border/70 bg-background/80 px-4 py-1 text-xs font-medium tracking-wide text-muted-foreground shadow-sm backdrop-blur">
          <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden />
          Event-driven ERP for high-throughput brick manufacturing
        </div>
        <div className="space-y-6 text-balance">
          <h1 className="text-4xl font-semibold leading-tight tracking-tight text-foreground sm:text-5xl lg:text-6xl">
            Orchestrate Mining to Sales in one secure workspace
          </h1>
          <p className="mx-auto max-w-2xl text-base text-muted-foreground sm:text-lg">
            Nova Bricks ERP gives every operator a role-based cockpit with
            real-time KPIs, actionable insights, and event-sourced traceability
            across mining, production, and dispatch.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button size="lg" className="px-6" asChild>
            <Link href="/login">
              Sign in
              <ArrowRight className="ml-2 h-4 w-4" aria-hidden />
            </Link>
          </Button>
          <Button size="lg" variant="outline" className="px-6" asChild>
            <Link href="#modules">Explore modules</Link>
          </Button>
        </div>
        <dl className="grid w-full grid-cols-1 gap-4 text-left sm:grid-cols-3">
          {HERO_STATS.map((stat) => (
            <div
              key={stat.label}
              className="rounded-lg border border-border/60 bg-background/80 p-5 backdrop-blur"
            >
              <dt className="text-sm text-muted-foreground">{stat.label}</dt>
              <dd className="mt-2 text-2xl font-semibold text-foreground">
                {stat.value}
              </dd>
            </div>
          ))}
        </dl>
        <div className="relative mt-4 flex w-full flex-col items-center gap-6">
          <div className="relative w-full max-w-4xl overflow-hidden rounded-3xl border border-border/80 bg-background/80 shadow-xl ring-1 ring-primary/10">
            <Image
              src={HERO_DASHBOARD_IMAGE}
              alt="Role dashboard preview"
              width={1280}
              height={720}
              priority
              className="h-auto w-full"
            />
          </div>
          <div className="relative w-full max-w-2xl overflow-hidden rounded-3xl border border-border/70 bg-background/80 shadow-lg ring-1 ring-primary/10">
            <Image
              src={HERO_PIPELINE_IMAGE}
              alt="Production pipeline overview"
              width={960}
              height={540}
              className="h-auto w-full"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
