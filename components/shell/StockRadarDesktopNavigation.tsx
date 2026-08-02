"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import {
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import { getVisibleNavigationItemCount } from "@/components/shell/desktopNavigationLayout";
import {
  stockRadarPrimaryNavigationItems,
  type StockRadarLinkNavigationItem,
  type StockRadarPrimaryNavigationKey,
} from "@/components/shell/stockRadarNavigation";
import styles from "./StockRadarProductHeader.module.css";

const coreNavigationItems: readonly StockRadarLinkNavigationItem[] =
  stockRadarPrimaryNavigationItems.filter((item) => !("premium" in item));
const supplementaryNavigationItems: readonly StockRadarLinkNavigationItem[] =
  stockRadarPrimaryNavigationItems.filter(
    (item) => "premium" in item && item.premium,
  );

export type StockRadarDesktopNavigationProps = {
  activeItem: StockRadarPrimaryNavigationKey | null;
  actionsRef: RefObject<HTMLDivElement | null>;
  headerRef: RefObject<HTMLElement | null>;
};

export function StockRadarDesktopNavigation({
  activeItem,
  actionsRef,
  headerRef,
}: StockRadarDesktopNavigationProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [visibleItemCount, setVisibleItemCount] = useState(3);
  const navigationRef = useRef<HTMLElement>(null);
  const measurementItemRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const directNavigationItems = coreNavigationItems.slice(0, visibleItemCount);
  const moreNavigationItems = [
    ...coreNavigationItems.slice(visibleItemCount),
    ...supplementaryNavigationItems,
  ];
  const moreIsCurrent = moreNavigationItems.some(
    (item) => item.key === activeItem,
  );

  // The actions element is a later sibling in the parent header, so measure only
  // after the full commit has attached every sibling ref.
  useEffect(() => {
    const navigation = navigationRef.current;
    const actions = actionsRef.current;
    const header = headerRef.current;
    const moreButton = moreButtonRef.current;
    if (!navigation || !actions || !header || !moreButton) return;

    let animationFrame = 0;
    let disposed = false;
    const measure = () => {
      if (disposed) return;
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(() => {
        if (disposed) return;
        const navigationRect = navigation.getBoundingClientRect();
        const actionsRect = actions.getBoundingClientRect();
        const headerStyle = window.getComputedStyle(header);
        const navigationStyle = window.getComputedStyle(navigation);
        const headerGap = Number.parseFloat(headerStyle.columnGap) || 0;
        const navigationGap = Number.parseFloat(navigationStyle.columnGap) || 0;
        const availableWidth = Math.max(
          0,
          Math.min(
            navigationRect.width,
            actionsRect.left - navigationRect.left - headerGap,
          ),
        );
        const itemWidths = measurementItemRefs.current.map(
          (item) => item?.getBoundingClientRect().width ?? 0,
        );
        const nextVisibleItemCount = getVisibleNavigationItemCount({
          availableWidth,
          gap: navigationGap,
          itemWidths,
          moreButtonWidth: moreButton.getBoundingClientRect().width,
        });

        setVisibleItemCount((current) =>
          current === nextVisibleItemCount ? current : nextVisibleItemCount,
        );
      });
    };

    measure();
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(header);
    resizeObserver.observe(navigation);
    resizeObserver.observe(actions);
    window.addEventListener("resize", measure);
    void document.fonts?.ready.then(measure);

    return () => {
      disposed = true;
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [actionsRef, headerRef]);

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
    <nav
      aria-label="Primary navigation"
      className={styles.primaryNavigation}
      ref={navigationRef}
    >
      {directNavigationItems.map((item) => (
        <NavigationLink activeItem={activeItem} item={item} key={item.key} />
      ))}
      <div aria-hidden="true" className={styles.navigationMeasurement}>
        {coreNavigationItems.map((item, index) => (
          <span
            className={styles.navigationMeasurementItem}
            key={item.key}
            ref={(element) => {
              measurementItemRefs.current[index] = element;
            }}
          >
            {item.label}
          </span>
        ))}
      </div>
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
