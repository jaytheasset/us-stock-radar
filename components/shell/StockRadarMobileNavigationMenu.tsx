import type { Ref } from "react";
import { AuthStatus } from "@/components/AuthStatus";
import { StockRadarThemeToggle } from "@/components/shell/StockRadarThemeToggle";
import {
  stockRadarMobileNavigationItems,
  type StockRadarNavigationItem,
  type StockRadarPrimaryNavigationKey,
} from "@/components/shell/stockRadarNavigation";
import styles from "./StockRadarProductHeader.module.css";

export const stockRadarMobileMenuId = "stock-radar-mobile-navigation-menu";

export type StockRadarMobileNavigationMenuProps = {
  activeItem: StockRadarPrimaryNavigationKey | null;
  loginHref: string;
  menuRef: Ref<HTMLDivElement>;
  onItemActivate: (item: StockRadarNavigationItem) => void;
  showThemeToggle: boolean;
  signupHref: string;
};

export function StockRadarMobileNavigationMenu({
  activeItem,
  loginHref,
  menuRef,
  onItemActivate,
  showThemeToggle,
  signupHref,
}: StockRadarMobileNavigationMenuProps) {
  return (
    <div
      className={styles.mobileMenuPopover}
      id={stockRadarMobileMenuId}
      ref={menuRef}
    >
      <nav
        aria-label="Mobile menu"
        className={styles.mobileMenuList}
        role="menu"
      >
        {stockRadarMobileNavigationItems.map((item) => {
          const className = item.key === "premium" ? styles.mobileMenuPremium : undefined;
          const content = <span>{item.label}</span>;

          return (
            <a
              aria-current={item.key === activeItem ? "page" : undefined}
              className={className}
              href={item.href}
              key={item.key}
              onClick={() => onItemActivate(item)}
              role="menuitem"
            >
              {content}
            </a>
          );
        })}
      </nav>
      {showThemeToggle ? (
        <div className={styles.mobileMenuTheme}>
          <span>Theme</span>
          <StockRadarThemeToggle />
        </div>
      ) : null}
      <div className={styles.mobileMenuAccount}>
        <AuthStatus accountMenu loginHref={loginHref} signupHref={signupHref} />
      </div>
    </div>
  );
}
