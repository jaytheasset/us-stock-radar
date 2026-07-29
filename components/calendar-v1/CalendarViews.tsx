"use client";

import type { RefObject } from "react";
import { Bookmark, ChevronRight, MessageCircle } from "lucide-react";
import Link from "next/link";
import {
  enumerateDateRange,
  groupCalendarEventsByDate,
  parseDateOnly,
} from "@/lib/calendar-v1/dateUtils";
import {
  eventStatusLabels,
  eventTypeLabels,
  marketSessionShortLabels,
  type CalendarDateRange,
  type CalendarEvent,
} from "@/lib/calendar-v1/model";
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
  today,
}: {
  events: readonly CalendarEvent[];
  onOpenEvent: OpenEvent;
  onSelectedDateChange: (date: string) => void;
  range: CalendarDateRange;
  selectedDate: string;
  selectedDateListRef: RefObject<HTMLDivElement | null>;
  today: string;
}) {
  const dates = enumerateDateRange(range);
  const byDate = new Map(
    groupCalendarEventsByDate(events).map((group) => [group.date, group.events]),
  );
  const selectedEvents = byDate.get(selectedDate) ?? [];

  return (
    <div className={styles.calendarView} data-testid="calendar-view">
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
              })}, ${dayEvents.length} event${dayEvents.length === 1 ? "" : "s"}`}
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
                  <span data-type={event.eventType} key={event.id}>
                    <b>{event.ticker ?? "TBA"}</b>
                    <small>{eventTypeLabels[event.eventType]}</small>
                  </span>
                ))}
                {dayEvents.length > 3 ? <strong>+{dayEvents.length - 3} more</strong> : null}
              </span>
            </button>
          );
        })}
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
          <b>{selectedEvents.length} events</b>
        </header>
        <div ref={selectedDateListRef} tabIndex={-1}>
          {selectedEvents.length ? (
            selectedEvents.map((event) => (
              <CalendarEventRow event={event} key={event.id} onOpenEvent={onOpenEvent} />
            ))
          ) : (
            <SelectedDateEmpty />
          )}
        </div>
      </section>
    </div>
  );
}

export function ListView({
  events,
  onOpenEvent,
}: {
  events: readonly CalendarEvent[];
  onOpenEvent: OpenEvent;
}) {
  const groups = groupCalendarEventsByDate(events);
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
              <b>{group.events.length} events</b>
            </header>
            <div>
              {group.events.map((event) => (
                <CalendarEventRow event={event} key={event.id} onOpenEvent={onOpenEvent} />
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
  onOpenEvent,
}: {
  event: CalendarEvent;
  onOpenEvent: OpenEvent;
}) {
  const liveRoomHref = getLiveRoomHref(event.ticker);
  const stockHref = getStockRouteHref(event.ticker);
  return (
    <article className={styles.eventRow} data-event-id={event.id}>
      <button
        aria-label={`Open ${event.companyName} ${eventTypeLabels[event.eventType]} details`}
        className={styles.eventRowOpen}
        onClick={(clickEvent) => onOpenEvent(event, clickEvent.currentTarget)}
        type="button"
      />
      <div className={styles.eventIdentity}>
        <strong>{event.ticker ?? "TBA"}</strong>
        <span>{event.companyName}</span>
        {event.isWatchlisted ? <Bookmark aria-label="In mock watchlist" fill="currentColor" size={13} /> : null}
      </div>
      <div className={styles.eventDescription}>
        <span data-type={event.eventType}>{eventTypeLabels[event.eventType]}</span>
        <strong>{event.title}</strong>
      </div>
      <div className={styles.eventMeta}>
        <span>{marketSessionShortLabels[event.marketSession]}</span>
        <b data-status={event.status}>{eventStatusLabels[event.status]}</b>
      </div>
      <div className={styles.eventActions}>
        {liveRoomHref ? (
          <Link aria-label={`Open ${event.ticker} Live Room`} href={liveRoomHref}>
            <MessageCircle aria-hidden="true" size={15} />
          </Link>
        ) : null}
        {stockHref ? (
          <Link aria-label={`Open ${event.ticker} stock overview`} href={stockHref}>
            <ChevronRight aria-hidden="true" size={16} />
          </Link>
        ) : null}
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
