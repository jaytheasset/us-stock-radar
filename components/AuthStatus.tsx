"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { logoutAndReloadCurrentPage } from "@/lib/auth/clientLogout";

type AuthUser = {
  id: string;
  email: string | null;
  emailConfirmed?: boolean;
};

type AuthMeResponse = {
  ok?: boolean;
  sessionRefreshed?: boolean;
  user?: AuthUser | null;
};

type LiveRoomProfileResponse = {
  data?: {
    isGuest?: boolean;
    publicProfileId?: string;
  } | null;
  ok?: boolean;
};

type AuthStatusProps = {
  accountMenu?: boolean;
  loginHref?: string;
  signupHref?: string;
  showCreateAccount?: boolean;
};

export function AuthStatus({
  accountMenu = false,
  loginHref = "/login",
  signupHref = "/signup",
  showCreateAccount = true,
}: AuthStatusProps) {
  const router = useRouter();
  const accountMenuId = useId();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutFailed, setLogoutFailed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [publicProfileId, setPublicProfileId] = useState<string | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;

    async function loadUser() {
      try {
        const response = await fetch("/api/auth/me", { cache: "no-store" });
        const payload = (await response.json()) as AuthMeResponse;
        if (active) {
          setUser(payload.user || null);
          if (payload.sessionRefreshed && payload.user) {
            router.refresh();
          }
        }
      } catch {
        if (active) setUser(null);
      } finally {
        if (active) setLoaded(true);
      }
    }

    void loadUser();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!accountMenu || !user) {
      setPublicProfileId(null);
      return;
    }

    let active = true;
    void fetch("/api/live-room/profile", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as LiveRoomProfileResponse;
      })
      .then((payload) => {
        const profile = payload?.data;
        if (
          active &&
          profile?.isGuest === false &&
          typeof profile.publicProfileId === "string"
        ) {
          setPublicProfileId(profile.publicProfileId);
        }
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, [accountMenu, user]);

  useEffect(() => {
    if (!menuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        menuButtonRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      ) {
        return;
      }
      setMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setMenuOpen(false);
      requestAnimationFrame(() => menuButtonRef.current?.focus());
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    setLogoutFailed(false);
    try {
      await logoutAndReloadCurrentPage();
    } catch {
      setLogoutFailed(true);
      setLoggingOut(false);
    }
  }

  if (!loaded) {
    return (
      <div className="auth-status" aria-label="Account status" role="status">
        <span className="auth-status-loading" aria-hidden="true" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="auth-status" aria-label="Account actions" role="group">
        <Link className="auth-link-secondary" href={loginHref}>
          Log in
        </Link>
        {showCreateAccount ? (
          <Link className="auth-link-primary" href={signupHref}>
            Create account
          </Link>
        ) : null}
      </div>
    );
  }

  const label = user.email || "Account";
  const initial = label.trim().charAt(0).toUpperCase() || "U";
  const profileHref = publicProfileId
    ? `/live/members/${publicProfileId}`
    : "/account";

  if (accountMenu) {
    return (
      <div
        className="auth-status auth-account-menu"
        aria-label="Account actions"
        role="group"
      >
        <button
          aria-controls={menuOpen ? accountMenuId : undefined}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          aria-label={`Open account menu for ${label}`}
          className="auth-user-pill auth-account-menu-button"
          onClick={() => setMenuOpen((current) => !current)}
          onKeyDown={(event) => {
            if (event.key !== "ArrowDown") return;
            event.preventDefault();
            setMenuOpen(true);
            requestAnimationFrame(() => {
              menuRef.current
                ?.querySelector<HTMLElement>('[role="menuitem"]')
                ?.focus();
            });
          }}
          ref={menuButtonRef}
          title={label}
          type="button"
        >
          <span aria-hidden="true">{initial}</span>
          <strong>{label}</strong>
          <ChevronDown aria-hidden="true" className="auth-account-chevron" size={14} />
        </button>
        {menuOpen ? (
          <div
            aria-label="Account menu"
            className="auth-account-popover"
            id={accountMenuId}
            ref={menuRef}
            role="menu"
          >
            <Link href={profileHref} onClick={() => setMenuOpen(false)} role="menuitem">
              View profile
            </Link>
            <Link
              href={publicProfileId ? `${profileHref}?edit=profile` : "/account"}
              onClick={() => setMenuOpen(false)}
              role="menuitem"
            >
              Edit profile
            </Link>
            <Link href="/account" onClick={() => setMenuOpen(false)} role="menuitem">
              Account settings
            </Link>
            <Link
              href="/account/brokerage"
              onClick={() => setMenuOpen(false)}
              role="menuitem"
            >
              Brokerage verification
            </Link>
            <Link href="/premium" onClick={() => setMenuOpen(false)} role="menuitem">
              Manage plan
            </Link>
            <button
              aria-live="polite"
              disabled={loggingOut}
              onClick={() => void handleLogout()}
              role="menuitem"
              type="button"
            >
              {loggingOut
                ? "Logging out..."
                : logoutFailed
                  ? "Logout failed — retry"
                  : "Log out"}
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="auth-status" aria-label="Account actions" role="group">
      <Link className="auth-user-pill" href="/account" title={label}>
        <span aria-hidden="true">{initial}</span>
        <strong>{label}</strong>
      </Link>
      <button
        aria-live="polite"
        className="auth-logout-button"
        disabled={loggingOut}
        type="button"
        onClick={handleLogout}
      >
        {loggingOut
          ? "Logging out..."
          : logoutFailed
            ? "Logout failed — retry"
            : "Logout"}
      </button>
    </div>
  );
}
