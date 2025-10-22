import type { SupabaseClient } from "@supabase/supabase-js";

import { getUserProfile } from "@/lib/rbac";

type LogEventInput = {
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  correlationId?: string | null;
  causationId?: string | null;
};

export async function logEvent(
  supabase: SupabaseClient,
  {
    aggregateType,
    aggregateId,
    eventType,
    payload,
    correlationId,
    causationId,
  }: LogEventInput,
) {
  try {
    const { session, profile } = await getUserProfile();

    if (!session || !profile) {
      console.warn("logEvent: no active session/profile to attribute event.");
      return;
    }

    const { error } = await supabase.from("events").insert({
      tenant_id: profile.tenant_id,
      actor_id: session.user.id,
      actor_role: profile.role,
      aggregate_type: aggregateType,
      aggregate_id: aggregateId,
      event_type: eventType,
      payload,
      source: "web",
      correlation_id: correlationId ?? null,
      causation_id: causationId ?? null,
    });

    if (error) {
      console.error("logEvent insert failed", error);
    }
  } catch (error) {
    console.error("logEvent unexpected failure", error);
  }
}
