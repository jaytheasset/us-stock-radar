"use client";

import { History } from "lucide-react";
import type { RefObject } from "react";
import type {
  CompanyRoomIdentity,
  LiveRoomPublicRoomCounts,
} from "@/lib/live-room/types";
import type { StockOverviewQuote } from "@/lib/watchlist/stockOverview";
import { LiveRoomInviteMenu } from "./LiveRoomInviteMenu";
import { RoomMembershipControl } from "./RoomMembershipControl";
import styles from "./LiveRoom.module.css";

type CompanyRoomHeaderProps = {
  historyButtonRef: RefObject<HTMLButtonElement | null>;
  identity: CompanyRoomIdentity;
  isGuest: boolean;
  loginHref: string;
  joiningDisabled?: boolean;
  membershipBusy: boolean;
  membershipJoined: boolean | null;
  onJoin: () => Promise<void>;
  onLeave: () => Promise<void>;
  onOpenHistory: () => void;
  quote: StockOverviewQuote;
  roomCounts: LiveRoomPublicRoomCounts | null;
};

export function CompanyRoomHeader({
  historyButtonRef,
  identity,
  isGuest,
  loginHref,
  joiningDisabled = false,
  membershipBusy,
  membershipJoined,
  onJoin,
  onLeave,
  onOpenHistory,
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
          <div className={styles.roomTitlePrimary}>
            <h1 className={styles.desktopRoomTitle}>
              {identity.ticker} Live Room
            </h1>
            <h1 className={styles.mobileRoomTitle}>
              {identity.companyName}
            </h1>
            <small className={styles.mobileTicker}>{identity.ticker}</small>
            <small className={styles.mobileExchange}>
              {identity.exchange}
            </small>
          </div>
          {identity.companyName.trim().toUpperCase() !== identity.ticker ? (
            <strong className={styles.roomCompanyName}>
              {identity.companyName}
            </strong>
          ) : null}
        </div>
        <div className={styles.roomMeta}>
          <small className={styles.desktopExchange}>
            {identity.exchange}
          </small>
          {roomCounts ? (
            <>
              <small
                className={`${styles.roomCounts} ${styles.desktopRoomCounts}`}
              >
                <strong>{roomCounts.memberCount} members</strong>
                {roomCounts.visitorCount > 0 ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{roomCounts.visitorCount} visitors</span>
                  </>
                ) : null}
                <span aria-hidden="true">·</span>
                <span className={styles.onlineCount}>
                  <i aria-hidden="true" />
                  {roomCounts.onlineCount} online
                </span>
              </small>
              <small
                className={`${styles.roomCounts} ${styles.mobileRoomCounts}`}
              >
                <strong>
                  {roomCounts.memberCount} members
                </strong>
                <span aria-hidden="true">·</span>
                <span className={styles.onlineCount}>
                  <i aria-hidden="true" />
                  {roomCounts.onlineCount} online
                </span>
              </small>
            </>
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
        <RoomMembershipControl
          busy={membershipBusy}
          isGuest={isGuest}
          joined={membershipJoined}
          joiningDisabled={joiningDisabled}
          loginHref={loginHref}
          onJoin={onJoin}
          onLeave={onLeave}
          roomLabel={`${identity.ticker} Live Room`}
        />
        <LiveRoomInviteMenu
          ariaLabel="Invite people to this company room"
          room={{ identity, kind: "company" }}
        />
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
