export const ROLE_VALUES = [
  "admin",
  "mining_operator",
  "stockpile_operator",
  "mixing_operator",
  "crushing_operator",
  "extrusion_operator",
  "dryyard_operator",
  "kiln_operator",
  "packing_operator",
  "dispatch_clerk",
  "sales_rep",
  "finance",
  "viewer",
] as const;

export type Role = (typeof ROLE_VALUES)[number];

export const ROLE_ROUTE_MAP: Record<Role, string> = {
  admin: "/admin",
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
  finance: "/finance",
  viewer: "/dashboard",
};

export const ROLE_OPTIONS: Array<{ value: Role; label: string }> =
  ROLE_VALUES.map((value) => ({
    value,
    label: value
      .replace(/_/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase()),
  }));

export function getDefaultRouteForRole(
  role: Role | null | undefined,
  options?: { isPlatformAdmin?: boolean | null | undefined },
) {
  if (options?.isPlatformAdmin) return "/admin";
  if (!role) return "/dashboard";
  return ROLE_ROUTE_MAP[role] ?? "/dashboard";
}
