"use client";

import { type RefObject } from "react";
import { Bell, BellOff, Bookmark, BookmarkCheck, ExternalLink } from "lucide-react";
import Link from "next/link";
import { CalendarEventTypeBadge } from "@/components/calendar-v1/CalendarEventTypeBadge";
import { LiveRoomEntryButton } from "@/components/live-room/LiveRoomEntryButton";
import { BottomSheetShell } from "@/components/ui/BottomSheetShell";
import { DetailPanelShell } from "@/components/ui/DetailPanelShell";
import { parseDateOnly } from "@/lib/calendar-v1/dateUtils";
import {
  eventStatusLabels,
  marketSessionLabels,
  type CalendarEvent,
} from "@/lib/calendar-v1/model";
import { getStockRouteHref } from "@/lib/watchlist/stockOverview";
import styles from "./CalendarV1.module.css";

type CalendarEventDetailProps = {
  desktopEvent: CalendarEvent | null;
  followedEvents: Readonly<Record<string, boolean>>;
  onFollowToggle: (event: CalendarEvent) => void;
  onSheetDismiss: () => void;
  onWatchlistToggle: (event: CalendarEvent) => void;
  openerRef: RefObject<HTMLElement | null>;
  sheetEvent: CalendarEvent | null;
  watchlistOverrides: Readonly<Record<string, boolean>>;
};

export function CalendarEventDetail({
  desktopEvent,
  followedEvents,
  onFollowToggle,
  onSheetDismiss,
  onWatchlistToggle,
  openerRef,
  sheetEvent,
  watchlistOverrides,
}: CalendarEventDetailProps) {
  const desktopTitleId = desktopEvent
    ? `calendar-desktop-detail-title-${desktopEvent.id}`
    : "calendar-desktop-detail-title";
  const mobileTitleId = sheetEvent
    ? `calendar-mobile-detail-title-${sheetEvent.id}`
    : "calendar-mobile-detail-title";

  return (
    <>
      {desktopEvent ? (
        <DetailPanelShell
          aria-labelledby={desktopTitleId}
          className={styles.desktopDetailPanel}
        >
          <CalendarEventDetailContent
            event={desktopEvent}
            followed={Boolean(followedEvents[desktopEvent.id])}
            onFollowToggle={() => onFollowToggle(desktopEvent)}
            onWatchlistToggle={() => onWatchlistToggle(desktopEvent)}
            titleId={desktopTitleId}
            watchlisted={
              watchlistOverrides[desktopEvent.id] ??
              desktopEvent.isWatchlisted
            }
          />
        </DetailPanelShell>
      ) : null}
      <BottomSheetShell
        aria-labelledby={mobileTitleId}
        closeLabel="Close event detail"
        isOpen={Boolean(sheetEvent)}
        layout="full-scroll"
        onDismiss={onSheetDismiss}
        openerRef={openerRef}
        overlayLabel="Dismiss event detail"
        viewport="tablet"
      >
        {sheetEvent ? (
          <div className={styles.mobileDetailContent}>
            <CalendarEventDetailContent
              event={sheetEvent}
              followed={Boolean(followedEvents[sheetEvent.id])}
              onFollowToggle={() => onFollowToggle(sheetEvent)}
              onWatchlistToggle={() => onWatchlistToggle(sheetEvent)}
              titleId={mobileTitleId}
              watchlisted={
                watchlistOverrides[sheetEvent.id] ??
                sheetEvent.isWatchlisted
              }
            />
          </div>
        ) : null}
      </BottomSheetShell>
    </>
  );
}

function CalendarEventDetailContent({
  event,
  followed,
  onFollowToggle,
  onWatchlistToggle,
  titleId,
  watchlisted,
}: {
  event: CalendarEvent;
  followed: boolean;
  onFollowToggle: () => void;
  onWatchlistToggle: () => void;
  titleId: string;
  watchlisted: boolean;
}) {
  const stockHref = getStockRouteHref(event.ticker);
  const eventDate = parseDateOnly(event.eventDate);

  return (
    <div className={styles.detailContent}>
      <header className={styles.detailHeader}>
        <CalendarEventTypeBadge eventType={event.eventType} size="small" />
        <div>
          <strong>{event.ticker ?? "TBA"}</strong>
          <b data-status={event.status}>{eventStatusLabels[event.status]}</b>
        </div>
        <h2 id={titleId}>{event.title}</h2>
        <p>{event.companyName}</p>
      </header>

      <dl className={styles.detailSummary}>
        <DetailValue
          label="Date"
          value={eventDate.toLocaleDateString("en-US", {
            weekday: "short",
            month: "long",
            day: "numeric",
            year: "numeric",
          })}
        />
        <DetailValue label="Session" value={marketSessionLabels[event.marketSession]} />
        <DetailValue label="Time" value={formatTime(event.eventTime)} />
        <DetailValue label="Status" value={eventStatusLabels[event.status]} />
      </dl>

      <section className={styles.detailSection}>
        <h3>Event data</h3>
        <dl>{renderEventDetails(event)}</dl>
      </section>

      <section className={styles.detailSection}>
        <h3>Data provenance</h3>
        <dl>
          <DetailValue label="Source" value={event.source} />
          <DetailValue label="Updated" value={formatUpdatedAt(event.lastUpdatedAt)} />
        </dl>
      </section>

      <div className={styles.detailToggles}>
        <button aria-pressed={watchlisted} onClick={onWatchlistToggle} type="button">
          {watchlisted ? <BookmarkCheck aria-hidden="true" size={16} /> : <Bookmark aria-hidden="true" size={16} />}
          {watchlisted ? "Watching" : "Add to Watchlist"}
        </button>
        <button aria-pressed={followed} onClick={onFollowToggle} type="button">
          {followed ? <BellOff aria-hidden="true" size={16} /> : <Bell aria-hidden="true" size={16} />}
          {followed ? "Unfollow Event" : "Follow Event"}
        </button>
      </div>

      <div className={styles.detailLinks}>
        {stockHref ? (
          <Link href={stockHref}>
            Stock overview
            <ExternalLink aria-hidden="true" size={14} />
          </Link>
        ) : (
          <span aria-disabled="true">Stock overview unavailable</span>
        )}
        <LiveRoomEntryButton
          event={{
            id: event.id,
            source: event.source,
            title: event.title,
            type: event.eventType,
          }}
          issuer={event.companyName}
          ticker={event.ticker ?? undefined}
        />
      </div>
      <p className={styles.mockNotice}>Watchlist and follow changes are local mock state for this preview.</p>
    </div>
  );
}

function renderEventDetails(event: CalendarEvent) {
  if (event.eventType === "earnings") {
    return (
      <>
        <DetailValue label="Fiscal quarter" value={event.details.fiscalQuarter} />
        <DetailValue label="EPS estimate" value={formatNumber(event.details.epsEstimate)} />
        <DetailValue label="Revenue estimate" value={formatMoney(event.details.revenueEstimate)} />
        <DetailValue label="Actual EPS" value={formatNumber(event.details.actualEps)} />
        <DetailValue label="Actual revenue" value={formatMoney(event.details.actualRevenue)} />
        <DetailValue label="Result" value={event.details.outcome ? titleCase(event.details.outcome) : null} />
      </>
    );
  }

  if (event.eventType === "dividend") {
    return (
      <>
        <DetailValue
          label="Dividend / share"
          value={
            event.details.dividendPerShare === null
              ? null
              : `${event.details.currency ?? "—"} ${event.details.dividendPerShare.toFixed(2)}`
          }
        />
        <DetailValue label="Ex-dividend date" value={formatDetailDate(event.details.exDividendDate)} />
        <DetailValue label="Record date" value={formatDetailDate(event.details.recordDate)} />
        <DetailValue label="Payment date" value={formatDetailDate(event.details.paymentDate)} />
        <DetailValue label="Frequency" value={event.details.frequency} />
      </>
    );
  }

  if (event.eventType === "split") {
    return (
      <>
        <DetailValue label="Split ratio" value={event.details.ratio} />
        <DetailValue label="Split type" value={`${titleCase(event.details.splitKind)} split`} />
        <DetailValue label="Effective date" value={formatDetailDate(event.details.effectiveDate)} />
        <DetailValue label="Related ticker" value={event.details.relatedTicker} />
      </>
    );
  }

  return (
    <>
      <DetailValue label="Exchange" value={event.details.exchange} />
      <DetailValue
        label="Expected price range"
        value={
          event.details.priceRangeLow === null || event.details.priceRangeHigh === null
            ? null
            : `$${event.details.priceRangeLow.toFixed(2)} – $${event.details.priceRangeHigh.toFixed(2)}`
        }
      />
      <DetailValue
        label="Offer price"
        value={event.details.offerPrice === null ? null : `$${event.details.offerPrice.toFixed(2)}`}
      />
      <DetailValue label="Raise size" value={formatMoney(event.details.raiseAmount)} />
      <DetailValue label="IPO stage" value={titleCase(event.details.ipoStage)} />
    </>
  );
}

function DetailValue({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd data-missing={!value}>{value || "Not announced"}</dd>
    </div>
  );
}

function formatDetailDate(value: string | null) {
  if (!value) return null;
  return parseDateOnly(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTime(value: string | null) {
  if (!value) return null;
  const [hour, minute] = value.split(":").map(Number);
  const date = new Date(2000, 0, 1, hour, minute);
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function formatUpdatedAt(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Not available"
    : date.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
}

function formatNumber(value: number | null) {
  return value === null ? null : value.toFixed(2);
}

function formatMoney(value: number | null) {
  if (value === null) return null;
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 1,
    notation: "compact",
    style: "currency",
  }).format(value);
}

function titleCase(value: string) {
  return value
    .split("-")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
