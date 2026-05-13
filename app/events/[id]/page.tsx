import Link from "next/link";
import { notFound } from "next/navigation";
import { feedItems, getFeedItem } from "@/lib/feedMock";
import { getLiveEventDetail } from "@/lib/liveFeed";

export const dynamic = "force-dynamic";

export function generateStaticParams() {
  return feedItems.map((item) => ({ id: item.id }));
}

export default async function EventDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const mockEvent = getFeedItem(id);
  const liveEvent = mockEvent ? null : await getLiveEventDetail(id);
  const event = mockEvent || liveEvent?.item;

  if (!event) notFound();

  return (
    <main className="event-detail-page">
      <header className="detail-nav">
        <Link className="brand-lockup" href="/feed" aria-label="Back to live feed">
          <span className="brand-mark">SR</span>
          <span>STOCK RADAR</span>
        </Link>
        <Link className="text-link" href="/feed">
          Live Feed
        </Link>
      </header>

      <div className="detail-layout">
        <article className="detail-main">
          <div className="detail-ad-slot top">Responsive ad slot</div>

          <section className="detail-hero">
            <div className="detail-badges">
              <span className={`source-badge ${event.sourceGroup}`}>{event.sourceGroup}</span>
              <span className={`signal-badge ${event.signal}`}>{event.signal}</span>
              <span className={`delivery-badge ${event.deliveryLevel}`}>{event.deliveryLevel}</span>
            </div>
            <h1>{event.title}</h1>
            <p>{event.summary}</p>
          </section>

          <section className="detail-section">
            <h2>Key Takeaway</h2>
            <p>{event.scoreReason}</p>
          </section>

          <section className="detail-metrics" aria-label="Event details">
            <Metric label="Ticker" value={event.ticker} />
            <Metric label="Source" value={event.source} />
            <Metric label="Event Type" value={event.eventType} />
            <Metric label="Score" value={String(event.score)} />
            <Metric label="Impact" value={event.impact} />
            <Metric label="Detected" value={event.time} />
          </section>

          <div className="detail-ad-slot inline">In-article responsive ad slot</div>

          <section className="detail-section">
            <h2>Analysis Shell</h2>
            <p>
              Full article text, filing extraction, AI analysis, related events, and source links
              will be connected here after the DB pipeline is wired.
            </p>
          </section>

          <section className="detail-section">
            <h2>Related Events</h2>
            <div className="related-shell">
              <span>Related news</span>
              <span>Related filings</span>
              <span>Market context</span>
            </div>
          </section>
        </article>

        <aside className="detail-sidebar">
          <div className="detail-ad-slot rail">Sidebar responsive ad slot</div>
          <section className="detail-side-panel">
            <h2>Market Context</h2>
            <Metric label="Price" value={event.price} />
            <Metric label="Change" value={event.change} />
            <Metric label="Signal" value={event.signal} />
          </section>
          <section className="detail-side-panel">
            <h2>Next Actions</h2>
            <Link href="/feed">Back to Live Feed</Link>
            <a href="#">Open source</a>
          </section>
        </aside>
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
