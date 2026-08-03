import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          alignItems: "center",
          background: "#0d1014",
          border: "7px solid #2c333a",
          borderRadius: 38,
          color: "#f5f6f7",
          display: "flex",
          fontFamily: "Arial, sans-serif",
          fontSize: 70,
          fontWeight: 800,
          height: "100%",
          justifyContent: "center",
          letterSpacing: -7,
          position: "relative",
          width: "100%",
        }}
      >
        <span>SR</span>
        <span
          style={{
            background: "#ff7a1a",
            borderRadius: 999,
            height: 14,
            position: "absolute",
            right: 27,
            top: 27,
            width: 14,
          }}
        />
      </div>
    ),
    size,
  );
}
