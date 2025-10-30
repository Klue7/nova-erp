import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { logEvent } from "@/lib/events";
import {
  type Role,
  ROLE_ROUTE_MAP,
  type UserProfile,
  getUserProfile,
} from "@/lib/rbac";
import { createServerSupabaseClient } from "@/utils/supabase/server";

const UNIQUE_VIOLATION = "23505";
const VIEW_MISSING = "42P01";

const VALID_ROLES = new Set(Object.keys(ROLE_ROUTE_MAP) as Role[]);

function assertRole(role: string): asserts role is Role {
  if (!VALID_ROLES.has(role as Role)) {
    throw new Error("Invalid role specified.");
  }
}

function normalizeEmail(email: string) {
  const trimmed = email.trim().toLowerCase();
  if (!trimmed) {
    throw new Error("Email address is required.");
  }
  return trimmed;
}

async function requireProfile() {
  const { session, profile } = await getUserProfile();
  if (!session) {
    throw new Error("You must be signed in to perform this action.");
  }
  if (!profile) {
    throw new Error(
      "Complete your onboarding profile before performing admin actions.",
    );
  }
  return { session, profile };
}

function assertPlatformAdmin(profile: UserProfile) {
  if (!profile.is_platform_admin) {
    throw new Error("Platform admin access required.");
  }
}

async function ensureTenantAdmin(
  supabase: SupabaseClient,
  tenantId: string,
  profile: UserProfile,
) {
  if (profile.is_platform_admin) {
    return;
  }
  const { data, error } = await supabase
    .from("memberships")
    .select("role")
    .eq("tenant_id", tenantId)
    .eq("user_id", profile.id)
    .eq("role", "admin")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    throw new Error("Administrator access required for this tenant.");
  }
}

export async function createTenant({
  code,
  name,
}: {
  code: string;
  name: string;
}) {
  const normalizedCode = code.trim();
  const normalizedName = name.trim();

  if (!normalizedCode) {
    throw new Error("Tenant code is required.");
  }
  if (!normalizedName) {
    throw new Error("Tenant name is required.");
  }

  const { profile } = await requireProfile();
  assertPlatformAdmin(profile);

  const supabase = await createServerSupabaseClient();
  const { data: tenant, error } = await supabase
    .from("tenants")
    .insert({
      code: normalizedCode,
      name: normalizedName,
    })
    .select("id, code, name, status, created_at")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!tenant) {
    throw new Error("Failed to create tenant.");
  }

  // Ensure the creator has admin membership and active tenant context.
  const upsertMembership = await supabase
    .from("memberships")
    .upsert(
      {
        tenant_id: tenant.id,
        user_id: profile.id,
        role: "admin",
      },
      { onConflict: "tenant_id,user_id,role" },
    );
  if (upsertMembership.error) {
    throw new Error(upsertMembership.error.message);
  }

  const profileUpdates: Record<string, unknown> = {};
  if (profile.tenant_id !== tenant.id) {
    profileUpdates.tenant_id = tenant.id;
  }
  if (profile.role !== "admin") {
    profileUpdates.role = "admin";
  }

  if (Object.keys(profileUpdates).length > 0) {
    const { error: profileError } = await supabase
      .from("profiles")
      .update(profileUpdates)
      .eq("id", profile.id);
    if (profileError) {
      throw new Error(profileError.message);
    }
  }

  // Seed settings row for future updates.
  const { error: settingsError } = await supabase
    .from("tenant_settings")
    .upsert({ tenant_id: tenant.id }, { onConflict: "tenant_id" });

  if (settingsError && settingsError.code !== UNIQUE_VIOLATION) {
    throw new Error(settingsError.message);
  }

  await logEvent(supabase, {
    aggregateType: "admin",
    aggregateId: tenant.id,
    eventType: "TENANT_CREATED",
    payload: {
      tenantId: tenant.id,
      tenantCode: tenant.code,
      name: tenant.name,
    },
    tenantId: tenant.id,
    actorRole: "admin",
  });

  return tenant;
}

export async function inviteUser({
  tenantId,
  email,
  role,
}: {
  tenantId: string;
  email: string;
  role: Role;
}) {
  assertRole(role);
  const normalizedEmail = normalizeEmail(email);
  const { profile } = await requireProfile();

  const supabase = await createServerSupabaseClient();
  await ensureTenantAdmin(supabase, tenantId, profile);

  const token = randomUUID();
  const { data: invite, error } = await supabase
    .from("invites")
    .insert({
      tenant_id: tenantId,
      email: normalizedEmail,
      role,
      token,
    })
    .select(
      "id, tenant_id, email, role, status, expires_at, created_at, token",
    )
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!invite) {
    throw new Error("Failed to create invite.");
  }

  await logEvent(supabase, {
    aggregateType: "admin",
    aggregateId: tenantId,
    eventType: "USER_INVITED",
    payload: {
      tenantId,
      inviteId: invite.id,
      email: invite.email,
      role: invite.role,
    },
    tenantId,
    actorRole: profile.role,
  });

  return {
    invite,
    link: `/admin/accept-invite?token=${invite.token}`,
  };
}

export async function acceptInvite({ token }: { token: string }) {
  if (!token || token.trim().length === 0) {
    throw new Error("Invite token is required.");
  }

  const { session, profile } = await requireProfile();
  const supabase = await createServerSupabaseClient();

  const { data: invite, error } = await supabase
    .from("invites")
    .select("id, tenant_id, email, role, status, expires_at")
    .eq("token", token.trim())
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!invite) {
    throw new Error("Invite not found or already consumed.");
  }
  if (invite.status !== "pending") {
    throw new Error("Invite is no longer active.");
  }
  if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
    throw new Error("Invite has expired.");
  }

  const userEmail = session.user.email?.toLowerCase();
  if (userEmail && userEmail !== invite.email.toLowerCase()) {
    throw new Error("Invite email does not match the signed-in user.");
  }

  const membership = await supabase.from("memberships").upsert(
    {
      tenant_id: invite.tenant_id,
      user_id: session.user.id,
      role: invite.role,
    },
    { onConflict: "tenant_id,user_id,role" },
  );

  if (membership.error && membership.error.code !== UNIQUE_VIOLATION) {
    throw new Error(membership.error.message);
  }

  const profileUpdates: Record<string, unknown> = {};
  if (!profile || profile.tenant_id !== invite.tenant_id) {
    profileUpdates.tenant_id = invite.tenant_id;
  }
  if (!profile || profile.role !== invite.role) {
    profileUpdates.role = invite.role;
  }

  if (!profile) {
    const { error: insertProfileError } = await supabase.from("profiles").insert(
      {
        id: session.user.id,
        role: invite.role,
        tenant_id: invite.tenant_id,
        full_name: session.user.user_metadata?.full_name ?? null,
      },
    );
    if (insertProfileError && insertProfileError.code !== UNIQUE_VIOLATION) {
      throw new Error(insertProfileError.message);
    }
  } else if (Object.keys(profileUpdates).length > 0) {
    const { error: updateProfileError } = await supabase
      .from("profiles")
      .update(profileUpdates)
      .eq("id", profile.id);
    if (updateProfileError) {
      throw new Error(updateProfileError.message);
    }
  }

  const { error: updateInviteError } = await supabase
    .from("invites")
    .update({ status: "accepted" })
    .eq("id", invite.id);
  if (updateInviteError) {
    throw new Error(updateInviteError.message);
  }

  await logEvent(supabase, {
    aggregateType: "admin",
    aggregateId: invite.tenant_id,
    eventType: "MEMBERSHIP_ADDED",
    payload: {
      tenantId: invite.tenant_id,
      userId: session.user.id,
      role: invite.role,
      inviteId: invite.id,
    },
    tenantId: invite.tenant_id,
    actorRole: invite.role,
  });

  return { tenantId: invite.tenant_id, role: invite.role };
}

async function mutateMembership(
  supabase: SupabaseClient,
  {
    tenantId,
    userId,
    role,
    eventType,
    action,
    actorRole,
  }: {
    tenantId: string;
    userId: string;
    role: Role;
    eventType:
      | "MEMBERSHIP_ADDED"
      | "MEMBERSHIP_REMOVED"
      | "USER_ROLE_ASSIGNED"
      | "USER_ROLE_REVOKED";
    action: "insert" | "delete";
    actorRole: string;
  },
) {
  assertRole(role);

  if (action === "insert") {
    const { error } = await supabase.from("memberships").upsert(
      {
        tenant_id: tenantId,
        user_id: userId,
        role,
      },
      { onConflict: "tenant_id,user_id,role" },
    );
    if (error && error.code !== UNIQUE_VIOLATION) {
      throw new Error(error.message);
    }
  } else {
    const { error } = await supabase
      .from("memberships")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("user_id", userId)
      .eq("role", role);
    if (error) {
      throw new Error(error.message);
    }
  }

  await logEvent(supabase, {
    aggregateType: "admin",
    aggregateId: tenantId,
    eventType,
    payload: {
      tenantId,
      userId,
      role,
    },
    tenantId,
    actorRole,
  });
}

export async function addMembership({
  tenantId,
  userId,
  role,
}: {
  tenantId: string;
  userId: string;
  role: Role;
}) {
  const { profile } = await requireProfile();
  const supabase = await createServerSupabaseClient();
  await ensureTenantAdmin(supabase, tenantId, profile);
  await mutateMembership(supabase, {
    tenantId,
    userId,
    role,
    eventType: "MEMBERSHIP_ADDED",
    action: "insert",
    actorRole: profile.role,
  });
  return { tenantId, userId, role };
}

export async function removeMembership({
  tenantId,
  userId,
  role,
}: {
  tenantId: string;
  userId: string;
  role: Role;
}) {
  const { profile } = await requireProfile();
  const supabase = await createServerSupabaseClient();
  await ensureTenantAdmin(supabase, tenantId, profile);
  await mutateMembership(supabase, {
    tenantId,
    userId,
    role,
    eventType: "MEMBERSHIP_REMOVED",
    action: "delete",
    actorRole: profile.role,
  });
  return { tenantId, userId, role };
}

export async function assignRole({
  tenantId,
  userId,
  role,
}: {
  tenantId: string;
  userId: string;
  role: Role;
}) {
  const { profile } = await requireProfile();
  const supabase = await createServerSupabaseClient();
  await ensureTenantAdmin(supabase, tenantId, profile);
  await mutateMembership(supabase, {
    tenantId,
    userId,
    role,
    eventType: "USER_ROLE_ASSIGNED",
    action: "insert",
    actorRole: profile.role,
  });
  return { tenantId, userId, role };
}

export async function revokeRole({
  tenantId,
  userId,
  role,
}: {
  tenantId: string;
  userId: string;
  role: Role;
}) {
  const { profile } = await requireProfile();
  const supabase = await createServerSupabaseClient();
  await ensureTenantAdmin(supabase, tenantId, profile);
  await mutateMembership(supabase, {
    tenantId,
    userId,
    role,
    eventType: "USER_ROLE_REVOKED",
    action: "delete",
    actorRole: profile.role,
  });
  return { tenantId, userId, role };
}

function selectRoleFromMemberships(
  memberships: Array<{ role: string | null }>,
  fallback: Role,
): Role {
  const roles = memberships
    .map((member) => member.role)
    .filter((role): role is Role => !!role && VALID_ROLES.has(role as Role));
  if (roles.includes("admin")) {
    return "admin";
  }
  return roles[0] ?? fallback;
}

export async function switchActiveTenant({ tenantId }: { tenantId: string }) {
  const { profile } = await requireProfile();
  const supabase = await createServerSupabaseClient();

  let actorRole = profile.role;

  if (!profile.is_platform_admin) {
    const { data, error } = await supabase
      .from("memberships")
      .select("role")
      .eq("tenant_id", tenantId)
      .eq("user_id", profile.id);
    if (error) {
      throw new Error(error.message);
    }
    if (!data || data.length === 0) {
      throw new Error("You do not belong to this tenant.");
    }
    const nextRole = selectRoleFromMemberships(data, profile.role);
    actorRole = nextRole;
    const { error: updateError } = await supabase
      .from("profiles")
      .update({ tenant_id: tenantId, role: nextRole })
      .eq("id", profile.id);
    if (updateError) {
      throw new Error(updateError.message);
    }
  } else {
    const { error: updateError } = await supabase
      .from("profiles")
      .update({ tenant_id: tenantId })
      .eq("id", profile.id);
    if (updateError) {
      throw new Error(updateError.message);
    }
  }

  await logEvent(supabase, {
    aggregateType: "admin",
    aggregateId: tenantId,
    eventType: "TENANT_CONTEXT_SWITCHED",
    payload: {
      tenantId,
      action: "switch_active_tenant",
    },
    tenantId,
    actorRole,
  });

  return { tenantId };
}

export async function updateTenantSettings({
  tenantId,
  settings,
}: {
  tenantId: string;
  settings: Record<string, unknown>;
}) {
  const { profile } = await requireProfile();
  const supabase = await createServerSupabaseClient();
  await ensureTenantAdmin(supabase, tenantId, profile);

  const { error } = await supabase.from("tenant_settings").upsert(
    {
      tenant_id: tenantId,
      settings,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id" },
  );

  if (error) {
    throw new Error(error.message);
  }

  await logEvent(supabase, {
    aggregateType: "admin",
    aggregateId: tenantId,
    eventType: "TENANT_SETTINGS_UPDATED",
    payload: {
      tenantId,
      settings,
    },
    tenantId,
    actorRole: profile.role,
  });

  return { tenantId, settings };
}

export async function revokeInvite({ id }: { id: string }) {
  const { profile } = await requireProfile();
  const supabase = await createServerSupabaseClient();

  const { data: invite, error } = await supabase
    .from("invites")
    .select("id, tenant_id, status")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!invite) {
    throw new Error("Invite not found.");
  }

  await ensureTenantAdmin(supabase, invite.tenant_id, profile);

  if (invite.status !== "pending") {
    throw new Error("Only pending invites can be cancelled.");
  }

  const { error: updateError } = await supabase
    .from("invites")
    .update({ status: "cancelled" })
    .eq("id", invite.id);
  if (updateError) {
    throw new Error(updateError.message);
  }

  await logEvent(supabase, {
    aggregateType: "admin",
    aggregateId: invite.tenant_id,
    eventType: "USER_INVITE_CANCELLED",
    payload: {
      tenantId: invite.tenant_id,
      action: "invite_cancelled",
      inviteId: invite.id,
    },
    tenantId: invite.tenant_id,
    actorRole: profile.role,
  });
}

export async function listUserMemberships() {
  const { profile } = await requireProfile();
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("user_memberships_v")
    .select("tenant_id, tenant_code, tenant_name, role, created_at, user_id")
    .order("tenant_name", { ascending: true });

  if (error) {
    if (error.code === VIEW_MISSING) {
      return [];
    }
    throw new Error(error.message);
  }

  return (
    data?.filter((row) => row.user_id === profile.id).map((row) => ({
      tenantId: row.tenant_id,
      code: row.tenant_code,
      name: row.tenant_name,
      role: row.role as Role,
      created_at: row.created_at,
    })) ?? []
  );
}
