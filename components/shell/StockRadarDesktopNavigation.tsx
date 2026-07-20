import {
  stockRadarPrimaryNavigationItems,
  type StockRadarPrimaryNavigationKey,
} from "@/components/shell/stockRadarNavigation";
import styles from "./StockRadarProductHeader.module.css";

export type StockRadarDesktopNavigationProps = {
  activeItem: StockRadarPrimaryNavigationKey;
};

export function StockRadarDesktopNavigation({
  activeItem,
}: StockRadarDesktopNavigationProps) {
  return (
    <nav aria-label="Primary navigation" className={styles.primaryNavigation}>
      {stockRadarPrimaryNavigationItems.map((item) => (
        <a
          aria-current={item.key === activeItem ? "page" : undefined}
          className={"premium" in item && item.premium ? styles.navigationPremium : undefined}
          href={item.href}
          key={item.key}
        >
          {item.label}
        </a>
      ))}
    </nav>
  );
}
