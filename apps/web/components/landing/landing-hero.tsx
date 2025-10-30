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
      className="relative w-full overflow-hidden border-b border-border/60 bg-gradient-to-b from-secondary/95 via-secondary/90 to-background"
    >
      <div
        aria-hidden
        className="landing-gradient pointer-events-none absolute inset-0 opacity-70"
      />
      <div className="relative z-10 mx-auto flex max-w-6xl flex-col items-center gap-10 px-6 pb-24 pt-28 text-center sm:pt-32">
        <div className="flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1 text-xs font-medium tracking-wide text-primary-foreground shadow-sm backdrop-blur">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Sparkles className="h-3 w-3" aria-hidden />
          </span>
          Event-driven ERP for high-throughput brick manufacturing
        </div>
        <div className="space-y-6 text-balance">
          <h1 className="text-4xl font-semibold leading-tight tracking-tight text-card-foreground sm:text-5xl lg:text-6xl">
            Orchestrate mining to sales in one secure workspace
          </h1>
          <p className="mx-auto max-w-2xl text-base text-muted-foreground sm:text-lg">
            Nova Bricks ERP gives every operator a role-based cockpit with
            real-time KPIs, actionable insights, and event-sourced traceability
            across mining, production, and dispatch.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button
            size="lg"
            className="group px-6 shadow-lg shadow-primary/30"
            asChild
          >
            <Link href="/login">
              Sign in
              <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden />
            </Link>
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="px-6 border-foreground/20 bg-background/80 backdrop-blur hover:border-primary/60 hover:bg-primary/10"
            asChild
          >
            <Link href="#modules">Explore modules</Link>
          </Button>
        </div>
        <dl className="grid w-full grid-cols-1 gap-4 text-left sm:grid-cols-3">
          {HERO_STATS.map((stat) => (
            <div
              key={stat.label}
              className="rounded-xl border border-border/70 bg-gradient-to-br from-background/90 via-background to-primary/10 p-5 shadow-lg shadow-secondary/10 backdrop-blur"
            >
              <dt className="text-sm uppercase tracking-wide text-muted-foreground">
                {stat.label}
              </dt>
              <dd className="mt-2 text-2xl font-semibold text-foreground drop-shadow">
                {stat.value}
              </dd>
            </div>
          ))}
        </dl>
        <div className="relative mt-4 flex w-full flex-col items-center gap-6">
          <div className="relative w-full max-w-4xl overflow-hidden rounded-3xl border border-primary/30 bg-background/80 shadow-2xl shadow-secondary/40 ring-1 ring-primary/30">
            <Image
              src={HERO_DASHBOARD_IMAGE}
              alt="Role dashboard preview"
              width={1280}
              height={720}
              priority
              className="h-auto w-full"
            />
          </div>
          <div className="relative w-full max-w-2xl overflow-hidden rounded-3xl border border-secondary/40 bg-background/90 shadow-xl ring-1 ring-secondary/30">
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
