export const ADMIN_ROLES = [
  "super_admin",
  "operations",
  "moderator",
  "verification_reviewer",
  "support",
  "billing",
] as const;

export type AdminRole = (typeof ADMIN_ROLES)[number];

export const ADMIN_PERMISSIONS = [
  "overview.read",
  "users.read",
  "users.enforce",
  "moderation.read",
  "moderation.write",
  "verifications.read",
  "verifications.review",
  "data.read",
  "data.run",
  "rooms.read",
  "rooms.manage",
  "alerts.read",
  "billing.read",
  "system.read",
  "audit.read",
  "roles.manage",
] as const;

export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<AdminRole, readonly AdminPermission[]> = {
  super_admin: ADMIN_PERMISSIONS,
  operations: [
    "overview.read",
    "data.read",
    "data.run",
    "rooms.read",
    "rooms.manage",
    "alerts.read",
    "system.read",
    "audit.read",
  ],
  moderator: [
    "overview.read",
    "users.read",
    "users.enforce",
    "moderation.read",
    "moderation.write",
    "rooms.read",
    "rooms.manage",
    "audit.read",
  ],
  verification_reviewer: [
    "overview.read",
    "verifications.read",
    "verifications.review",
  ],
  support: [
    "overview.read",
    "users.read",
    "alerts.read",
    "billing.read",
    "audit.read",
  ],
  billing: ["overview.read", "billing.read"],
};

export type AdminNavigationItem = {
  href: string;
  label: string;
  permission: AdminPermission;
  status?: "coming-next";
};

export const ADMIN_NAVIGATION: readonly AdminNavigationItem[] = [
  { href: "/admin", label: "Overview", permission: "overview.read" },
  {
    href: "/admin/users",
    label: "Users",
    permission: "users.read",
  },
  {
    href: "/admin/moderation",
    label: "Moderation",
    permission: "moderation.read",
  },
  {
    href: "/admin/rooms",
    label: "Live Rooms",
    permission: "rooms.read",
  },
  {
    href: "/admin/creator-verifications",
    label: "Verifications",
    permission: "verifications.read",
  },
  { href: "/admin/data", label: "Data Operations", permission: "data.read" },
  {
    href: "/admin/alerts",
    label: "Alerts",
    permission: "alerts.read",
  },
  {
    href: "/admin/billing",
    label: "Billing",
    permission: "billing.read",
    status: "coming-next",
  },
  {
    href: "/admin/integrations",
    label: "System / Integrations",
    permission: "system.read",
  },
  {
    href: "/admin/audit",
    label: "Audit log",
    permission: "audit.read",
  },
  {
    href: "/admin/roles",
    label: "Admin roles",
    permission: "roles.manage",
  },
];

export function isAdminRole(value: unknown): value is AdminRole {
  return typeof value === "string" && ADMIN_ROLES.includes(value as AdminRole);
}

export function rolesHavePermission(
  roles: readonly AdminRole[],
  permission: AdminPermission,
) {
  return roles.some((role) => ROLE_PERMISSIONS[role].includes(permission));
}

export function visibleAdminNavigation(roles: readonly AdminRole[]) {
  return ADMIN_NAVIGATION.filter((item) =>
    rolesHavePermission(roles, item.permission),
  );
}

export function adminRoleLabel(role: AdminRole) {
  return role
    .split("_")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
