"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  stockRadarDirectNavigationKeys,
  stockRadarPrimaryNavigationItems,
  type StockRadarLinkNavigationItem,
  type StockRadarPrimaryNavigationKey,
} from "@/components/shell/stockRadarNavigation";
import styles from "./StockRadarProductHeader.module.css";

const directNavigationItems: readonly StockRadarLinkNavigationItem[] =
  stockRadarPrimaryNavigationItems.filter((item) =>
    stockRadarDirectNavigationKeys.has(item.key),
  );
const moreNavigationItems: readonly StockRadarLinkNavigationItem[] =
  stockRadarPrimaryNavigationItems.filter(
    (item) => !stockRadarDirectNavigationKeys.has(item.key),
  );

export type StockRadarDesktopNavigationProps = {
  activeItem: StockRadarPrimaryNavigationKey | null;
};

export function StockRadarDesktopNavigation({
  activeItem,
}: StockRadarDesktopNavigationProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const moreIsCurrent = moreNavigationItems.some(
    (item) => item.key === activeItem,
  );

  useEffect(() => {
    if (!moreOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        moreButtonRef.current?.contains(target) ||
        moreMenuRef.current?.contains(target)
      ) {
        return;
      }
      setMoreOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setMoreOpen(false);
      requestAnimationFrame(() => moreButtonRef.current?.focus());
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [moreOpen]);

  const openMoreMenu = () => {
    setMoreOpen(true);
    requestAnimationFrame(() => {
      moreMenuRef.current
        ?.querySelector<HTMLElement>('[role="menuitem"]')
        ?.focus();
    });
  };

  return (
    <nav aria-label="Primary navigation" className={styles.primaryNavigation}>
      {directNavigationItems.map((item) => (
        <NavigationLink activeItem={activeItem} item={item} key={item.key} />
      ))}
      {moreNavigationItems.map((item) => (
        <NavigationLink
          activeItem={activeItem}
          className={styles.navigationSecondary}
          item={item}
          key={item.key}
        />
      ))}
      <div className={styles.moreNavigation}>
        <button
          aria-current={moreIsCurrent ? "page" : undefined}
          aria-expanded={moreOpen}
          aria-haspopup="menu"
          className={styles.moreNavigationButton}
          onClick={() => (moreOpen ? setMoreOpen(false) : openMoreMenu())}
          ref={moreButtonRef}
          type="button"
        >
          More
          <ChevronDown aria-hidden="true" size={14} />
        </button>
        {moreOpen ? (
          <div
            aria-label="More navigation"
            className={styles.moreNavigationMenu}
            ref={moreMenuRef}
            role="menu"
          >
            {moreNavigationItems.map((item) => (
              <Link
                aria-current={item.key === activeItem ? "page" : undefined}
                className={
                  item.premium ? styles.moreNavigationPremium : undefined
                }
                href={item.href}
                key={item.key}
                onClick={() => setMoreOpen(false)}
                role="menuitem"
              >
                {item.label}
              </Link>
            ))}
          </div>
        ) : null}
      </div>
    </nav>
  );
}

function NavigationLink({
  activeItem,
  className,
  item,
}: {
  activeItem: StockRadarPrimaryNavigationKey | null;
  className?: string;
  item: StockRadarLinkNavigationItem;
}) {
  const classes = [
    className,
    item.premium ? styles.navigationPremium : undefined,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Link
      aria-current={item.key === activeItem ? "page" : undefined}
      className={classes || undefined}
      href={item.href}
    >
      {item.label}
    </Link>
  );
}
