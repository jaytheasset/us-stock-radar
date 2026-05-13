import type { RankedEvent } from "@/lib/radarRankings";

type RankingLandingProps = {
  title: string;
  eyebrow: string;
  description: string;
  items: RankedEvent[];
};

export function RankingLanding({ title, eyebrow, description, items }: RankingLandingProps) {
  return (
    <main className="ranking-page">
      <header className="ranking-nav">
        <a className="brand-lockup" href="/feed" aria-label="US Stock Radar feed">
          <span className="brand-mark">SR</span>
          <span>STOCK RADAR</span>
        </a>
        <nav className="feed-nav-links ranking-links" aria-label="Primary">
          <a href="/feed">Live Feed</a>
          <a className={title.includes("News") ? "active" : ""} href="/news">
            News
          </a>
          <a className={title.includes("Filings") ? "active" : ""} href="/filings">
            Filings
          </a>
          <a href="#">Alerts</a>
          <a href="#">Premium</a>
        </nav>
      </header>

      <section className="ranking-shell">
        <div className="ranking-heading">
          <div>
            <span>{eyebrow}</span>
            <h1>{title}</h1>
            <p>{description}</p>
          </div>
          <a className="text-link" href="/feed">
            Back to Feed
          </a>
        </div>

        <div className="ranking-table">
          {items.length ? (
            items.map((item, index) => (
              <article className="ranking-row" key={`${item.ticker}-${item.title}`}>
                <div className="ranking-number">{index + 1}</div>
                <RankingQuote item={item} />
                <div className="ranking-copy">
                  <strong>{item.ticker}</strong>
                  <h2>{item.title}</h2>
                  <p>
                    {item.source} - {item.eventType} - {item.time}
                  </p>
                </div>
                <div className="ranking-score">
                  <span>Score</span>
                  <strong>{item.score}</strong>
                  <em className={item.signal}>{item.signal}</em>
                </div>
              </article>
            ))
          ) : (
            <div className="ranking-empty-state">No matching events yet.</div>
          )}
        </div>
      </section>
    </main>
  );
}

function RankingQuote({ item }: { item: RankedEvent }) {
  const tone = item.change.startsWith("-") ? "bearish" : "bullish";
  const direction = tone === "bearish" ? "down" : "up";
  const percent = item.change.replace(/^[+-]/, "");

  return (
    <div className={`sidebar-quote ranking-quote ${tone}`}>
      <strong>{item.price}</strong>
      <span>
        <span aria-hidden="true">{direction === "down" ? "↓" : "↑"}</span> {item.changeAmount} ({percent})
      </span>
      <small>Updated: {item.updatedAt}</small>
    </div>
  );
}
