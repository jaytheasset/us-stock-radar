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
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showLogo = Boolean(logoUrl && failedUrl !== logoUrl);
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
      {showLogo ? (
        <img
          alt=""
          decoding="async"
          loading="lazy"
          onError={() => setFailedUrl(logoUrl ?? null)}
          src={logoUrl}
        />
      ) : (
        <span className={styles.tickerMonogram}>{monogram}</span>
      )}
    </span>
  );
}
