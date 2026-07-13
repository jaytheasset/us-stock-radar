"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, Menu, Search, Settings } from "lucide-react";
import { StockRadarDesktopNavigation } from "@/components/shell/StockRadarDesktopNavigation";
import {
  StockRadarMobileNavigationMenu,
  stockRadarMobileMenuId,
} from "@/components/shell/StockRadarMobileNavigationMenu";
import {
  stockRadarMarketStatus,
  stockRadarProductName,
  type StockRadarNavigationItem,
  type StockRadarPrimaryNavigationKey,
} from "@/components/shell/stockRadarNavigation";
import { IconButton } from "@/components/ui/IconButton";
import styles from "./StockRadarProductHeader.module.css";

export type StockRadarProductHeaderProps = {
  activeNavigationItem: StockRadarPrimaryNavigationKey;
};

export function StockRadarProductHeader({
  activeNavigationItem,
}: StockRadarProductHeaderProps) {
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
          <small>
            {stockRadarMarketStatus}
            <i aria-hidden="true" />
          </small>
        </div>

        <StockRadarDesktopNavigation activeItem={activeNavigationItem} />

        <div aria-label="Dashboard actions" className={styles.actions}>
          <button aria-label="Search" className={styles.searchButton} type="button">
            <Search aria-hidden="true" size={18} />
            <span>Search</span>
          </button>
          <IconButton aria-label="Alerts" indicator>
            <Bell aria-hidden="true" size={18} />
          </IconButton>
          <IconButton aria-label="Settings" className={styles.settingsButton}>
            <Settings aria-hidden="true" size={18} />
          </IconButton>
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
