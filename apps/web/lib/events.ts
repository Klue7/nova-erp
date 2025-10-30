import type { SupabaseClient } from "@supabase/supabase-js";

import { getUserProfile } from "@/lib/rbac";

type LogEventInput = {
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  correlationId?: string | null;
  causationId?: string | null;
  tenantId?: string;
  actorRole?: string;
  occurredAt?: string | Date | null;
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
    tenantId,
    actorRole,
    occurredAt,
  }: LogEventInput,
) {
  try {
    const { session, profile } = await getUserProfile();

    if (!session || !profile) {
      console.warn("logEvent: no active session/profile to attribute event.");
      return;
    }

    const resolvedTenantId = tenantId ?? profile.tenant_id;
    const resolvedRole = actorRole ?? profile.role;

    if (!resolvedTenantId) {
      console.warn("logEvent: tenant id missing, skipping insert.");
      return;
    }

    const row: Record<string, unknown> = {
      tenant_id: resolvedTenantId,
      actor_id: session.user.id,
      actor_role: resolvedRole,
      aggregate_type: aggregateType,
      aggregate_id: aggregateId,
      event_type: eventType,
      payload,
      source: "web",
      correlation_id: correlationId ?? null,
      causation_id: causationId ?? null,
    };

    if (occurredAt) {
      row.occurred_at =
        occurredAt instanceof Date ? occurredAt.toISOString() : occurredAt;
    }

    const { error } = await supabase.from("events").insert(row);

    if (error) {
      console.error("logEvent insert failed", error);
    }
  } catch (error) {
    console.error("logEvent unexpected failure", error);
  }
}
