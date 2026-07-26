"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, Menu, Settings } from "lucide-react";
import { AuthStatus } from "@/components/AuthStatus";
import { StockRadarDesktopNavigation } from "@/components/shell/StockRadarDesktopNavigation";
import { StockRadarTickerSearch } from "@/components/shell/StockRadarTickerSearch";
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
  activeNavigationItem: StockRadarPrimaryNavigationKey;
  showThemeToggle?: boolean;
};

export function StockRadarProductHeader({
  activeNavigationItem,
  showThemeToggle = false,
}: StockRadarProductHeaderProps) {
  const pathname = usePathname();
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
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeMobileMenu, isMobileMenuOpen]);

  const handleItemActivate = (item: StockRadarNavigationItem) => {
    closeMobileMenu(item.kind === "action");
  };

  return (
    <>
      <header className={styles.header}>
        <div className={styles.brand}>
          <span>{stockRadarProductName}</span>
        </div>

        <StockRadarDesktopNavigation activeItem={activeNavigationItem} />

        <div aria-label="Dashboard actions" className={styles.actions}>
          <StockRadarTickerSearch onOpen={() => closeMobileMenu()} />
          <IconButton aria-label="Alerts" indicator>
            <Bell aria-hidden="true" size={18} />
          </IconButton>
          {showThemeToggle ? <StockRadarThemeToggle /> : null}
          <IconButton aria-label="Settings" className={styles.settingsButton}>
            <Settings aria-hidden="true" size={18} />
          </IconButton>
          <div className={styles.desktopAccount}>
            <AuthStatus />
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
          menuRef={mobileMenuRef}
          onItemActivate={handleItemActivate}
        />
      ) : null}
    </>
  );
}
