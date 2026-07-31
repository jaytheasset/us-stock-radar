"use client";

import type { RefObject } from "react";
import { Bookmark, ChevronRight, MessageCircle } from "lucide-react";
import Link from "next/link";
import { CalendarEventTypeBadge } from "@/components/calendar-v1/CalendarEventTypeBadge";
import {
  enumerateDateRange,
  groupCalendarEventsByDate,
  parseDateOnly,
} from "@/lib/calendar-v1/dateUtils";
import {
  eventStatusLabels,
  eventTypeLabels,
  impactLevelLabels,
  marketSessionShortLabels,
  type CalendarDateRange,
  type CalendarEvent,
} from "@/lib/calendar-v1/model";
import {
  formatCalendarEventTime,
  formatEventCount,
  getCalendarCompactIdentity,
  getCalendarEventContext,
  getCalendarEventIdentity,
  selectUpcomingCalendarEvents,
} from "@/lib/calendar-v1/presentation";
import { getLiveRoomHref } from "@/lib/live-room/adapters";
import { getStockRouteHref } from "@/lib/watchlist/stockOverview";
import styles from "./CalendarV1.module.css";

type OpenEvent = (event: CalendarEvent, opener: HTMLElement) => void;

export function CalendarView({
  events,
  onOpenEvent,
  onSelectedDateChange,
  range,
  selectedDate,
  selectedDateListRef,
  selectedEventId,
  today,
}: {
  events: readonly CalendarEvent[];
  onOpenEvent: OpenEvent;
  onSelectedDateChange: (date: string) => void;
  range: CalendarDateRange;
  selectedDate: string;
  selectedDateListRef: RefObject<HTMLDivElement | null>;
  selectedEventId: string | null;
  today: string;
}) {
  const dates = enumerateDateRange(range);
  const byDate = new Map(
    groupCalendarEventsByDate(events, today).map((group) => [group.date, group.events]),
  );
  const selectedEvents = byDate.get(selectedDate) ?? [];
  const upcomingEvents = selectUpcomingCalendarEvents(events, selectedDate);

  return (
    <div className={styles.calendarView} data-testid="calendar-view">
      <div className={styles.weekStrip}>
        <div className={styles.calendarWeekdays} aria-hidden="true">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => <span key={day}>{day}</span>)}
        </div>
        <div aria-label="Event calendar dates" className={styles.calendarGrid} role="group">
          {dates.map((date) => {
            const dayEvents = byDate.get(date) ?? [];
            const parsed = parseDateOnly(date);
            const isSelected = date === selectedDate;
            const isToday = date === today;
            return (
              <button
                aria-label={`${parsed.toLocaleDateString("en-US", {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })}, ${formatEventCount(dayEvents.length)}`}
                aria-pressed={isSelected}
                className={styles.calendarDay}
                data-selected={isSelected}
                data-today={isToday}
                key={date}
                onClick={() => {
                  onSelectedDateChange(date);
                  requestAnimationFrame(() => selectedDateListRef.current?.focus());
                }}
                type="button"
              >
                <span className={styles.dayHeading}>
                  <b>{parsed.getDate()}</b>
                  {isToday ? <em>Today</em> : null}
                  {dayEvents.length ? <small>{dayEvents.length}</small> : null}
                </span>
                <span className={styles.dayEvents}>
                  {dayEvents.slice(0, 3).map((event) => (
                    <span key={event.id}>
                      <b>{getCalendarCompactIdentity(event)}</b>
                      <CalendarEventTypeBadge
                        eventType={event.eventType}
                        truncateLabel
                      />
                    </span>
                  ))}
                  {dayEvents.length > 3 ? <strong>+{dayEvents.length - 3} more</strong> : null}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <section className={styles.selectedDateSection} aria-labelledby="selected-date-title">
        <header>
          <div>
            <span>SELECTED DATE</span>
            <h2 id="selected-date-title">
              {parseDateOnly(selectedDate).toLocaleDateString("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric",
              })}
            </h2>
          </div>
          <b>{formatEventCount(selectedEvents.length)}</b>
        </header>
        <div ref={selectedDateListRef} tabIndex={-1}>
          {selectedEvents.length ? (
            selectedEvents.map((event) => (
              <CalendarEventRow
                event={event}
                isSelected={event.id === selectedEventId}
                key={event.id}
                onOpenEvent={onOpenEvent}
              />
            ))
          ) : (
            <SelectedDateEmpty />
          )}
        </div>
      </section>
      {upcomingEvents ? (
        <UpcomingEvents
          events={upcomingEvents}
          onOpenEvent={(event, opener) => {
            if (!window.matchMedia("(max-width: 1180px)").matches) {
              onSelectedDateChange(event.eventDate);
            }
            onOpenEvent(event, opener);
          }}
          selectedEventId={selectedEventId}
        />
      ) : null}
    </div>
  );
}

export function ListView({
  events,
  onOpenEvent,
  selectedEventId,
  today,
}: {
  events: readonly CalendarEvent[];
  onOpenEvent: OpenEvent;
  selectedEventId: string | null;
  today: string;
}) {
  const groups = groupCalendarEventsByDate(events, today);
  return (
    <div className={styles.listView} data-testid="list-view">
      {groups.map((group) => {
        const date = parseDateOnly(group.date);
        return (
          <section className={styles.dateGroup} key={group.date}>
            <header>
              <div className={styles.dateBadge}>
                <span>{date.toLocaleDateString("en-US", { month: "short" })}</span>
                <strong>{date.getDate()}</strong>
              </div>
              <div>
                <h2>{date.toLocaleDateString("en-US", { weekday: "long" })}</h2>
                <p>{date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</p>
              </div>
              <b>{formatEventCount(group.events.length)}</b>
            </header>
            <div>
              {group.events.map((event) => (
                <CalendarEventRow
                  event={event}
                  isSelected={event.id === selectedEventId}
                  key={event.id}
                  onOpenEvent={onOpenEvent}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function CalendarEventRow({
  event,
  isSelected,
  onOpenEvent,
}: {
  event: CalendarEvent;
  isSelected: boolean;
  onOpenEvent: OpenEvent;
}) {
  const identity = getCalendarEventIdentity(event);
  const liveRoomHref = getLiveRoomHref(identity.primaryTicker);
  const stockHref = getStockRouteHref(identity.primaryTicker);
  return (
    <article
      className={styles.eventRow}
      data-event-id={event.id}
      data-selected={isSelected}
    >
      <button
        aria-label={`Open ${identity.secondaryLabel} ${eventTypeLabels[event.eventType]} details`}
        className={styles.eventRowOpen}
        onClick={(clickEvent) => onOpenEvent(event, clickEvent.currentTarget)}
        type="button"
      />
      <div className={styles.eventIdentity}>
        <strong>{identity.primaryLabel}</strong>
        <span>{identity.secondaryLabel}</span>
        {event.category === "company" && event.isWatchlisted ? (
          <Bookmark aria-label="In mock watchlist" fill="currentColor" size={13} />
        ) : null}
      </div>
      <div className={styles.eventDescription}>
        <CalendarEventTypeBadge eventType={event.eventType} />
        <strong>{event.title}</strong>
        <small>{getCalendarEventContext(event)}</small>
      </div>
      <div className={styles.eventMeta}>
        <span>
          {formatCalendarEventTime(event)} · {marketSessionShortLabels[event.marketSession]}
        </span>
        <b data-status={event.status}>{eventStatusLabels[event.status]}</b>
        <small>{impactLevelLabels[event.impactLevel]}</small>
      </div>
      <div className={styles.eventActions}>
        {liveRoomHref ? (
          <Link aria-label={`Open ${identity.primaryTicker} Live Room`} href={liveRoomHref}>
            <MessageCircle aria-hidden="true" size={15} />
          </Link>
        ) : null}
        {stockHref ? (
          <Link aria-label={`Open ${identity.primaryTicker} stock overview`} href={stockHref}>
            <ChevronRight aria-hidden="true" size={16} />
          </Link>
        ) : null}
      </div>
    </article>
  );
}

function UpcomingEvents({
  events,
  onOpenEvent,
  selectedEventId,
}: {
  events: readonly CalendarEvent[];
  onOpenEvent: OpenEvent;
  selectedEventId: string | null;
}) {
  return (
    <section
      aria-labelledby="upcoming-events-title"
      className={styles.upcomingPanel}
      data-testid="calendar-upcoming-events"
    >
      <header>
        <div>
          <span>NEXT IN RANGE</span>
          <h2 id="upcoming-events-title">Upcoming events</h2>
        </div>
        <b>{formatEventCount(events.length)}</b>
      </header>
      <div>
        {events.length ? (
          events.map((event) => (
            <UpcomingEventRow
              event={event}
              isSelected={event.id === selectedEventId}
              key={event.id}
              onOpenEvent={onOpenEvent}
            />
          ))
        ) : (
          <p className={styles.upcomingEmpty}>No later events in this range.</p>
        )}
      </div>
    </section>
  );
}

function UpcomingEventRow({
  event,
  isSelected,
  onOpenEvent,
}: {
  event: CalendarEvent;
  isSelected: boolean;
  onOpenEvent: OpenEvent;
}) {
  const date = parseDateOnly(event.eventDate);
  const identity = getCalendarEventIdentity(event);

  return (
    <article
      className={styles.upcomingRow}
      data-event-id={event.id}
      data-selected={isSelected}
    >
      <button
        aria-label={`Open upcoming ${identity.secondaryLabel} ${eventTypeLabels[event.eventType]} details`}
        className={styles.upcomingRowOpen}
        onClick={(clickEvent) => onOpenEvent(event, clickEvent.currentTarget)}
        type="button"
      />
      <time className={styles.upcomingDate} dateTime={event.eventDate}>
        <span>{date.toLocaleDateString("en-US", { weekday: "short" })}</span>
        <strong>
          {date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
        </strong>
      </time>
      <div className={styles.upcomingIdentity}>
        <strong>{identity.primaryLabel}</strong>
        <span>{identity.secondaryLabel}</span>
      </div>
      <div className={styles.upcomingDescription}>
        <CalendarEventTypeBadge eventType={event.eventType} />
        <strong>{event.title}</strong>
        <small>{getCalendarEventContext(event)}</small>
      </div>
      <div className={styles.upcomingMeta}>
        <span>{formatCalendarEventTime(event)}</span>
        <b data-status={event.status}>{eventStatusLabels[event.status]}</b>
        <small>{impactLevelLabels[event.impactLevel]}</small>
      </div>
    </article>
  );
}

function SelectedDateEmpty() {
  return (
    <div className={styles.selectedDateEmpty}>
      <span>No events on this date</span>
      <p>Choose another date or adjust the active filters.</p>
    </div>
  );
}
