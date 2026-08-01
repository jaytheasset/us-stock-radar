"use client";

import Link from "next/link";
import { Bell, Check, CheckCheck } from "lucide-react";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DeliveredAlertItem } from "@/lib/alerts/types";
import { IconButton } from "@/components/ui/IconButton";
import styles from "./AlertNotificationsMenu.module.css";

type AuthState = "loading" | "authenticated" | "guest" | "error";

export function AlertNotificationsMenu({ loginHref }: { loginHref: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [authState, setAuthState] = useState<AuthState>("loading");
  const [alerts, setAlerts] = useState<DeliveredAlertItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [busyId, setBusyId] = useState("");
  const [markingAll, setMarkingAll] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const loadAlerts = useCallback(async () => {
    try {
      const response = await fetch(
        "/api/alerts/delivered?limit=8&status=sent",
        { cache: "no-store" },
      );
      const payload = (await response.json().catch(() => null)) as
        | DeliveredAlertItem[]
        | null;
      const responseAuthState = response.headers.get("X-Auth-State");

      if (responseAuthState === "guest" || response.status === 401) {
        setAuthState("guest");
        setAlerts([]);
        setUnreadCount(0);
        return;
      }
      if (!response.ok || !Array.isArray(payload)) {
        throw new Error("Alert notifications are temporarily unavailable.");
      }

      const unread = Number(response.headers.get("X-Unread-Count") || 0);
      setAlerts(payload);
      setUnreadCount(Number.isFinite(unread) ? Math.max(0, unread) : 0);
      setAuthState("authenticated");
    } catch {
      setAuthState("error");
    }
  }, []);

  useEffect(() => {
    let active = true;

    async function initialize() {
      try {
        const response = await fetch("/api/auth/me", { cache: "no-store" });
        const payload = (await response.json().catch(() => null)) as {
          user?: { id?: unknown } | null;
        } | null;
        if (!active) return;
        if (!response.ok || !payload?.user?.id) {
          setAuthState("guest");
          return;
        }
        await loadAlerts();
      } catch {
        if (active) setAuthState("error");
      }
    }

    void initialize();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadAlerts();
    }, 60_000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [loadAlerts]);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    void loadAlerts();

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus({ preventScroll: true });
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [loadAlerts, open]);

  async function markRead(alert: DeliveredAlertItem) {
    if (alert.isRead || busyId) return;
    setBusyId(alert.id);
    try {
      const response = await fetch("/api/alerts/delivered", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: alert.id, read: true }),
      });
      if (response.status === 401) {
        setAuthState("guest");
        setAlerts([]);
        setUnreadCount(0);
        return;
      }
      if (!response.ok) throw new Error("Failed to mark alert read.");
      const readAt = new Date().toISOString();
      setAlerts((current) =>
        current.map((item) =>
          item.id === alert.id
            ? { ...item, isRead: true, readAt }
            : item,
        ),
      );
      setUnreadCount((current) => Math.max(0, current - 1));
    } catch {
      setAuthState("error");
    } finally {
      setBusyId("");
    }
  }

  async function markAllRead() {
    if (!unreadCount || markingAll) return;
    setMarkingAll(true);
    try {
      const response = await fetch("/api/alerts/delivered", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true, read: true }),
      });
      if (response.status === 401) {
        setAuthState("guest");
        setAlerts([]);
        setUnreadCount(0);
        return;
      }
      if (!response.ok) throw new Error("Failed to mark alerts read.");
      const readAt = new Date().toISOString();
      setAlerts((current) =>
        current.map((item) => ({ ...item, isRead: true, readAt })),
      );
      setUnreadCount(0);
    } catch {
      setAuthState("error");
    } finally {
      setMarkingAll(false);
    }
  }

  const badge = unreadCount > 99 ? "99+" : String(unreadCount);
  return (
    <div className={styles.root} ref={rootRef}>
      <IconButton
        aria-controls={open ? "stock-radar-alert-notifications" : undefined}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={
          unreadCount
            ? `Alerts, ${unreadCount} unread`
            : "Alerts, no unread notifications"
        }
        className={styles.button}
        onClick={() => setOpen((current) => !current)}
        ref={buttonRef}
      >
        <Bell aria-hidden="true" size={18} />
      </IconButton>
      {unreadCount > 0 ? (
        <span aria-hidden="true" className={styles.badge}>
          {badge}
        </span>
      ) : null}

      {open ? (
        <section
          aria-label="Alert notifications"
          className={styles.popover}
          id="stock-radar-alert-notifications"
          role="dialog"
        >
          <header className={styles.heading}>
            <div>
              <span>ALERT CENTER</span>
              <strong>Notifications</strong>
            </div>
            {authState === "authenticated" ? (
              <button
                disabled={!unreadCount || markingAll}
                onClick={() => void markAllRead()}
                type="button"
              >
                <CheckCheck aria-hidden="true" size={14} />
                {markingAll ? "Marking..." : "Mark all read"}
              </button>
            ) : null}
          </header>

          {authState === "loading" ? (
            <p className={styles.state}>Loading alerts...</p>
          ) : authState === "guest" ? (
            <div className={styles.state}>
              <p>Sign in to see your delivered alerts and unread count.</p>
              <Link className={styles.signIn} href={loginHref}>
                Log in
              </Link>
            </div>
          ) : authState === "error" ? (
            <div className={styles.state}>
              <p>Alert notifications are temporarily unavailable.</p>
              <button onClick={() => void loadAlerts()} type="button">
                Try again
              </button>
            </div>
          ) : alerts.length ? (
            <ul className={styles.list}>
              {alerts.map((alert) => (
                <li data-read={alert.isRead} key={alert.id}>
                  <div>
                    <span>
                      {alert.ticker || alert.sourceLabel || "Market"}
                    </span>
                    <strong>{alert.title}</strong>
                    <small>{formatDeliveredAt(alert.deliveredAt)}</small>
                  </div>
                  {alert.isRead ? (
                    <span className={styles.readLabel}>
                      <Check aria-hidden="true" size={13} />
                      Read
                    </span>
                  ) : (
                    <button
                      aria-label={`Mark ${alert.title} as read`}
                      disabled={busyId === alert.id}
                      onClick={() => void markRead(alert)}
                      type="button"
                    >
                      {busyId === alert.id ? "Saving..." : "Mark read"}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.state}>No delivered alerts yet.</p>
          )}

          <footer className={styles.footer}>
            <Link href="/alerts" onClick={() => setOpen(false)}>
              Open Alerts
            </Link>
          </footer>
        </section>
      ) : null}
    </div>
  );
}

function formatDeliveredAt(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Recently";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
