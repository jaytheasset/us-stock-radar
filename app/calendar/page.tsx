import {
  AlertTriangle,
  BarChart3,
  Beaker,
  Bell,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  FlaskConical,
  Handshake,
  Scale,
  ShieldAlert,
  Users,
} from "lucide-react";

const categoryTabs = [
  { label: "All", count: 25, icon: CalendarDays },
  { label: "Earnings", count: 4, icon: BarChart3, active: true },
  { label: "Shareholder", count: 3, icon: Users },
  { label: "Dividends", count: 4, icon: CircleDollarSign },
  { label: "Listing Risk", count: 2, icon: ShieldAlert },
  { label: "Deals / Offering", count: 4, icon: Handshake },
  { label: "Filings", count: 1, icon: CalendarDays },
  { label: "FDA / Clinical", count: 0, icon: FlaskConical },
  { label: "Investor Events", count: 0, icon: Users },
  { label: "Legal / Policy", count: 0, icon: Scale },
  { label: "Other", count: 7, icon: AlertTriangle },
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
      { time: "8:00 AM", ticker: "NVDA", title: "Q1 earnings release", type: "Earnings Release", tone: "release" },
      { time: "5:00 PM", ticker: "NVDA", title: "Earnings call", type: "Earnings Call", tone: "call" },
      { time: "After Market", ticker: "AMC", title: "Q1 earnings release", type: "Post-Market", tone: "post" },
    ],
  },
  {
    day: "Tue",
    date: "May 20",
    events: [
      { time: "Before Market", ticker: "PFE", title: "Q1 earnings release", type: "Pre-Market", tone: "pre" },
      { time: "4:30 PM", ticker: "PFE", title: "Earnings call", type: "Earnings Call", tone: "call" },
      { time: "Before Market", ticker: "HD", title: "Q1 earnings release", type: "Pre-Market", tone: "pre" },
      { time: "5:00 PM", ticker: "HD", title: "Earnings call", type: "Earnings Call", tone: "call" },
    ],
  },
  {
    day: "Wed",
    date: "May 21",
    events: [
      { time: "Before Market", ticker: "TSLA", title: "Q1 earnings release", type: "Pre-Market", tone: "pre" },
      { time: "4:30 PM", ticker: "TSLA", title: "Earnings call", type: "Earnings Call", tone: "call" },
      { time: "After Market", ticker: "CRM", title: "Q1 earnings release", type: "Post-Market", tone: "post" },
    ],
  },
  {
    day: "Thu",
    date: "May 22",
    events: [
      { time: "Before Market", ticker: "AMZN", title: "Q1 earnings release", type: "Pre-Market", tone: "pre" },
      { time: "4:30 PM", ticker: "AMZN", title: "Earnings call", type: "Earnings Call", tone: "call" },
      { time: "After Market", ticker: "AAPL", title: "Q2 earnings release", type: "Post-Market", tone: "post" },
      { time: "5:00 PM", ticker: "AAPL", title: "Earnings call", type: "Earnings Call", tone: "call" },
    ],
  },
  {
    day: "Fri",
    date: "May 23",
    events: [
      { time: "Before Market", ticker: "XOM", title: "Q1 earnings release", type: "Pre-Market", tone: "pre" },
      { time: "11:00 AM", ticker: "XOM", title: "Earnings call", type: "Earnings Call", tone: "call" },
      { time: "Before Market", ticker: "ABBV", title: "Q1 earnings release", type: "Pre-Market", tone: "pre" },
      { time: "8:30 AM", ticker: "ABBV", title: "Earnings call", type: "Earnings Call", tone: "call" },
    ],
  },
];

const summaryCards = [
  { label: "Earnings Release", value: 28, change: "+7", icon: BarChart3, tone: "blue" },
  { label: "Earnings Call", value: 34, change: "+9", icon: Bell, tone: "green" },
  { label: "Pre-Market", value: 12, change: "-2", icon: Beaker, tone: "purple" },
  { label: "Post-Market", value: 14, change: "+3", icon: CalendarDays, tone: "orange" },
  { label: "Other Events", value: 8, change: "0", icon: AlertTriangle, tone: "gray" },
  { label: "Total Events", value: 96, change: "+17", icon: CalendarDays, tone: "dark" },
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

export default function CalendarPage() {
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
              <button type="button">Month</button>
              <button type="button" className="active">
                Week
              </button>
              <button type="button">List</button>
            </div>
          </div>
        </div>

        <div className="calendar-category-tabs" aria-label="Calendar event categories">
          {categoryTabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button type="button" className={tab.active ? "active" : ""} key={tab.label}>
                <Icon size={18} />
                <span>{tab.label}</span>
                <b>{tab.count}</b>
              </button>
            );
          })}
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
                <span>Event Type</span>
                <b>All</b>
                <ChevronDown size={13} />
              </button>
              <button type="button">
                <span>Status</span>
                <b>All</b>
                <ChevronDown size={13} />
              </button>
              <button type="button">
                <span>Source</span>
                <b>All</b>
                <ChevronDown size={13} />
              </button>
              <button type="button">
                <span>Market Cap</span>
                <b>All</b>
                <ChevronDown size={13} />
              </button>
              <label className="calendar-watchlist-filter">
                <input type="checkbox" />
                Watchlist Only
              </label>
            </div>

            <div className="calendar-week-board">
              {calendarDays.map((day) => (
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
                        <button type="button" className={`week-event-card ${event.tone}`} key={`${event.ticker}-${event.time}-${event.title}`}>
                          <span>
                            <b>{event.time}</b>
                            <strong>{event.ticker}</strong>
                            <Bell size={12} />
                          </span>
                          <p>{event.title}</p>
                        </button>
                      ))
                    )}
                  </div>
                </article>
              ))}
            </div>

            <div className="calendar-summary-strip">
              {summaryCards.map((item) => {
                const Icon = item.icon;
                return (
                  <section className={`calendar-summary-card ${item.tone}`} key={item.label}>
                    <div>
                      <Icon size={22} />
                    </div>
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                    <p>
                      vs last week <b className={item.change.startsWith("-") ? "down" : "up"}>{item.change}</b>
                    </p>
                  </section>
                );
              })}
            </div>
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
