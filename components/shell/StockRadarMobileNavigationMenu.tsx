import type { Ref } from "react";
import {
  stockRadarMobileNavigationItems,
  type StockRadarNavigationItem,
  type StockRadarPrimaryNavigationKey,
} from "@/components/shell/stockRadarNavigation";
import styles from "./StockRadarProductHeader.module.css";

export const stockRadarMobileMenuId = "stock-radar-mobile-navigation-menu";

export type StockRadarMobileNavigationMenuProps = {
  activeItem: StockRadarPrimaryNavigationKey;
  menuRef: Ref<HTMLDivElement>;
  onItemActivate: (item: StockRadarNavigationItem) => void;
};

export function StockRadarMobileNavigationMenu({
  activeItem,
  menuRef,
  onItemActivate,
}: StockRadarMobileNavigationMenuProps) {
  return (
    <div
      className={styles.mobileMenuPopover}
      id={stockRadarMobileMenuId}
      ref={menuRef}
      role="menu"
    >
      <nav aria-label="Mobile menu" className={styles.mobileMenuList}>
        {stockRadarMobileNavigationItems.map((item) => {
          const className = item.key === "premium" ? styles.mobileMenuPremium : undefined;
          const content = <span>{item.label}</span>;

          if (item.kind === "action") {
            return (
              <button
                className={className}
                key={item.key}
                onClick={() => onItemActivate(item)}
                role="menuitem"
                type="button"
              >
                {content}
              </button>
            );
          }

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
    </div>
  );
}
