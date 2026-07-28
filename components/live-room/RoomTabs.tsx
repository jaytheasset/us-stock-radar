"use client";

import { useRef, type KeyboardEvent } from "react";
import styles from "./Posts.module.css";

export type LiveRoomTab = "about" | "chat" | "events" | "posts";

export function RoomTabs({
  active,
  dockOnMobile = false,
  items,
  onChange,
}: {
  active: LiveRoomTab;
  dockOnMobile?: boolean;
  items: Array<{ label: string; value: LiveRoomTab }>;
  onChange: (tab: LiveRoomTab) => void;
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
      className={`${styles.tabs}${dockOnMobile ? ` ${styles.mobileDock}` : ""}`}
      role="tablist"
    >
      {items.map((item, index) => (
        <button
          aria-controls={`live-room-${item.value}-panel`}
          aria-selected={active === item.value}
          className={active === item.value ? styles.activeTab : undefined}
          id={`live-room-${item.value}-tab`}
          key={item.value}
          onClick={() => onChange(item.value)}
          onKeyDown={(event) => handleKeyDown(event, index)}
          ref={(element) => {
            tabRefs.current[index] = element;
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
