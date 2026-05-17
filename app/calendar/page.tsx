"use client";

import { useMemo, useState } from "react";
import {
  Bell,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

const categoryTabs = [
  { label: "All" },
  { label: "Earnings" },
  { label: "IPO" },
  { label: "FDA & Clinical" },
  { label: "Listing Risk" },
  { label: "Deals / Offering" },
  { label: "Dividends" },
  { label: "Shareholder Vote" },
];

const miniCalendar = [
  ["28", "29", "30", "1", "2", "3", "4"],
  ["5", "6", "7", "8", "9", "10", "11"],
  ["12", "13", "14", "15", "16", "17", "18"],
  ["19", "20", "21", "22", "23", "24", "25"],
  ["26", "27", "28", "29", "30", "31", "1"],
];

const calendarDays = [
  {
    day: "Mon",
    date: "May 19",
    events: [
      { time: "8:00 AM", ticker: "NVDA", title: "Q1 earnings release", type: "Earnings Release", category: "Earnings", tone: "release", impact: "High", status: "Confirmed" },
      { time: "5:00 PM", ticker: "NVDA", title: "Earnings call", type: "Earnings Call", category: "Earnings", tone: "call", impact: "Medium", status: "Confirmed" },
      { time: "After Market", ticker: "AMC", title: "Q1 earnings release", type: "Post-Market", category: "Earnings", tone: "post", impact: "Medium", status: "Tentative" },
    ],
  },
  {
    day: "Tue",
    date: "May 20",
    events: [
      { time: "Before Market", ticker: "PFE", title: "Q1 earnings release", type: "Pre-Market", category: "Earnings", tone: "pre", impact: "Medium", status: "Confirmed" },
      { time: "4:30 PM", ticker: "PFE", title: "Earnings call", type: "Earnings Call", category: "Earnings", tone: "call", impact: "Medium", status: "Confirmed" },
      { time: "Before Market", ticker: "HD", title: "Q1 earnings release", type: "Pre-Market", category: "Earnings", tone: "pre", impact: "Medium", status: "Confirmed" },
      { time: "10:00 AM", ticker: "ABVX", title: "IPO pricing expected", type: "IPO Pricing", category: "IPO", tone: "ipo", impact: "Medium", status: "Tentative" },
    ],
  },
  {
    day: "Wed",
    date: "May 21",
    events: [
      { time: "Before Market", ticker: "TSLA", title: "Q1 earnings release", type: "Pre-Market", category: "Earnings", tone: "pre", impact: "High", status: "Confirmed" },
      { time: "9:30 AM", ticker: "NEWU", title: "Expected first trading day", type: "IPO Listing", category: "IPO", tone: "ipo", impact: "Medium", status: "Tentative" },
      { time: "After Market", ticker: "CRM", title: "Q1 earnings release", type: "Post-Market", category: "Earnings", tone: "post", impact: "Medium", status: "Confirmed" },
      { time: "4:00 PM", ticker: "MSTR", title: "Convertible note offering closing", type: "Offering Closing", category: "Deals / Offering", tone: "deal", impact: "High", status: "Confirmed" },
    ],
  },
  {
    day: "Thu",
    date: "May 22",
    events: [
      { time: "Before Market", ticker: "AMZN", title: "Q1 earnings release", type: "Pre-Market", category: "Earnings", tone: "pre", impact: "High", status: "Confirmed" },
      { time: "12:00 PM", ticker: "MNPR", title: "Nasdaq compliance deadline", type: "Listing Deadline", category: "Listing Risk", tone: "risk", impact: "High", status: "Confirmed" },
      { time: "After Market", ticker: "AAPL", title: "Q2 earnings release", type: "Post-Market", category: "Earnings", tone: "post", impact: "Medium", status: "Confirmed" },
      { time: "5:00 PM", ticker: "AAPL", title: "Earnings call", type: "Earnings Call", category: "Earnings", tone: "call", impact: "Medium", status: "Confirmed" },
    ],
  },
  {
    day: "Fri",
    date: "May 23",
    events: [
      { time: "Before Market", ticker: "XOM", title: "Q1 earnings release", type: "Pre-Market", category: "Earnings", tone: "pre", impact: "Medium", status: "Confirmed" },
      { time: "11:00 AM", ticker: "XOM", title: "Earnings call", type: "Earnings Call", category: "Earnings", tone: "call", impact: "Medium", status: "Confirmed" },
      { time: "8:30 AM", ticker: "ABBV", title: "Earnings call", type: "Earnings Call", category: "Earnings", tone: "call", impact: "Medium", status: "Confirmed" },
      { time: "Market Close", ticker: "ARQT", title: "PDUFA target action date", type: "PDUFA Date", category: "FDA & Clinical", tone: "fda", impact: "High", status: "Tentative" },
      { time: "Record Date", ticker: "ARDC", title: "Monthly dividend record date", type: "Dividend Record", category: "Dividends", tone: "dividend", impact: "Low", status: "Confirmed" },
      { time: "2:00 PM", ticker: "AMC", title: "Special shareholder meeting", type: "Shareholder Meeting", category: "Shareholder Vote", tone: "shareholder", impact: "Medium", status: "Confirmed" },
    ],
  },
];

const highImpact = [
  { ticker: "TSLA", company: "Tesla, Inc.", label: "Q1 Earnings Release", date: "May 21", impact: "High" },
  { ticker: "NVDA", company: "NVIDIA Corporation", label: "Q1 Earnings Release", date: "May 19", impact: "High" },
  { ticker: "AAPL", company: "Apple Inc.", label: "Q2 Earnings Release", date: "May 22", impact: "Medium" },
];

const watchlistEvents = [
  { ticker: "TSLA", company: "Tesla, Inc.", label: "Q1 Earnings Release", date: "May 21" },
  { ticker: "AMZN", company: "Amazon.com, Inc.", label: "Q1 Earnings Release", date: "May 22" },
  { ticker: "AAPL", company: "Apple Inc.", label: "Q2 Earnings Release", date: "May 22" },
];

function getEventSummary(event: (typeof calendarDays)[number]["events"][number]) {
  if (event.type.includes("Earnings Call")) return "Management commentary and guidance timing may reset near-term expectations.";
  if (event.type.includes("Earnings") || event.type.includes("Pre-Market") || event.type.includes("Post-Market")) {
    return "Quarterly results, guidance, and margin commentary are the key watch points.";
  }
  if (event.category === "IPO") return "Pricing, listing timing, and first-day liquidity can drive early volatility.";
  if (event.category === "Listing Risk") return "Compliance deadline may affect listing status and reverse split risk.";
  if (event.category === "Deals / Offering") return "Financing close can change dilution, cash runway, and deal certainty.";
  if (event.category === "FDA & Clinical") return "Regulatory timing can create binary catalyst risk for the stock.";
  if (event.category === "Dividends") return "Record date confirms shareholder eligibility for the announced distribution.";
  if (event.category === "Shareholder Vote") return "Vote outcome can affect governance, financing authority, or strategic plans.";
  return "Scheduled event with potential market relevance.";
}

function relatedNewsHref(ticker: string) {
  return `/news?query=${encodeURIComponent(ticker)}`;
}

function relatedFilingHref(ticker: string) {
  return `/filings?query=${encodeURIComponent(ticker)}`;
}

export default function CalendarPage() {
  const [activeCategory, setActiveCategory] = useState("All");
  const [viewMode, setViewMode] = useState<"Month" | "Week" | "List">("List");
  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    let total = 0;
    for (const day of calendarDays) {
      for (const event of day.events) {
        total += 1;
        counts.set(event.category, (counts.get(event.category) || 0) + 1);
      }
    }
    counts.set("All", total);
    return counts;
  }, []);
  const filteredDays = useMemo(
    () =>
      calendarDays.map((day) => ({
        ...day,
        events: activeCategory === "All" ? day.events : day.events.filter((event) => event.category === activeCategory),
      })),
    [activeCategory],
  );
  const listItems = useMemo(
    () =>
      filteredDays.flatMap((day) =>
        day.events.map((event) => ({
          ...event,
          day: day.day,
          date: day.date,
        })),
      ),
    [filteredDays],
  );
  const listRows = useMemo(
    () =>
      listItems.map((event, index) => ({
        ...event,
        showDate: index === 0 || listItems[index - 1]?.date !== event.date,
      })),
    [listItems],
  );

  function selectCategory(label: string) {
    setActiveCategory(label);
    setViewMode(label === "All" ? "List" : "Week");
  }

  return (
    <main className="market-calendar-page">
      <header className="feed-nav calendar-nav">
        <a className="brand-lockup" href="/feed" aria-label="US Stock Radar feed">
          <span className="brand-mark">SR</span>
          <span>STOCK RADAR</span>
        </a>
        <nav className="feed-nav-links" aria-label="Primary">
          <a href="/feed">Live Feed</a>
          <a href="#">Watchlist</a>
          <a href="/news">News</a>
          <a href="/filings">Filings</a>
          <a href="#">Alerts</a>
          <a className="active" href="/calendar">
            Calendar
          </a>
          <a href="#">Premium</a>
        </nav>
        <label className="feed-search">
          <span>/</span>
          <input aria-label="Search calendar" placeholder="Search stocks, companies, events..." />
        </label>
        <div className="feed-actions">
          <button className="icon-button" type="button" aria-label="Notifications">
            !
            <span className="notification-dot">3</span>
          </button>
          <button className="avatar-button" type="button">
            N
          </button>
        </div>
      </header>

      <section className="market-calendar-shell">
        <div className="market-calendar-hero">
          <div>
            <h1>Market Calendar</h1>
            <p>Browse upcoming corporate, regulatory, and market-moving events by category.</p>
          </div>
          <div className="market-calendar-controls">
            <button type="button" className="calendar-range-button">
              <CalendarDays size={16} />
              May 19 - May 23, 2026
              <ChevronDown size={15} />
            </button>
            <button type="button">Today</button>
            <div className="calendar-view-toggle" aria-label="Calendar view">
              {(["Month", "Week", "List"] as const).map((mode) => (
                <button
                  type="button"
                  className={viewMode === mode ? "active" : ""}
                  key={mode}
                  onClick={() => setViewMode(mode)}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="calendar-category-tabs" aria-label="Calendar event categories">
          {categoryTabs.map((tab) => (
            <button
              type="button"
              className={activeCategory === tab.label ? "active" : ""}
              key={tab.label}
              onClick={() => selectCategory(tab.label)}
            >
              <span>{tab.label}</span>
              <b>{categoryCounts.get(tab.label) || 0}</b>
            </button>
          ))}
        </div>

        <div className="calendar-workspace">
          <aside className="calendar-left-rail">
            <section className="calendar-mini-panel">
              <div className="mini-calendar-head">
                <button type="button" aria-label="Previous month">
                  <ChevronLeft size={16} />
                </button>
                <strong>May 2026</strong>
                <button type="button" aria-label="Next month">
                  <ChevronRight size={16} />
                </button>
              </div>
              <div className="mini-calendar-grid" aria-label="May 2026 mini calendar">
                {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((day) => (
                  <span className="mini-calendar-weekday" key={day}>
                    {day}
                  </span>
                ))}
                {miniCalendar.flat().map((day, index) => (
                  <button
                    type="button"
                    className={`${day === "19" ? "selected" : ""} ${index < 3 || index > 33 ? "muted" : ""}`}
                    key={`${day}-${index}`}
                  >
                    {day}
                  </button>
                ))}
              </div>
            </section>

            <section className="calendar-left-actions">
              <button type="button">
                <CalendarDays size={15} />
                Today
              </button>
              <button type="button">
                <CalendarDays size={15} />
                Next 7 Days
                <ChevronRight className="action-chevron" size={14} />
              </button>
              <button type="button">
                <CalendarDays size={15} />
                Next 30 Days
                <ChevronRight className="action-chevron" size={14} />
              </button>
            </section>

            <section className="calendar-legend">
              <h2>Event Legend</h2>
              {[
                ["release", "Earnings Release"],
                ["call", "Earnings Call"],
                ["pre", "Pre-Market"],
                ["post", "Post-Market"],
                ["other", "Other / Unscheduled"],
              ].map(([tone, label]) => (
                <div key={tone}>
                  <span className={`legend-dot ${tone}`} />
                  <p>{label}</p>
                </div>
              ))}
            </section>
          </aside>

          <section className="calendar-board-panel">
            <div className="calendar-filter-toolbar">
              <button type="button">
                <span>Exchange</span>
                <b>All</b>
                <ChevronDown size={13} />
              </button>
              <button type="button">
                <span>Market Cap</span>
                <b>All</b>
                <ChevronDown size={13} />
              </button>
              <button type="button">
                <span>Status</span>
                <b>All</b>
                <ChevronDown size={13} />
              </button>
              <button type="button">
                <span>Timing</span>
                <b>All</b>
                <ChevronDown size={13} />
              </button>
              <button type="button">
                <span>Impact</span>
                <b>All</b>
                <ChevronDown size={13} />
              </button>
              <label className="calendar-watchlist-filter">
                <input type="checkbox" />
                Watchlist Only
              </label>
            </div>

            {viewMode === "List" ? (
              <div className="calendar-list-board">
                {listRows.map((event) => (
                  <article className="calendar-list-row" key={`${event.date}-${event.ticker}-${event.time}-${event.title}`}>
                    <span className={`calendar-list-date ${event.showDate ? "" : "time-only"}`}>
                      {event.showDate ? <b>{event.date}</b> : null}
                      <small>{event.time}</small>
                    </span>
                    <em className="calendar-list-type">{event.category}</em>
                    <strong className="calendar-list-ticker">{event.ticker}</strong>
                    <span className="calendar-list-event">
                      <b>{event.title}</b>
                      <p>{getEventSummary(event)}</p>
                      <small>{event.type}</small>
                      <span className="calendar-event-links">
                        <a href={relatedNewsHref(event.ticker)}>News</a>
                        <a href={relatedFilingHref(event.ticker)}>Filings</a>
                      </span>
                    </span>
                    <span className="calendar-list-meta">
                      <b className={`impact-${event.impact.toLowerCase()}`}>{event.impact}</b>
                      <small>{event.status}</small>
                    </span>
                  </article>
                ))}
              </div>
            ) : (
              <div className={`calendar-week-board ${viewMode === "Month" ? "month-mode" : ""}`}>
                {filteredDays.map((day) => (
                  <article className="calendar-week-column" key={`${day.day}-${day.date}`}>
                    <header>
                      <strong>{day.day}</strong>
                      <span>{day.date}</span>
                    </header>
                    <div className="calendar-column-events">
                      {day.events.length === 0 ? (
                        <div className="calendar-empty-day">No events scheduled</div>
                      ) : (
                        day.events.map((event) => (
                          <article className={`week-event-card ${event.tone}`} key={`${event.ticker}-${event.time}-${event.title}`}>
                            <span>
                              <b>{event.time}</b>
                              <strong>{event.ticker}</strong>
                              <Bell size={12} />
                            </span>
                            <h3>{event.title}</h3>
                            <p>{getEventSummary(event)}</p>
                            <div className="calendar-event-links">
                              <a href={relatedNewsHref(event.ticker)}>News</a>
                              <a href={relatedFilingHref(event.ticker)}>Filings</a>
                            </div>
                          </article>
                        ))
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <aside className="calendar-right-rail">
            <section className="calendar-selected-panel">
              <div className="calendar-panel-title">
                <h2>Selected Event</h2>
                <button type="button" aria-label="Close selected event">x</button>
              </div>
              <span className="calendar-kicker">Earnings Release</span>
              <h3>NVIDIA Corporation</h3>
              <p>NVDA</p>
              <div className="calendar-selected-facts">
                <span>Mon, May 19, 2026</span>
                <span>8:00 AM ET</span>
                <span>Pre-Market</span>
              </div>
              <div className="calendar-chip-row">
                <b>Large Cap</b>
                <b>Semiconductors</b>
              </div>
            </section>

            <section className="calendar-side-card">
              <h2>This Week in Earnings</h2>
              <div className="calendar-donut-row">
                <div className="calendar-donut">
                  <strong>96</strong>
                  <span>Total Events</span>
                </div>
                <div className="calendar-donut-legend">
                  <p><i className="pre" />Pre-Market <b>40</b></p>
                  <p><i className="post" />After-Market <b>30</b></p>
                  <p><i className="call" />Both <b>20</b></p>
                  <p><i className="other" />TBD <b>6</b></p>
                </div>
              </div>
            </section>

            <section className="calendar-side-card">
              <div className="calendar-panel-link-title">
                <h2>High-Impact Upcoming</h2>
                <a href="#">View all</a>
              </div>
              <div className="calendar-side-event-list">
                {highImpact.map((event) => (
                  <a href="#" key={`${event.ticker}-${event.date}`}>
                    <span>
                      <b>{event.ticker}</b>
                      <small>{event.company}</small>
                      <em>{event.label}</em>
                    </span>
                    <strong className={event.impact.toLowerCase()}>{event.impact}</strong>
                    <p>{event.date}</p>
                  </a>
                ))}
              </div>
            </section>

            <section className="calendar-side-card">
              <div className="calendar-panel-link-title">
                <h2>My Watchlist Events</h2>
                <a href="#">View all</a>
              </div>
              <div className="calendar-side-event-list watchlist">
                {watchlistEvents.map((event) => (
                  <a href="#" key={`${event.ticker}-${event.date}`}>
                    <span>
                      <b>{event.ticker}</b>
                      <small>{event.company}</small>
                      <em>{event.label}</em>
                    </span>
                    <p>{event.date}</p>
                  </a>
                ))}
              </div>
            </section>
          </aside>
        </div>
      </section>
    </main>
  );
}
