"use client";

import {
  BellRing,
  ChevronDown,
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
  Send,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  adminRoleLabel,
  isAdminNavigationActive as isActive,
  visibleAdminNavigation,
  type AdminRole,
} from "@/lib/admin/policy";
import styles from "./AdminShell.module.css";

const ICONS = {
  "/admin": Gauge,
  "/admin/users": Users,
  "/admin/moderation": ShieldCheck,
  "/admin/rooms": MessagesSquare,
  "/admin/telegram-channel": Send,
  "/admin/creator-verifications": IdCard,
  "/admin/data": Database,
  "/admin/alerts": BellRing,
  "/admin/billing": CircleDollarSign,
  "/admin/integrations": Settings,
  "/admin/audit": History,
  "/admin/roles": KeyRound,
} as const;

export function AdminShell({
  children,
  roles,
}: {
  children: React.ReactNode;
  roles: AdminRole[];
}) {
  const pathname = usePathname();
  const navigation = visibleAdminNavigation(roles);
  const dataNavigation = navigation.find((item) => item.href === "/admin/data");
  const dataActive = dataNavigation?.children?.some((item) => isActive(pathname, item.href)) ?? false;
  const [dataExpanded, setDataExpanded] = useState(dataActive);

  useEffect(() => {
    if (dataActive) setDataExpanded(true);
  }, [pathname, dataActive]);

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
            if (item.children) {
              return (
                <div key={item.href}>
                  <button
                    aria-controls="admin-data-navigation"
                    aria-expanded={dataExpanded}
                    className={`${styles.navigationItem} ${styles.navigationToggle} ${dataActive ? styles.active : ""}`}
                    onClick={() => setDataExpanded((expanded) => !expanded)}
                    type="button"
                  >
                    <Icon aria-hidden="true" size={17} strokeWidth={1.8} />
                    <span>{item.label}</span>
                    <ChevronDown aria-hidden="true" className={dataExpanded ? styles.chevronExpanded : ""} size={14} />
                  </button>
                  <div className={styles.subnavigation} hidden={!dataExpanded} id="admin-data-navigation">
                    {item.children.map((child) => (
                      <Link
                        aria-current={isActive(pathname, child.href) ? "page" : undefined}
                        className={`${styles.subnavigationItem} ${isActive(pathname, child.href) ? styles.active : ""}`}
                        href={child.href}
                        key={child.href}
                      >
                        {child.label}
                      </Link>
                    ))}
                  </div>
                </div>
              );
            }
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
          {navigation.map((item) => item.children ? (
            <button
              aria-controls="admin-mobile-data-navigation"
              aria-expanded={dataExpanded}
              className={dataActive ? styles.mobileActive : ""}
              key={item.href}
              onClick={() => setDataExpanded((expanded) => !expanded)}
              type="button"
            >
              {item.label}
              <ChevronDown aria-hidden="true" className={dataExpanded ? styles.chevronExpanded : ""} size={13} />
            </button>
          ) : (
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
        {dataNavigation?.children ? (
          <nav
            aria-label="Data Operations"
            className={styles.mobileSubnavigation}
            hidden={!dataExpanded}
            id="admin-mobile-data-navigation"
          >
            {dataNavigation.children.map((item) => (
              <Link
                aria-current={isActive(pathname, item.href) ? "page" : undefined}
                className={isActive(pathname, item.href) ? styles.mobileActive : ""}
                href={item.href}
                key={item.href}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        ) : null}
        <main className={styles.content}>{children}</main>
      </div>
    </div>
  );
}
