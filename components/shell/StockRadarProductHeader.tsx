"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Menu } from "lucide-react";
import Link from "next/link";
import { AuthStatus } from "@/components/AuthStatus";
import { StockRadarDesktopNavigation } from "@/components/shell/StockRadarDesktopNavigation";
import { LiveRoomUnreadMenu } from "@/components/shell/LiveRoomUnreadMenu";
import { StockRadarTickerSearch } from "@/components/shell/StockRadarTickerSearch";
import { AlertNotificationsMenu } from "@/components/shell/AlertNotificationsMenu";
import { StockRadarThemeToggle } from "@/components/shell/StockRadarThemeToggle";
import {
  StockRadarMobileNavigationMenu,
  stockRadarMobileMenuId,
} from "@/components/shell/StockRadarMobileNavigationMenu";
import {
  stockRadarProductName,
  type StockRadarNavigationItem,
  type StockRadarPrimaryNavigationKey,
} from "@/components/shell/stockRadarNavigation";
import { IconButton } from "@/components/ui/IconButton";
import styles from "./StockRadarProductHeader.module.css";

export type StockRadarProductHeaderProps = {
  activeNavigationItem: StockRadarPrimaryNavigationKey | null;
  showThemeToggle?: boolean;
};

export function StockRadarProductHeader({
  activeNavigationItem,
  showThemeToggle = false,
}: StockRadarProductHeaderProps) {
  const pathname = usePathname();
  const authReturnPath =
    pathname && pathname.startsWith("/") && !pathname.startsWith("//")
      ? pathname
      : "/";
  const loginHref = `/login?next=${encodeURIComponent(authReturnPath)}`;
  const signupHref = `/signup?next=${encodeURIComponent(authReturnPath)}`;
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const mobileMenuRef = useRef<HTMLDivElement>(null);

  const closeMobileMenu = useCallback((restoreFocus = false) => {
    setIsMobileMenuOpen(false);

    if (restoreFocus) {
      requestAnimationFrame(() => {
        mobileMenuButtonRef.current?.focus({ preventScroll: true });
      });
    }
  }, []);

  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!isMobileMenuOpen) {
      return;
    }

    const body = document.body;
    const previousBodyOverflow = body.style.overflow;
    const previousBodyPaddingRight = body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;

    if (scrollbarWidth > 0) {
      const bodyPaddingRight = window.getComputedStyle(body).paddingRight;
      body.style.paddingRight = `calc(${bodyPaddingRight} + ${scrollbarWidth}px)`;
    }
    body.style.overflow = "hidden";
    requestAnimationFrame(() => {
      mobileMenuRef.current
        ?.querySelector<HTMLElement>('[role="menuitem"]')
        ?.focus({ preventScroll: true });
    });

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;

      if (mobileMenuRef.current?.contains(target) || mobileMenuButtonRef.current?.contains(target)) {
        return;
      }

      closeMobileMenu();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMobileMenu(true);
        return;
      }

      if (event.key === "Tab" && mobileMenuRef.current) {
        const focusable = Array.from(
          mobileMenuRef.current.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        );
        const first = focusable.at(0);
        const last = focusable.at(-1);
        if (!first || !last) return;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
      body.style.overflow = previousBodyOverflow;
      body.style.paddingRight = previousBodyPaddingRight;
    };
  }, [closeMobileMenu, isMobileMenuOpen]);

  const handleItemActivate = (_item: StockRadarNavigationItem) => {
    closeMobileMenu();
  };

  return (
    <>
      <header className={styles.header}>
        <Link
          aria-label={`${stockRadarProductName} 홈`}
          className={styles.brand}
          href="/dashboard-v2"
        >
          <span className={styles.brandFull}>{stockRadarProductName}</span>
          <span aria-hidden="true" className={styles.brandMonogram}>
            SR
          </span>
        </Link>

        <StockRadarDesktopNavigation activeItem={activeNavigationItem} />

        <div
          aria-label="Dashboard actions"
          className={styles.actions}
          role="group"
        >
          <StockRadarTickerSearch onOpen={() => closeMobileMenu()} />
          <LiveRoomUnreadMenu />
          <AlertNotificationsMenu loginHref={loginHref} />
          {showThemeToggle ? (
            <div className={styles.headerThemeToggle}>
              <StockRadarThemeToggle />
            </div>
          ) : null}
          <div className={styles.desktopAccount}>
            <AuthStatus
              accountMenu
              loginHref={loginHref}
              signupHref={signupHref}
            />
          </div>
          <IconButton
            aria-controls={isMobileMenuOpen ? stockRadarMobileMenuId : undefined}
            aria-expanded={isMobileMenuOpen}
            aria-haspopup="menu"
            aria-label="Open menu"
            className={styles.mobileMenuButton}
            onClick={() => setIsMobileMenuOpen((current) => !current)}
            ref={mobileMenuButtonRef}
          >
            <Menu aria-hidden="true" size={19} />
          </IconButton>
        </div>
      </header>

      {isMobileMenuOpen ? (
        <StockRadarMobileNavigationMenu
          activeItem={activeNavigationItem}
          loginHref={loginHref}
          menuRef={mobileMenuRef}
          onItemActivate={handleItemActivate}
          showThemeToggle={showThemeToggle}
          signupHref={signupHref}
        />
      ) : null}
    </>
  );
}
