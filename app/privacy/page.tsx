import Link from "next/link";

export default function PrivacyPage() {
  return (
    <main style={{ minHeight: "100vh", background: "#ffffff", color: "#061633", padding: "48px 20px" }}>
      <section style={{ width: "min(760px, 100%)", margin: "0 auto" }}>
        <Link className="brand-lockup" href="/feed" aria-label="US Stock Radar feed">
          <span className="brand-mark">SR</span>
          <span>US Stock Radar</span>
        </Link>
        <div style={{ marginTop: 42, borderTop: "1px solid #d9e3f3", paddingTop: 32 }}>
          <p style={{ margin: "0 0 10px", color: "#0f55ff", fontSize: 12, fontWeight: 800, textTransform: "uppercase" }}>
            Legal
          </p>
          <h1 style={{ margin: 0, fontSize: 40, lineHeight: 1.1 }}>Privacy Policy</h1>
          <p style={{ marginTop: 18, color: "#4f607f", fontSize: 16, lineHeight: 1.6 }}>
            This page will be updated as the service evolves. STOCK RADAR uses account data such as your email address,
            watchlist tickers, alert settings, and Market Discovery category choices to save your personalized experience.
          </p>
          <p style={{ color: "#4f607f", fontSize: 16, lineHeight: 1.6 }}>
            If you connect Telegram alerts, your Telegram chat ID is used only to deliver alerts you choose to receive.
            You can disconnect or disable Telegram alerts from your alert settings.
          </p>
          <p style={{ color: "#4f607f", fontSize: 16, lineHeight: 1.6 }}>
            We do not sell your personal watchlist, alert settings, or Telegram delivery identifiers.
          </p>
          <Link style={{ color: "#0f55ff", fontWeight: 800, textDecoration: "none" }} href="/signup">
            Back to signup
          </Link>
        </div>
      </section>
    </main>
  );
}
