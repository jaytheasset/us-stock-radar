"use client";

import {
  useRef,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import styles from "./Posts.module.css";

export type LiveRoomTab =
  | "about"
  | "chat"
  | "events"
  | "members"
  | "posts"
  | "rooms";

export type CompanyLiveRoomTab = "chat" | "events" | "posts";

type RoomTabsVisibility = "all" | "desktop" | "mobile";

export function RoomTabs<T extends LiveRoomTab>({
  active,
  attached = false,
  dockInMobileSheet = false,
  dockOnMobile = false,
  idPrefix = "live-room",
  items,
  onChange,
  onItemElementChange,
  visibility = "all",
}: {
  active: T;
  attached?: boolean;
  dockInMobileSheet?: boolean;
  dockOnMobile?: boolean;
  idPrefix?: string;
  items: ReadonlyArray<{
    controlsId?: string;
    label: string;
    value: T;
  }>;
  onChange: (tab: T) => void;
  onItemElementChange?: (
    tab: T,
    element: HTMLButtonElement | null,
  ) => void;
  visibility?: RoomTabsVisibility;
}) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const handleKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % items.length;
    if (event.key === "ArrowLeft") {
      nextIndex = (index - 1 + items.length) % items.length;
    }
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = items.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const nextItem = items[nextIndex];
    if (!nextItem) return;
    onChange(nextItem.value);
    tabRefs.current[nextIndex]?.focus();
  };

  return (
    <div
      aria-label="Live Room sections"
      className={[
        styles.tabs,
        attached ? styles.attachedTabs : null,
        dockOnMobile ? styles.mobileDock : null,
        dockInMobileSheet ? styles.mobileSheetDock : null,
        visibility === "desktop" ? styles.desktopOnlyTabs : null,
        visibility === "mobile" ? styles.mobileOnlyTabs : null,
      ]
        .filter(Boolean)
        .join(" ")}
      role="tablist"
      style={
        {
          "--live-room-mobile-tab-count": items.length,
        } as CSSProperties
      }
    >
      {items.map((item, index) => (
        <button
          aria-controls={
            item.controlsId ?? `live-room-${item.value}-panel`
          }
          aria-selected={active === item.value}
          className={active === item.value ? styles.activeTab : undefined}
          id={`${idPrefix}-${item.value}-tab`}
          key={item.value}
          onClick={() => onChange(item.value)}
          onKeyDown={(event) => handleKeyDown(event, index)}
          ref={(element) => {
            tabRefs.current[index] = element;
            onItemElementChange?.(item.value, element);
          }}
          role="tab"
          tabIndex={active === item.value ? 0 : -1}
          type="button"
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
