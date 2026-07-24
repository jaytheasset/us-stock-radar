"use client";

import { useState } from "react";
import styles from "./MarketResultRows.module.css";

export type MarketTickerLogoProps = {
  logoUrl?: string;
  size: "desktop" | "detail" | "mobile";
  ticker: string;
};

export function MarketTickerLogo({
  logoUrl,
  size,
  ticker,
}: MarketTickerLogoProps) {
  const normalizedTicker = ticker.trim().toUpperCase();
  const defaultLogoUrl =
    normalizedTicker &&
    normalizedTicker !== "N/A" &&
    normalizedTicker !== "MARKET" &&
    /^[A-Z0-9][A-Z0-9.-]{0,14}$/.test(normalizedTicker)
      ? `/api/market/logo/${encodeURIComponent(normalizedTicker)}`
      : undefined;
  const resolvedLogoUrl = logoUrl || defaultLogoUrl;
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showLogo = Boolean(resolvedLogoUrl && failedUrl !== resolvedLogoUrl);
  const monogram = ticker.trim().slice(0, 2).toUpperCase();
  const sizeClass =
    size === "desktop"
      ? styles.tickerLogoDesktop
      : size === "detail"
        ? styles.tickerLogoDetail
        : styles.tickerLogoMobile;
  const appearanceClass = showLogo
    ? styles.tickerLogoImage
    : styles.tickerLogoFallback;

  return (
    <span
      aria-hidden="true"
      className={`${styles.tickerLogo} ${sizeClass} ${appearanceClass}`}
    >
      <span className={styles.tickerMonogram}>{monogram}</span>
      {showLogo ? (
        <img
          alt=""
          decoding="async"
          loading="lazy"
          onError={(event) => {
            event.currentTarget.style.display = "none";
            setFailedUrl(resolvedLogoUrl ?? null);
          }}
          src={resolvedLogoUrl}
        />
      ) : null}
    </span>
  );
}
