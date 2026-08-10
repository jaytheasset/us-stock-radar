"use client";

import { PanelRightOpen } from "lucide-react";
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
  infoButtonRef: RefObject<HTMLButtonElement | null>;
  infoOpen: boolean;
  identity: CompanyRoomIdentity;
  isGuest: boolean;
  loginHref: string;
  joiningDisabled?: boolean;
  membershipBusy: boolean;
  membershipJoined: boolean | null;
  onJoin: () => Promise<void>;
  onLeave: () => Promise<void>;
  onOpenInfo: () => void;
  quote: StockOverviewQuote;
  roomCounts: LiveRoomPublicRoomCounts | null;
};

export function CompanyRoomHeader({
  infoButtonRef,
  infoOpen,
  identity,
  isGuest,
  loginHref,
  joiningDisabled = false,
  membershipBusy,
  membershipJoined,
  onJoin,
  onLeave,
  onOpenInfo,
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
        <h1 className={styles.roomTitleLine}>
          <strong className={styles.roomTicker}>{identity.ticker}</strong>
          {identity.companyName.trim().toUpperCase() !== identity.ticker ? (
            <span className={styles.roomCompanyName}>
              {identity.companyName}
            </span>
          ) : null}
          <span className={styles.roomLabel}>Live Room</span>
        </h1>
        <div className={styles.roomMeta}>
          <small>{identity.exchange}</small>
          {roomCounts ? (
            <small className={styles.roomCounts}>
              <span aria-hidden="true">·</span>
              <strong>{formatMemberCount(roomCounts.memberCount)}</strong>
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
          aria-controls="live-room-info-drawer"
          aria-expanded={infoOpen}
          aria-label="Open Live Room information"
          className={styles.infoDrawerTrigger}
          onClick={onOpenInfo}
          ref={infoButtonRef}
          type="button"
        >
          <PanelRightOpen aria-hidden="true" size={15} />
          <span className={styles.actionLabel}>Room info</span>
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

function formatMemberCount(memberCount: number) {
  return `${memberCount} ${memberCount === 1 ? "member" : "members"}`;
}

function formatQuotePercent(value: number | null) {
  if (value === null) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}
