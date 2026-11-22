import {
  BarChart3,
  Building2,
  CalendarDays,
  ClipboardList,
  FileSignature,
  FileText,
  HardHat,
  IdCard,
  LayoutDashboard,
  Layers,
  Receipt,
  Settings,
  ShoppingCart,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { Permission } from "@/lib/auth/permissions";

export type NavItem = {
  key: string; // messages key under "nav"
  href: string;
  icon: LucideIcon;
  permission?: Permission;
  phase?: number; // not built yet → shown as "soon"
};

export type NavGroup = { key: string | null; items: NavItem[] };

export const NAV: NavGroup[] = [
  { key: null, items: [{ key: "home", href: "/", icon: LayoutDashboard }] },
  {
    key: "work",
    items: [
      { key: "clients", href: "/clients", icon: Users, permission: "clients.view", phase: 3 },
      { key: "quotations", href: "/quotations", icon: FileText, permission: "quotes.view", phase: 3 },
      { key: "contracts", href: "/contracts", icon: FileSignature, permission: "quotes.view", phase: 4 },
      { key: "projects", href: "/projects", icon: HardHat, permission: "projects.view", phase: 4 },
      { key: "schedule", href: "/schedule", icon: CalendarDays, permission: "schedule.view", phase: 5 },
    ],
  },
  {
    key: "finance",
    items: [
      { key: "purchases", href: "/purchases", icon: ShoppingCart, permission: "purchases.view", phase: 6 },
      { key: "invoices", href: "/invoices", icon: Receipt, permission: "finance.view", phase: 10 },
      { key: "reports", href: "/reports", icon: BarChart3, permission: "reports.view", phase: 9 },
    ],
  },
  {
    key: "setup",
    items: [
      { key: "catalogue", href: "/catalogue", icon: Layers, permission: "catalogue.view" },
      { key: "team", href: "/team", icon: IdCard, permission: "hr.view" },
      { key: "settings", href: "/settings", icon: Settings },
    ],
  },
];

export const SETTINGS_NAV = [
  { key: "company", href: "/settings", icon: Building2, permission: undefined },
  { key: "branding", href: "/settings/branding", icon: Layers, permission: undefined },
  { key: "members", href: "/settings/members", icon: Users, permission: undefined },
  { key: "preferences", href: "/settings/preferences", icon: Settings, permission: undefined },
  { key: "audit", href: "/settings/audit", icon: ClipboardList, permission: "audit.view" as Permission },
] as const;

export function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
