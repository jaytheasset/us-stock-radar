"use client";

import {
  Bookmark,
  BookmarkCheck,
  Check,
  History,
  LoaderCircle,
  Share2,
} from "lucide-react";
import type { RefObject } from "react";
import type { LiveRoomInviteUiState } from "@/lib/live-room/inviteShare";
import type { CompanyRoomIdentity } from "@/lib/live-room/types";
import styles from "./LiveRoom.module.css";

type CompanyRoomHeaderProps = {
  followed: boolean | null;
  historyButtonRef: RefObject<HTMLButtonElement | null>;
  identity: CompanyRoomIdentity;
  inviteState: LiveRoomInviteUiState;
  onlineMemberCount: number | null;
  onInvite: () => void;
  onOpenHistory: () => void;
  onToggleFollow: () => void;
};

export function CompanyRoomHeader({
  followed,
  historyButtonRef,
  identity,
  inviteState,
  onlineMemberCount,
  onInvite,
  onOpenHistory,
  onToggleFollow,
}: CompanyRoomHeaderProps) {
  return (
    <header className={styles.roomHeader}>
      <div className={styles.roomIdentity}>
        <span className={styles.roomEyebrow}>Company Live Room</span>
        <div className={styles.roomTitleLine}>
          <strong>{identity.ticker}</strong>
          {identity.companyName.trim().toUpperCase() !== identity.ticker ? (
            <h1>{identity.companyName}</h1>
          ) : null}
        </div>
        <small>{identity.exchange} · Company room</small>
        {onlineMemberCount !== null && onlineMemberCount > 0 ? (
          <small className={styles.onlineCount}>
            <span aria-hidden="true" />
            {onlineMemberCount} online
          </small>
        ) : null}
      </div>

      <div className={styles.roomActions}>
        <button
          aria-label={
            followed === null
              ? "Loading room follow status"
              : followed
                ? "Unfollow company room"
                : "Follow company room"
          }
          aria-pressed={followed ?? undefined}
          className={followed ? styles.followingButton : undefined}
          disabled={followed === null}
          onClick={onToggleFollow}
          type="button"
        >
          {followed === null ? (
            <LoaderCircle aria-hidden="true" size={15} />
          ) : followed ? (
            <BookmarkCheck aria-hidden="true" size={15} />
          ) : (
            <Bookmark aria-hidden="true" size={15} />
          )}
          <span className={styles.actionLabel}>
            {followed === null
              ? "Loading…"
              : followed
                ? "Following"
                : "Follow"}
          </span>
        </button>
        <button
          aria-label="Invite people to this company room"
          disabled={inviteState === "working"}
          onClick={onInvite}
          type="button"
        >
          {inviteState === "copied" || inviteState === "shared" ? (
            <Check aria-hidden="true" size={15} />
          ) : (
            <Share2 aria-hidden="true" size={15} />
          )}
          <span aria-live="polite" className={styles.actionLabel}>
            {inviteState === "copied"
              ? "Copied"
              : inviteState === "shared"
                ? "Shared"
                : inviteState === "error"
                  ? "Share failed"
                  : inviteState === "working"
                    ? "Sharing…"
                    : "Invite"}
          </span>
        </button>
        <button
          aria-controls="live-room-history-sheet"
          aria-label="Open past company events"
          className={styles.historyTrigger}
          onClick={onOpenHistory}
          ref={historyButtonRef}
          type="button"
        >
          <History aria-hidden="true" size={15} />
          <span className={styles.actionLabel}>Past events</span>
        </button>
      </div>
    </header>
  );
}
