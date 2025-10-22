import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { logEvent } from "@/lib/events";
import { guardRoute } from "@/lib/rbac";
import { createServerSupabaseClient } from "@/utils/supabase/server";

type MiningEvent = {
  id: string;
  occurred_at: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  actor_role: string;
  payload: Record<string, unknown>;
};

const KPI_PLACEHOLDERS = [
  { label: "Tonnage mined (today)", value: "1,240 t", delta: "+4.1%" },
  { label: "Tonnage mined (week)", value: "7,820 t", delta: "+12.6%" },
  { label: "Downtime", value: "6.4 %", delta: "-1.1 pts" },
  { label: "Feed rate", value: "58 tph", delta: "+3.4 tph" },
  { label: "Moisture", value: "8.9 %", delta: "±0.3%" },
  { label: "Active equipment", value: "11 / 12", delta: "1 in service" },
];

const LOG_TEST_EVENT_ACTION = async () => {
  "use server";

  const supabase = await createServerSupabaseClient();

  await logEvent(supabase, {
    aggregateType: "mining.excavator",
    aggregateId: `excavator-${Math.floor(Math.random() * 12) + 1}`,
    eventType: "mining.test.logged",
    payload: {
      tonnage: (Math.random() * 20 + 30).toFixed(1),
      moisture: (Math.random() * 3 + 6).toFixed(2),
      downtime_minutes: Math.floor(Math.random() * 30),
    },
    correlationId: randomUUID(),
  });

  revalidatePath("/mining");
};

export default async function MiningPage() {
  const { profile } = await guardRoute({
    requiredRole: "mining_operator",
  });

  if (!profile) {
    return null;
  }

  const supabase = await createServerSupabaseClient();

  let events: MiningEvent[] = [];
  let eventsError: string | null = null;

  const { data, error } = await supabase
    .from("events")
    .select(
      "id, occurred_at, aggregate_type, aggregate_id, event_type, actor_role, payload",
    )
    .eq("tenant_id", profile.tenant_id)
    .order("occurred_at", { ascending: false })
    .limit(20);

  if (error) {
    if ((error as { code?: string }).code === "42P01") {
      events = [];
    } else {
      console.error("mining.events", error);
      eventsError = "Unable to load recent events.";
    }
  } else {
    events = (data ?? []) as MiningEvent[];
  }

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold text-foreground">
          Mining dashboard
        </h1>
        <p className="text-sm text-muted-foreground">
          Monitor production KPIs, downtime, and contextual events for mining
          operations.
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {KPI_PLACEHOLDERS.map((kpi) => (
          <Card key={kpi.label} className="border-border/70">
            <CardHeader className="space-y-1">
              <CardDescription>{kpi.label}</CardDescription>
              <CardTitle className="text-2xl text-foreground">
                {kpi.value}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{kpi.delta}</p>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-foreground">
              Recent events
            </h2>
            <p className="text-sm text-muted-foreground">
              Live stream of event-sourced mining activity for your tenant.
            </p>
          </div>
          <form action={LOG_TEST_EVENT_ACTION}>
            <Button type="submit">Log test event</Button>
          </form>
        </div>

        <Card className="border-border/70">
          <CardContent className="p-0">
            {eventsError ? (
              <div className="p-6 text-sm text-destructive">{eventsError}</div>
            ) : events.length === 0 ? (
              <div className="flex flex-col gap-2 p-6 text-sm text-muted-foreground">
                <p>No events yet.</p>
                <p>
                  Trigger a test event or connect the production ingestion
                  pipeline to start populating the log.
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-40">Occurred</TableHead>
                    <TableHead>Aggregate</TableHead>
                    <TableHead>Event</TableHead>
                    <TableHead>Actor Role</TableHead>
                    <TableHead>Payload</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {events.map((event) => (
                    <TableRow key={event.id}>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {new Date(event.occurred_at).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="text-sm font-medium text-foreground">
                            {event.aggregate_type}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {event.aggregate_id}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm text-foreground">
                          {event.event_type}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {event.actor_role}
                      </TableCell>
                      <TableCell>
                        <pre className="max-h-32 overflow-auto rounded bg-muted px-2 py-1 text-xs">
                          {JSON.stringify(event.payload, null, 2)}
                        </pre>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableCaption>
                  Displaying the 20 most recent events for tenant{" "}
                  <span className="font-mono text-xs text-muted-foreground">
                    {profile.tenant_id}
                  </span>
                  .
                </TableCaption>
              </Table>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
