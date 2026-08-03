import { ImageResponse } from "next/og";

export const alt = "US Stock Radar market intelligence dashboard";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          background: "#080a0d",
          color: "#f5f6f7",
          display: "flex",
          flexDirection: "column",
          fontFamily: "Arial, sans-serif",
          height: "100%",
          justifyContent: "space-between",
          padding: "72px 84px",
          position: "relative",
          width: "100%",
        }}
      >
        <div
          style={{
            border: "2px solid #20262c",
            borderRadius: 36,
            bottom: 34,
            display: "flex",
            left: 34,
            position: "absolute",
            right: 34,
            top: 34,
          }}
        />
        <div style={{ alignItems: "center", display: "flex", gap: 20 }}>
          <div
            style={{
              alignItems: "center",
              background: "#0d1014",
              border: "3px solid #2c333a",
              borderRadius: 22,
              display: "flex",
              fontSize: 42,
              fontWeight: 800,
              height: 92,
              justifyContent: "center",
              letterSpacing: -4,
              position: "relative",
              width: 92,
            }}
          >
            SR
            <span
              style={{
                background: "#ff7a1a",
                borderRadius: 999,
                height: 11,
                position: "absolute",
                right: 12,
                top: 12,
                width: 11,
              }}
            />
          </div>
          <span style={{ color: "#c0c5cc", fontSize: 34, fontWeight: 700 }}>
            US Stock Radar
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 24, maxWidth: 930 }}>
          <div style={{ fontSize: 72, fontWeight: 800, letterSpacing: -3, lineHeight: 1.05 }}>
            See what is moving U.S. stocks.
          </div>
          <div style={{ color: "#aeb5be", fontSize: 30, lineHeight: 1.35 }}>
            Market movers, company news, SEC filings, calendars, watchlists, and alerts in one investor-focused radar.
          </div>
        </div>

        <div style={{ alignItems: "center", color: "#8a929d", display: "flex", fontSize: 23, gap: 18 }}>
          <span style={{ background: "#ff7a1a", borderRadius: 999, height: 10, width: 10 }} />
          us-stock-radar.com
        </div>
      </div>
    ),
    size,
  );
}
