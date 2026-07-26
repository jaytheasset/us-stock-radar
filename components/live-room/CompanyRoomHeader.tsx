"use client";

import {
  Bell,
  BellOff,
  Check,
  Copy,
  History,
} from "lucide-react";
import type { RefObject } from "react";
import type { CompanyRoomIdentity } from "@/lib/live-room/types";
import styles from "./LiveRoom.module.css";

type CompanyRoomHeaderProps = {
  copyState: "copied" | "error" | "idle";
  followed: boolean;
  historyButtonRef: RefObject<HTMLButtonElement | null>;
  identity: CompanyRoomIdentity;
  onCopyInvite: () => void;
  onOpenHistory: () => void;
  onToggleFollow: () => void;
};

export function CompanyRoomHeader({
  copyState,
  followed,
  historyButtonRef,
  identity,
  onCopyInvite,
  onOpenHistory,
  onToggleFollow,
}: CompanyRoomHeaderProps) {
  return (
    <header className={styles.roomHeader}>
      <div className={styles.roomIdentity}>
        <span className={styles.roomEyebrow}>Company Live Room</span>
        <div className={styles.roomTitleLine}>
          <strong>{identity.ticker}</strong>
          <h1>{identity.companyName}</h1>
        </div>
        <small>{identity.exchange} · Company room · {identity.ticker}</small>
      </div>

      <div className={styles.roomActions}>
        <button
          aria-pressed={followed}
          className={followed ? styles.followingButton : undefined}
          onClick={onToggleFollow}
          type="button"
        >
          {followed ? (
            <BellOff aria-hidden="true" size={15} />
          ) : (
            <Bell aria-hidden="true" size={15} />
          )}
          {followed ? "Following" : "Follow"}
        </button>
        <button onClick={onCopyInvite} type="button">
          {copyState === "copied" ? (
            <Check aria-hidden="true" size={15} />
          ) : (
            <Copy aria-hidden="true" size={15} />
          )}
          {copyState === "copied"
            ? "Copied"
            : copyState === "error"
              ? "Copy failed"
              : "Invite"}
        </button>
        <button
          aria-controls="live-room-history-sheet"
          className={styles.historyTrigger}
          onClick={onOpenHistory}
          ref={historyButtonRef}
          type="button"
        >
          <History aria-hidden="true" size={15} />
          Past events
        </button>
      </div>
    </header>
  );
}
