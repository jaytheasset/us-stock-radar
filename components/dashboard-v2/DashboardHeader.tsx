"use client";

import { useEffect, useRef, useState } from "react";
import { Bell, Menu, Search, Settings } from "lucide-react";
import { IconButton } from "@/components/ui/IconButton";

const primaryNavItems = [
  { label: "Markets", href: "/dashboard-v2", active: true },
  { label: "Live Feed", href: "/feed" },
  { label: "Watchlist", href: "/watchlist" },
  { label: "News", href: "/news" },
  { label: "Filings", href: "/filings" },
  { label: "Alerts", href: "/alerts" },
  { label: "Calendar", href: "/calendar" },
  { label: "Premium", href: "/premium", premium: true },
];

const mobileMenuItems = [
  ...primaryNavItems,
  { label: "Settings", href: "#settings" },
];

export function DashboardHeader() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const mobileMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isMobileMenuOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;

      if (mobileMenuRef.current?.contains(target) || mobileMenuButtonRef.current?.contains(target)) {
        return;
      }

      setIsMobileMenuOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsMobileMenuOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isMobileMenuOpen]);

  return (
    <>
      <header className="dashboard-v2-header">
        <div className="dashboard-v2-brand">
          <span>STOCK RADAR</span>
          <small>
            15m delayed
            <i aria-hidden="true" />
          </small>
        </div>

        <nav className="dashboard-v2-primary-nav dashboard-v2-primary-nav-desktop" aria-label="Primary navigation">
          {primaryNavItems.map((item) => (
            <a
              key={item.label}
              className={item.premium ? "dashboard-v2-nav-premium" : undefined}
              href={item.href}
              aria-current={item.active ? "page" : undefined}
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="dashboard-v2-header-actions" aria-label="Dashboard actions">
          <button className="dashboard-v2-header-search-button" type="button" aria-label="Search">
            <Search aria-hidden="true" size={18} />
            <span>Search</span>
          </button>
          <IconButton aria-label="Alerts" indicator>
            <Bell aria-hidden="true" size={18} />
          </IconButton>
          <IconButton
            aria-label="Settings"
            className="dashboard-v2-settings-button"
          >
            <Settings aria-hidden="true" size={18} />
          </IconButton>
          <IconButton
            aria-controls="dashboard-v2-mobile-menu"
            aria-expanded={isMobileMenuOpen}
            aria-haspopup="menu"
            aria-label="Open menu"
            className="dashboard-v2-mobile-menu-button"
            onClick={() => setIsMobileMenuOpen((current) => !current)}
            ref={mobileMenuButtonRef}
          >
            <Menu aria-hidden="true" size={19} />
          </IconButton>
        </div>
      </header>

      {isMobileMenuOpen ? (
        <div
          className="dashboard-v2-mobile-menu-popover"
          id="dashboard-v2-mobile-menu"
          ref={mobileMenuRef}
          role="menu"
        >
          <nav className="dashboard-v2-mobile-menu-list" aria-label="Mobile menu">
            {mobileMenuItems.map((item) => (
              <a
                aria-current={item.active ? "page" : undefined}
                className={item.premium ? "dashboard-v2-mobile-menu-premium" : undefined}
                href={item.href}
                key={item.label}
                onClick={() => setIsMobileMenuOpen(false)}
                role="menuitem"
              >
                <span>{item.label}</span>
              </a>
            ))}
          </nav>
        </div>
      ) : null}
    </>
  );
}
