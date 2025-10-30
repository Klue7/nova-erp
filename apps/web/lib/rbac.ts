import { cache } from "react";
import { redirect } from "next/navigation";

import { createServerSupabaseClient } from "@/utils/supabase/server";
import {
  type Role,
  ROLE_OPTIONS,
  ROLE_ROUTE_MAP,
  getDefaultRouteForRole,
} from "@/lib/roles";

export type UserProfile = {
  id: string;
  role: Role;
  tenant_id: string;
  full_name: string | null;
  created_at: string | null;
  is_platform_admin: boolean;
};

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
    .select(
      "id, role, tenant_id, full_name, created_at, is_platform_admin",
    )
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
  requiredRole?: (Role | "platform_admin") | Array<Role | "platform_admin">;
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
    if (!profile.is_platform_admin) {
      const roles = Array.isArray(requiredRole)
        ? requiredRole
        : [requiredRole];
      const matches = roles.some(
        (role) => role === profile.role || role === "platform_admin",
      );
      if (!matches) {
        redirect(
          getDefaultRouteForRole(profile.role, {
            isPlatformAdmin: profile.is_platform_admin,
          }),
        );
      }
    }
  }

  return { session, profile };
}

export async function hasRole(role: Role | "platform_admin") {
  const { profile } = await getUserProfile();
  if (!profile) return false;
  if (role === "platform_admin") {
    return profile.is_platform_admin;
  }
  return profile.role === role;
}

export { ROLE_OPTIONS, ROLE_ROUTE_MAP, getDefaultRouteForRole };
export type { Role };
