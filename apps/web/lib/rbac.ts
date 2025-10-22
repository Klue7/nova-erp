import { cache } from "react";
import { redirect } from "next/navigation";

import { createServerSupabaseClient } from "@/utils/supabase/server";

export type UserProfile = {
  id: string;
  role: Role;
  tenant_id: string;
  full_name: string | null;
  created_at: string | null;
};

export type Role =
  | "admin"
  | "mining_operator"
  | "stockpile_operator"
  | "mixing_operator"
  | "crushing_operator"
  | "extrusion_operator"
  | "dryyard_operator"
  | "kiln_operator"
  | "packing_operator"
  | "dispatch_clerk"
  | "sales_rep"
  | "finance"
  | "viewer";

export const ROLE_ROUTE_MAP: Record<Role, string> = {
  admin: "/dashboard",
  mining_operator: "/mining",
  stockpile_operator: "/stockpile",
  mixing_operator: "/mixing",
  crushing_operator: "/crushing",
  extrusion_operator: "/extrusion",
  dryyard_operator: "/dry-yard",
  kiln_operator: "/kiln",
  packing_operator: "/packing",
  dispatch_clerk: "/dispatch",
  sales_rep: "/sales",
  finance: "/dashboard",
  viewer: "/dashboard",
};

export const ROLE_OPTIONS: Array<{ value: Role; label: string }> =
  Object.entries(ROLE_ROUTE_MAP).map(([value]) => ({
    value: value as Role,
    label: value
      .replace(/_/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase()),
  }));

export function getDefaultRouteForRole(role: Role | null | undefined) {
  if (!role) return "/dashboard";
  return ROLE_ROUTE_MAP[role] ?? "/dashboard";
}

export const getUserProfile = cache(async () => {
  const supabase = await createServerSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return { session: null, profile: null as UserProfile | null };
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, role, tenant_id, full_name, created_at")
    .eq("id", session.user.id)
    .maybeSingle();

  if (error && error.code !== "PGRST116" && error.code !== "42P01") {
    console.error("getUserProfile", error);
  }

  return {
    session,
    profile: (profile as UserProfile | null) ?? null,
  };
});

type GuardOptions = {
  requiredRole?: Role | Role[];
  requireProfile?: boolean;
};

export async function guardRoute(options: GuardOptions = {}) {
  const { requiredRole, requireProfile = true } = options;
  const { session, profile } = await getUserProfile();

  if (!session) {
    redirect("/login");
  }

  if (requireProfile && !profile) {
    redirect("/onboarding");
  }

  if (requiredRole && profile) {
    const roles = Array.isArray(requiredRole) ? requiredRole : [requiredRole];
    if (!roles.includes(profile.role)) {
      redirect(getDefaultRouteForRole(profile.role));
    }
  }

  return { session, profile };
}

export async function hasRole(role: Role) {
  const { profile } = await getUserProfile();
  return profile?.role === role;
}
