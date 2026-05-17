import {
  AlertTriangle,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Clock3,
  FileText,
  Landmark,
  Newspaper,
} from "lucide-react";

const calendarStats = [
  { label: "Today", value: "8", detail: "3 confirmed" },
  { label: "This Week", value: "21", detail: "14 filings" },
  { label: "High Impact", value: "7", detail: "Impact 75+" },
  { label: "Tentative", value: "5", detail: "News sourced" },
];

const filterTabs = [
  "All",
  "Earnings",
  "Shareholder",
  "Dividends",
  "Listing Risk",
  "Deals / Offering",
  "FDA / Clinical",
];

const weekDays = [
  {
    label: "Mon",
    date: "25",
    tone: "quiet",
    events: [
      { ticker: "CGC", type: "Filing Due" },
      { ticker: "SKE", type: "Offering" },
    ],
  },
  {
    label: "Tue",
    date: "26",
    tone: "active",
    events: [
      { ticker: "XTLB", type: "Record Date" },
      { ticker: "AVX", type: "Proxy" },
    ],
  },
  {
    label: "Wed",
    date: "27",
    tone: "active",
    events: [
      { ticker: "VIV", type: "Dividend" },
      { ticker: "U", type: "Form 4" },
    ],
  },
  {
    label: "Thu",
    date: "28",
    tone: "quiet",
    events: [{ ticker: "VELO", type: "ATM" }],
  },
  {
    label: "Fri",
    date: "29",
    tone: "risk",
    events: [
      { ticker: "AVX", type: "Meeting" },
      { ticker: "BURU", type: "Listing" },
    ],
  },
];

const calendarEvents = [
  {
    date: "May 26",
    weekday: "Tue",
    time: "All day",
    ticker: "XTLB",
    title: "Record date for extraordinary meeting voting eligibility",
    source: "SEC 6-K",
    group: "Shareholder",
    status: "Confirmed",
    tone: "neutral",
    impact: "80",
    meta: "Psyga acquisition vote",
  },
  {
    date: "May 27",
    weekday: "Wed",
    time: "All day",
    ticker: "VIV",
    title: "Interest on capital dividend record date",
    source: "SEC 6-K",
    group: "Dividends",
    status: "Confirmed",
    tone: "bullish",
    impact: "65",
    meta: "R$600M capital return",
  },
  {
    date: "May 29",
    weekday: "Fri",
    time: "Market day",
    ticker: "AVX",
    title: "Annual shareholder meeting with possible reverse split vote",
    source: "SEC 8-K",
    group: "Shareholder",
    status: "Confirmed",
    tone: "bearish",
    impact: "82",
    meta: "Bid-price deficiency context",
  },
  {
    date: "Jun 15",
    weekday: "Mon",
    time: "10:00 AM ET",
    ticker: "CGC",
    title: "FY2026 results release, 10-K due date, and investor webcast",
    source: "SEC 8-K",
    group: "Earnings",
    status: "Confirmed",
    tone: "bearish",
    impact: "80",
    meta: "Restatement and material weakness",
  },
  {
    date: "Jun 22",
    weekday: "Mon",
    time: "4:00 PM ET",
    ticker: "XTLB",
    title: "Extraordinary general meeting for acquisition and financing proposals",
    source: "SEC 6-K",
    group: "Deals / Offering",
    status: "Confirmed",
    tone: "volatile",
    impact: "80",
    meta: "ADS issuance and Psyga deal",
  },
  {
    date: "Jul 6",
    weekday: "Mon",
    time: "All day",
    ticker: "AVX",
    title: "Nasdaq bid-price compliance deadline",
    source: "SEC 8-K",
    group: "Listing Risk",
    status: "Confirmed",
    tone: "bearish",
    impact: "82",
    meta: "Minimum bid requirement",
  },
  {
    date: "Oct 29",
    weekday: "Thu",
    time: "All day",
    ticker: "BURU",
    title: "NYSE American compliance plan period end",
    source: "SEC 8-K",
    group: "Listing Risk",
    status: "Confirmed",
    tone: "bearish",
    impact: "78",
    meta: "Exchange compliance deadline",
  },
  {
    date: "Q2 2027",
    weekday: "Window",
    time: "Estimated",
    ticker: "SKE",
    title: "Target commencement of Eskay commercial production",
    source: "SEC 6-K",
    group: "Deals / Offering",
    status: "Tentative",
    tone: "volatile",
    impact: "80",
    meta: "Long-range production window",
  },
];

const highRiskDates = [
  { ticker: "AVX", label: "Listing deadline", date: "Jul 6", tone: "bearish" },
  { ticker: "BURU", label: "Compliance plan ends", date: "Oct 29", tone: "bearish" },
  { ticker: "CGC", label: "Restated results", date: "Jun 15", tone: "bearish" },
  { ticker: "XTLB", label: "Deal vote", date: "Jun 22", tone: "volatile" },
];

const sourceMix = [
  { label: "SEC confirmed", value: "18" },
  { label: "News tentative", value: "5" },
  { label: "Awaiting filing", value: "3" },
];

const groupSummary = [
  { label: "Earnings", value: "6", tone: "neutral" },
  { label: "Shareholder", value: "5", tone: "volatile" },
  { label: "Listing Risk", value: "4", tone: "bearish" },
  { label: "Dividends", value: "3", tone: "bullish" },
  { label: "Deals / Offering", value: "3", tone: "volatile" },
];

export default function CalendarPage() {
  return (
    <main className="calendar-page">
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
          <a className="active" href="/calendar">
            Calendar
          </a>
          <a href="#">Alerts</a>
          <a href="#">Premium</a>
        </nav>
        <label className="feed-search">
          <span>/</span>
          <input aria-label="Search calendar" placeholder="Search ticker, event type, or date" />
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

      <section className="calendar-shell">
        <div className="calendar-heading">
          <div>
            <span>Event Calendar</span>
            <h1>Upcoming market dates</h1>
            <p>May 2026 - Filing-confirmed dates first</p>
          </div>
          <div className="calendar-heading-actions">
            <button className="active" type="button">
              Today
            </button>
            <button type="button">Week</button>
            <button type="button">Month</button>
          </div>
        </div>

        <div className="calendar-stat-strip">
          {calendarStats.map((item) => (
            <section className="calendar-stat-card" key={item.label}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
              <p>{item.detail}</p>
            </section>
          ))}
        </div>

        <div className="calendar-content-grid">
          <section className="calendar-main-panel">
            <div className="calendar-filter-row">
              {filterTabs.map((tab, index) => (
                <button className={index === 0 ? "active" : ""} type="button" key={tab}>
                  {tab}
                </button>
              ))}
            </div>

            <div className="calendar-week-strip" aria-label="Calendar week">
              {weekDays.map((day) => (
                <article className={`calendar-day-card ${day.tone}`} key={`${day.label}-${day.date}`}>
                  <div>
                    <span>{day.label}</span>
                    <strong>{day.date}</strong>
                  </div>
                  <ul>
                    {day.events.map((event) => (
                      <li key={`${event.ticker}-${event.type}`}>
                        <b>{event.ticker}</b>
                        <span>{event.type}</span>
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>

            <div className="calendar-agenda">
              <div className="calendar-section-heading">
                <div>
                  <span>Agenda</span>
                  <h2>Scheduled events</h2>
                </div>
                <button type="button">Export</button>
              </div>

              {calendarEvents.map((event) => (
                <article className="calendar-event-row" key={`${event.ticker}-${event.title}`}>
                  <div className="calendar-date-cell">
                    <span>{event.weekday}</span>
                    <strong>{event.date}</strong>
                    <small>{event.time}</small>
                  </div>
                  <div className="calendar-event-icon" aria-hidden="true">
                    {iconForGroup(event.group)}
                  </div>
                  <div className="calendar-event-copy">
                    <div className="calendar-event-kicker">
                      <b>{event.ticker}</b>
                      <span>{event.source}</span>
                      <em className={`status-${event.status.toLowerCase()}`}>{event.status}</em>
                    </div>
                    <h3>{event.title}</h3>
                    <p>{event.meta}</p>
                  </div>
                  <div className="calendar-event-meta">
                    <span>{event.group}</span>
                    <b className={event.tone}>{event.tone}</b>
                    <strong>Impact {event.impact}</strong>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <aside className="calendar-sidebar">
            <section className="calendar-side-panel">
              <div className="calendar-side-heading">
                <AlertTriangle size={17} />
                <h2>High-risk dates</h2>
              </div>
              <div className="calendar-side-list">
                {highRiskDates.map((item) => (
                  <a href="#" key={`${item.ticker}-${item.date}`}>
                    <span>
                      <b>{item.ticker}</b>
                      <small>{item.label}</small>
                    </span>
                    <em className={item.tone}>{item.date}</em>
                  </a>
                ))}
              </div>
            </section>

            <section className="calendar-side-panel">
              <div className="calendar-side-heading">
                <CheckCircle2 size={17} />
                <h2>Source status</h2>
              </div>
              <div className="calendar-source-mix">
                {sourceMix.map((item) => (
                  <div key={item.label}>
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                  </div>
                ))}
              </div>
            </section>

            <section className="calendar-side-panel">
              <div className="calendar-side-heading">
                <CalendarDays size={17} />
                <h2>Groups</h2>
              </div>
              <div className="calendar-group-list">
                {groupSummary.map((item) => (
                  <button type="button" key={item.label}>
                    <span>{item.label}</span>
                    <b className={item.tone}>{item.value}</b>
                  </button>
                ))}
              </div>
            </section>

            <section className="calendar-premium-panel">
              <span>Premium</span>
              <h2>Real-time event alerts</h2>
              <p>Track filing-confirmed dates, news-sourced windows, and ticker watchlists.</p>
              <button type="button">
                Upgrade
                <ChevronRight size={15} />
              </button>
            </section>
          </aside>
        </div>
      </section>
    </main>
  );
}

function iconForGroup(group: string) {
  if (group === "Earnings") return <CalendarClock size={18} />;
  if (group === "Shareholder") return <Landmark size={18} />;
  if (group === "Dividends") return <CircleDot size={18} />;
  if (group === "Listing Risk") return <AlertTriangle size={18} />;
  if (group === "Deals / Offering") return <FileText size={18} />;
  if (group === "FDA / Clinical") return <Newspaper size={18} />;
  return <Clock3 size={18} />;
}
