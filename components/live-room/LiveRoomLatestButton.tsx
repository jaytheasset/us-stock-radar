"use client";

import { ChevronDown } from "lucide-react";
import styles from "./LiveRoom.module.css";

export function LiveRoomLatestButton({
  busy,
  onClick,
  unreadCount,
}: {
  busy: boolean;
  onClick: () => void;
  unreadCount: number;
}) {
  const unreadLabel =
    unreadCount > 0 ? `, ${unreadCount} unread messages` : "";
  return (
    <button
      aria-label={`Go to latest messages${unreadLabel}`}
      className={styles.latestMessagesButton}
      disabled={busy}
      onClick={onClick}
      type="button"
    >
      <ChevronDown aria-hidden="true" size={18} />
      {unreadCount > 0 ? (
        <b
          aria-hidden="true"
          className={styles.latestMessagesBadge}
        >
          {unreadCount > 99 ? "99+" : unreadCount}
        </b>
      ) : null}
    </button>
  );
}
