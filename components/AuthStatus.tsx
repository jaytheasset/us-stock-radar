"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
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

type AuthStatusProps = {
  loginHref?: string;
  signupHref?: string;
  showCreateAccount?: boolean;
};

export function AuthStatus({ loginHref = "/login", signupHref = "/signup", showCreateAccount = true }: AuthStatusProps) {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutFailed, setLogoutFailed] = useState(false);

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
      <div className="auth-status" aria-label="Account status">
        <span className="auth-status-loading" aria-hidden="true" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="auth-status" aria-label="Account actions">
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

  return (
    <div className="auth-status" aria-label="Account actions">
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
