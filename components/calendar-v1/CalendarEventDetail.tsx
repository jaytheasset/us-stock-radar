"use client";

import { type RefObject } from "react";
import { Bell, BellOff, Bookmark, BookmarkCheck, ExternalLink } from "lucide-react";
import Link from "next/link";
import { CalendarEventTypeBadge } from "@/components/calendar-v1/CalendarEventTypeBadge";
import { LiveRoomEntryButton } from "@/components/live-room/LiveRoomEntryButton";
import { BottomSheetShell } from "@/components/ui/BottomSheetShell";
import { AlertReliabilityNotice } from "@/components/ui/AlertReliabilityNotice";
import { DetailPanelShell } from "@/components/ui/DetailPanelShell";
import { parseDateOnly } from "@/lib/calendar-v1/dateUtils";
import {
  eventStatusLabels,
  impactLevelLabels,
  marketSessionLabels,
  type CalendarEvent,
  type CompanyCalendarEvent,
  type MacroCalendarEvent,
  type PolicyCalendarEvent,
} from "@/lib/calendar-v1/model";
import {
  formatCalendarEventTime,
  formatMacroMetricValue,
  getCalendarEventIdentity,
} from "@/lib/calendar-v1/presentation";
import { getStockRouteHref } from "@/lib/watchlist/stockOverview";
import styles from "./CalendarV1.module.css";

type CalendarEventDetailProps = {
  desktopEvent: CalendarEvent | null;
  followAction: string;
  followMessage: string;
  followedEvents: Readonly<Record<string, boolean>>;
  onFollowToggle: (event: CalendarEvent) => void;
  onSheetDismiss: () => void;
  onWatchlistToggle: (event: CalendarEvent) => void;
  openerRef: RefObject<HTMLElement | null>;
  sheetEvent: CalendarEvent | null;
  watchlistTickers: ReadonlySet<string>;
};

export function CalendarEventDetail({
  desktopEvent,
  followAction,
  followMessage,
  followedEvents,
  onFollowToggle,
  onSheetDismiss,
  onWatchlistToggle,
  openerRef,
  sheetEvent,
  watchlistTickers,
}: CalendarEventDetailProps) {
  const desktopTitleId = desktopEvent
    ? `calendar-desktop-detail-title-${desktopEvent.id}`
    : "calendar-desktop-detail-title";
  const mobileTitleId = sheetEvent
    ? `calendar-mobile-detail-title-${sheetEvent.id}`
    : "calendar-mobile-detail-title";

  const renderContent = (event: CalendarEvent, titleId: string) => {
    const ticker = getCalendarEventIdentity(event).primaryTicker;
    return (
      <CalendarEventDetailContent
        event={event}
        followBusy={followAction === event.id}
        followMessage={followMessage}
        followed={Boolean(followedEvents[event.id])}
        onFollowToggle={() => onFollowToggle(event)}
        onWatchlistToggle={() => onWatchlistToggle(event)}
        titleId={titleId}
        watchlisted={ticker ? watchlistTickers.has(ticker) : false}
      />
    );
  };

  return (
    <>
      {desktopEvent ? (
        <DetailPanelShell
          aria-labelledby={desktopTitleId}
          className={styles.desktopDetailPanel}
        >
          {renderContent(desktopEvent, desktopTitleId)}
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
            {renderContent(sheetEvent, mobileTitleId)}
          </div>
        ) : null}
      </BottomSheetShell>
    </>
  );
}

function CalendarEventDetailContent({
  event,
  followBusy,
  followMessage,
  followed,
  onFollowToggle,
  onWatchlistToggle,
  titleId,
  watchlisted,
}: {
  event: CalendarEvent;
  followBusy: boolean;
  followMessage: string;
  followed: boolean;
  onFollowToggle: () => void;
  onWatchlistToggle: () => void;
  titleId: string;
  watchlisted: boolean;
}) {
  const identity = getCalendarEventIdentity(event);
  const ticker = identity.primaryTicker;
  const stockHref = getStockRouteHref(ticker);
  const analysisHref = event.detailHref ?? null;
  const eventDate = parseDateOnly(event.eventDate);
  const watchLabel = watchlisted ? `Watching ${ticker}` : "Watch Stock";
  const watchActionLabel = ticker
    ? watchlisted
      ? `Remove ${ticker} from Stock Radar Watchlist`
      : `Add ${ticker} to Stock Radar Watchlist`
    : "No ticker to watch";
  const followActionLabel = followed
    ? `Unfollow ${event.title} event`
    : `Follow ${event.title} event`;

  return (
    <div className={styles.detailContent}>
      <header className={styles.detailHeader}>
        <CalendarEventTypeBadge eventType={event.eventType} size="small" />
        <div>
          <strong>{identity.primaryLabel}</strong>
          <b data-status={event.status}>{eventStatusLabels[event.status]}</b>
        </div>
        <h2 id={titleId}>{event.title}</h2>
        <p>{identity.secondaryLabel}</p>
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
        <DetailValue label="Time" value={formatCalendarEventTime(event)} />
        <DetailValue label="Status" value={eventStatusLabels[event.status]} />
        <DetailValue label="Impact" value={impactLevelLabels[event.impactLevel]} />
        <DetailValue label="Scope" value={titleCase(event.impactScope)} />
      </dl>

      <section className={styles.detailSection}>
        <h3>Event data</h3>
        {renderEventDetails(event)}
      </section>

      <div className={styles.detailActions}>
        <div className={styles.detailAction}>
          <div>
            <strong>Stock watchlist</strong>
            <span>Track this ticker across Stock Radar.</span>
          </div>
          <button
            aria-label={watchActionLabel}
            aria-pressed={ticker ? watchlisted : undefined}
            disabled={!ticker}
            onClick={onWatchlistToggle}
            title={
              ticker
                ? watchActionLabel
                : "Watch Stock unavailable because this event has no ticker."
            }
            type="button"
          >
            {watchlisted ? (
              <BookmarkCheck aria-hidden="true" size={16} />
            ) : (
              <Bookmark aria-hidden="true" size={16} />
            )}
            {ticker ? watchLabel : "No ticker to watch"}
          </button>
        </div>
        <div className={styles.detailAction}>
          <div>
            <strong>Event alert</strong>
            <span>Follow this event&apos;s schedule and reminders.</span>
          </div>
          <button
            aria-label={followActionLabel}
            aria-pressed={followed}
            disabled={followBusy}
            onClick={onFollowToggle}
            title={
              followed
                ? "Stop following this event's schedule and reminders."
                : "Follow this event's schedule and reminders."
            }
            type="button"
          >
            {followed ? (
              <BellOff aria-hidden="true" size={16} />
            ) : (
              <Bell aria-hidden="true" size={16} />
            )}
            {followBusy ? "Saving..." : followed ? "Event Followed" : "Follow Event"}
          </button>
        </div>
      </div>

      <div className={styles.alertReliabilityNotice}>
        <AlertReliabilityNotice />
      </div>

      {analysisHref ? (
        <Link className={styles.analysisLink} href={analysisHref}>
          View analysis
          <ExternalLink aria-hidden="true" size={14} />
        </Link>
      ) : null}

      {ticker ? (
        <div className={styles.detailLinks}>
          <Link href={stockHref!}>
            Stock overview
            <ExternalLink aria-hidden="true" size={14} />
          </Link>
          <LiveRoomEntryButton
            event={{
              id: event.id,
              source: event.source,
              title: event.title,
              type: event.eventType,
            }}
            issuer={identity.secondaryLabel}
            ticker={ticker}
          />
        </div>
      ) : null}
      {followMessage ? (
        <p className={styles.mockNotice} role="status">{followMessage}</p>
      ) : (
        <p className={styles.mockNotice}>
          Event follows are saved to Alerts separately from Stock Watchlist tracking.
        </p>
      )}
    </div>
  );
}

function renderEventDetails(event: CalendarEvent) {
  if (event.category === "company") {
    return <dl>{renderCompanyDetails(event)}</dl>;
  }
  if (event.category === "macro") {
    return <MacroDetails event={event} />;
  }
  return <dl>{renderPolicyDetails(event)}</dl>;
}

function renderCompanyDetails(event: CompanyCalendarEvent) {
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
        <DetailValue
          label="Split type"
          value={
            event.details.splitKind
              ? `${titleCase(event.details.splitKind)} split`
              : null
          }
        />
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
      <DetailValue
        label="IPO stage"
        value={event.details.ipoStage ? titleCase(event.details.ipoStage) : null}
      />
    </>
  );
}

function MacroDetails({ event }: { event: MacroCalendarEvent }) {
  return (
    <>
      <dl>
        <DetailValue label="Reference period" value={event.details.referencePeriod} />
        <DetailValue label="Release note" value={event.details.releaseNote} />
      </dl>
      <div className={styles.macroMetrics} role="table" aria-label="Economic release metrics">
        <div role="row">
          <b role="columnheader">Metric</b>
          <b role="columnheader">Actual</b>
          <b role="columnheader">Consensus</b>
          <b role="columnheader">Previous</b>
        </div>
        {event.details.metrics.map((metric) => (
          <div key={metric.name} role="row">
            <strong role="cell">{metric.name}</strong>
            <span role="cell">
              {metric.released
                ? formatMacroMetricValue(metric.actual, metric.unit)
                : "Not released"}
            </span>
            <span role="cell">{formatMacroMetricValue(metric.consensus, metric.unit)}</span>
            <span role="cell">{formatMacroMetricValue(metric.previous, metric.unit)}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function renderPolicyDetails(event: PolicyCalendarEvent) {
  const common = (
    <>
      <DetailValue label="Policy area" value={titleCase(event.policySubcategory)} />
      <DetailValue label="Affected sectors" value={joinValues(event.affectedSectors)} />
      <DetailValue label="Related tickers" value={joinValues(event.relatedTickers)} />
    </>
  );
  if (event.eventType === "fomc-decision") {
    return (
      <>
        {common}
        <DetailValue label="Decision time" value={formatExactEt(event.details.decisionTime)} />
        <DetailValue label="Press conference" value={formatExactEt(event.details.pressConferenceTime)} />
        <DetailValue
          label="SEP included"
          value={
            event.details.includesSep === null
              ? null
              : event.details.includesSep
                ? "Yes"
                : "No"
          }
        />
        <DetailValue
          label="Target range"
          value={
            event.details.targetRangeLower === null || event.details.targetRangeUpper === null
              ? null
              : `${event.details.targetRangeLower.toFixed(2)}% – ${event.details.targetRangeUpper.toFixed(2)}%`
          }
        />
      </>
    );
  }
  if (event.eventType === "fomc-minutes") {
    return (
      <>
        {common}
        <DetailValue label="Meeting period" value={event.details.meetingPeriod} />
        <DetailValue label="Document" value={event.details.documentTitle} />
      </>
    );
  }
  if (event.eventType === "fed-chair-testimony") {
    return (
      <>
        {common}
        <DetailValue label="Witness" value={event.details.witness} />
        <DetailValue label="Committee" value={event.details.committee} />
        <DetailValue label="Topic" value={event.details.topic} />
      </>
    );
  }
  if (
    event.eventType === "treasury-borrowing-estimate" ||
    event.eventType === "treasury-refunding" ||
    event.eventType === "treasury-auction-10y" ||
    event.eventType === "treasury-auction-30y"
  ) {
    return (
      <>
        {common}
        <DetailValue
          label="Kind"
          value={event.details.kind ? titleCase(event.details.kind) : null}
        />
        <DetailValue label="Maturity" value={event.details.maturity} />
        <DetailValue
          label="Amount"
          value={event.details.amountBillions === null ? null : `$${event.details.amountBillions}B`}
        />
        <DetailValue label="Result" value={event.details.result} />
      </>
    );
  }
  if (event.eventType === "sec-open-meeting" || event.eventType === "sec-rule-milestone") {
    return (
      <>
        {common}
        <DetailValue
          label="Stage"
          value={
            event.details.milestone
              ? titleCase(event.details.milestone)
              : null
          }
        />
        <DetailValue label="Title" value={event.details.ruleOrMeetingTitle} />
        <DetailValue label="Agenda" value={joinValues(event.details.agenda)} />
        <DetailValue label="Document / docket" value={event.details.documentOrDocket} />
      </>
    );
  }
  if (event.eventType === "trade-policy-action") {
    return (
      <>
        {common}
        <DetailValue
          label="Action"
          value={
            event.details.actionType
              ? titleCase(event.details.actionType)
              : null
          }
        />
        <DetailValue
          label="Date stage"
          value={
            event.details.actionDateKind
              ? titleCase(event.details.actionDateKind)
              : null
          }
        />
        <DetailValue label="Target countries" value={joinValues(event.details.targetCountries)} />
        <DetailValue label="Industries" value={joinValues(event.details.affectedIndustries)} />
        <DetailValue label="Tariff / restriction" value={event.details.tariffOrRestriction} />
      </>
    );
  }
  if (event.eventType === "fda-advisory-committee") {
    return (
      <>
        {common}
        <DetailValue label="Committee" value={event.details.committee} />
        <DetailValue label="Product" value={event.details.product} />
        <DetailValue label="Sponsor" value={event.details.sponsor} />
        <DetailValue label="Indication" value={event.details.indication} />
        <DetailValue
          label="Meeting dates"
          value={formatDetailDateRange(
            event.details.meetingStartDate,
            event.details.meetingEndDate,
          )}
        />
      </>
    );
  }
  return null;
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

function formatDetailDateRange(from: string | null, to: string | null) {
  const fromLabel = formatDetailDate(from);
  const toLabel = formatDetailDate(to);
  if (fromLabel && toLabel) return `${fromLabel} – ${toLabel}`;
  return fromLabel ?? toLabel;
}

function formatExactEt(value: string | null) {
  if (!value) return null;
  const [hour, minute] = value.split(":").map(Number);
  return `${new Date(2000, 0, 1, hour, minute).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  })} ET`;
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

function joinValues(values: readonly string[]) {
  return values.length ? values.join(", ") : null;
}

function titleCase(value: string) {
  return value
    .split("-")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
