"use client";

import {
  BellRing,
  CircleDollarSign,
  Database,
  Gauge,
  History,
  IdCard,
  LifeBuoy,
  KeyRound,
  Settings,
  ShieldCheck,
  MessagesSquare,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  adminRoleLabel,
  visibleAdminNavigation,
  type AdminRole,
} from "@/lib/admin/policy";
import styles from "./AdminShell.module.css";

const ICONS = {
  "/admin": Gauge,
  "/admin/users": Users,
  "/admin/moderation": ShieldCheck,
  "/admin/rooms": MessagesSquare,
  "/admin/creator-verifications": IdCard,
  "/admin/data": Database,
  "/admin/alerts": BellRing,
  "/admin/billing": CircleDollarSign,
  "/admin/integrations": Settings,
  "/admin/audit": History,
  "/admin/roles": KeyRound,
} as const;

function isActive(pathname: string, href: string) {
  return href === "/admin"
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminShell({
  children,
  roles,
}: {
  children: React.ReactNode;
  roles: AdminRole[];
}) {
  const pathname = usePathname();
  const navigation = visibleAdminNavigation(roles);

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <Link className={styles.brand} href="/admin">
          <span className={styles.brandMark}>SR</span>
          <span>
            <strong>Stock Radar</strong>
            <small>Admin Console</small>
          </span>
        </Link>

        <nav aria-label="Admin navigation" className={styles.navigation}>
          {navigation.map((item) => {
            const Icon = ICONS[item.href as keyof typeof ICONS] || LifeBuoy;
            return (
              <Link
                aria-current={isActive(pathname, item.href) ? "page" : undefined}
                className={`${styles.navigationItem} ${
                  isActive(pathname, item.href) ? styles.active : ""
                }`}
                href={item.href}
                key={item.href}
              >
                <Icon aria-hidden="true" size={17} strokeWidth={1.8} />
                <span>{item.label}</span>
                {item.status === "coming-next" ? (
                  <small className={styles.comingNext}>Next</small>
                ) : null}
              </Link>
            );
          })}
        </nav>

        <div className={styles.sidebarFooter}>
          <span className={styles.roleLabel}>Active roles</span>
          <div className={styles.roles}>
            {roles.map((role) => (
              <span className={styles.roleChip} key={role}>
                {adminRoleLabel(role)}
              </span>
            ))}
          </div>
          <Link className={styles.siteLink} href="/dashboard-v2">
            Return to Stock Radar
          </Link>
        </div>
      </aside>

      <div className={styles.workspace}>
        <header className={styles.mobileHeader}>
          <Link className={styles.mobileBrand} href="/admin">
            Stock Radar Admin
          </Link>
          <Link className={styles.mobileExit} href="/dashboard-v2">
            Site
          </Link>
        </header>
        <div className={styles.mobileNavigation}>
          {navigation.map((item) => (
            <Link
              aria-current={isActive(pathname, item.href) ? "page" : undefined}
              className={isActive(pathname, item.href) ? styles.mobileActive : ""}
              href={item.href}
              key={item.href}
            >
              {item.label}
            </Link>
          ))}
        </div>
        <main className={styles.content}>{children}</main>
      </div>
    </div>
  );
}
