"use client";

import {
  Bookmark,
  Check,
  History,
  LoaderCircle,
  Share2,
} from "lucide-react";
import type { RefObject } from "react";
import type { LiveRoomInviteUiState } from "@/lib/live-room/inviteShare";
import type {
  CompanyRoomIdentity,
  LiveRoomPublicRoomCounts,
} from "@/lib/live-room/types";
import type { StockOverviewQuote } from "@/lib/watchlist/stockOverview";
import styles from "./LiveRoom.module.css";

type CompanyRoomHeaderProps = {
  followed: boolean | null;
  historyButtonRef: RefObject<HTMLButtonElement | null>;
  identity: CompanyRoomIdentity;
  inviteState: LiveRoomInviteUiState;
  onInvite: () => void;
  onOpenHistory: () => void;
  onToggleFollow: () => void;
  quote: StockOverviewQuote;
  roomCounts: LiveRoomPublicRoomCounts | null;
};

export function CompanyRoomHeader({
  followed,
  historyButtonRef,
  identity,
  inviteState,
  onInvite,
  onOpenHistory,
  onToggleFollow,
  quote,
  roomCounts,
}: CompanyRoomHeaderProps) {
  const quoteTone =
    quote.changePercent === null || quote.changePercent === 0
      ? "muted"
      : quote.changePercent > 0
        ? "positive"
        : "negative";

  return (
    <header className={styles.roomHeader}>
      <div className={styles.roomIdentity}>
        <div className={styles.roomTitleLine}>
          <h1>{identity.ticker} Live Room</h1>
          {identity.companyName.trim().toUpperCase() !== identity.ticker ? (
            <strong className={styles.roomCompanyName}>
              {identity.companyName}
            </strong>
          ) : null}
        </div>
        <div className={styles.roomMeta}>
          <small>{identity.exchange}</small>
          {roomCounts ? (
            <small className={styles.roomCounts}>
              <strong>
                {roomCounts.participantCount} participants
              </strong>
              <span aria-hidden="true">·</span>
              <span className={styles.onlineCount}>
                <i aria-hidden="true" />
                {roomCounts.onlineCount} online
              </span>
            </small>
          ) : null}
        </div>
      </div>

      <div
        aria-label={`${identity.ticker} quote`}
        className={styles.marketSummary}
      >
        <div className={styles.marketSummaryValues}>
          <strong>{formatQuotePrice(quote.price)}</strong>
          <b data-tone={quoteTone}>
            {formatQuotePercent(quote.changePercent)}
          </b>
        </div>
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

function formatQuotePrice(value: number | null) {
  if (value === null) return "—";
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: "currency",
  }).format(value);
}

function formatQuotePercent(value: number | null) {
  if (value === null) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}
