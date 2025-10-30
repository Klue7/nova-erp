import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Boxes,
  Factory,
  Flame,
  Layers,
  LayoutDashboard,
  LineChart,
  Package,
  Receipt,
  Pickaxe,
  Ruler,
  Shield,
  Truck,
  Warehouse,
} from "lucide-react";

export type ModuleLink = {
  label: string;
  href: string;
  description: string;
  icon: LucideIcon;
};

export const MODULE_LINKS: ModuleLink[] = [
  {
    label: "Dashboard",
    href: "/dashboard",
    description: "Role-based KPIs and production insights.",
    icon: LayoutDashboard,
  },
  {
    label: "Reports",
    href: "/reports",
    description: "Executive throughput, quality, and lead-time dashboards.",
    icon: BarChart3,
  },
  {
    label: "Mining",
    href: "/mining",
    description: "Capture blasting, haul cycles, and ore quality.",
    icon: Pickaxe,
  },
  {
    label: "Stockpile",
    href: "/stockpile",
    description: "Monitor stock levels and contamination risk.",
    icon: Warehouse,
  },
  {
    label: "Mixing",
    href: "/mixing",
    description: "Blend recipes for optimal clay composition.",
    icon: Layers,
  },
  {
    label: "Crushing",
    href: "/crushing",
    description: "Track crusher throughput and downtime.",
    icon: Factory,
  },
  {
    label: "Extrusion",
    href: "/extrusion",
    description: "Supervise extruder settings and outputs.",
    icon: Ruler,
  },
  {
    label: "Dry Yard",
    href: "/dry-yard",
    description: "Schedule racks, monitor moisture loss.",
    icon: Boxes,
  },
  {
    label: "Kiln",
    href: "/kiln",
    description: "Control firing curves and energy usage.",
    icon: Flame,
  },
  {
    label: "Packing",
    href: "/packing",
    description: "Plan packaging lines and pallet builds.",
    icon: Package,
  },
  {
    label: "Dispatch",
    href: "/dispatch",
    description: "Coordinate deliveries and fleet status.",
    icon: Truck,
  },
  {
    label: "Sales",
    href: "/sales",
    description: "Manage orders, invoices, and customer updates.",
    icon: LineChart,
  },
  {
    label: "Finance",
    href: "/finance",
    description: "Track invoices, payments, and accounts receivable aging.",
    icon: Receipt,
  },
  {
    label: "Admin",
    href: "/admin",
    description: "Manage tenants, memberships, invites, and audit trails.",
    icon: Shield,
  },
];

export const PROTECTED_PATH_PREFIXES = [
  "/onboarding",
  ...MODULE_LINKS.map((link) => link.href),
];
