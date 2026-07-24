"use client";

import { useEffect, useState } from "react";
import type { FilingsV2Record } from "@/lib/filingsV2Model";
import styles from "./StockRadarFilingsV2.module.css";

type FilingsV2MarketReactionProps = {
  record: FilingsV2Record;
};

const chartWidth = 100;
const chartHeight = 40;
const maxConcurrentMarketRequests = 4;

type MarketChartPayload = {
  ok?: boolean;
  latestPrice?: unknown;
  changePercent?: unknown;
  points?: Array<{ close?: unknown }>;
};

type MarketReaction = {
  price?: number;
  changePercent?: number;
  chartPoints: number[];
};

const marketReactionCache = new Map<string, Promise<MarketReaction | null>>();
const marketReactionQueue: Array<() => void> = [];
let activeMarketRequests = 0;

function createSparklinePoints(values: readonly number[]) {
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const range = Math.max(maximum - minimum, 1);

  return values
    .map((value, index) => {
      const x = (index / Math.max(values.length - 1, 1)) * chartWidth;
      const y = chartHeight - 4 - ((value - minimum) / range) * (chartHeight - 8);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export function FilingsV2MarketReaction({ record }: FilingsV2MarketReactionProps) {
  const [marketReaction, setMarketReaction] = useState<MarketReaction | null>(null);
  const ticker = record.ticker?.trim().toUpperCase() ?? "";
  const storedChartPoints = record.chartPoints?.filter(Number.isFinite) ?? [];

  useEffect(() => {
    if (!ticker || storedChartPoints.length >= 2) return;

    let cancelled = false;
    void getMarketReaction(ticker).then((result) => {
      if (!cancelled && result) setMarketReaction(result);
    });

    return () => {
      cancelled = true;
    };
  }, [storedChartPoints.length, ticker]);

  const price = marketReaction?.price ?? record.price;
  const changePercent = marketReaction?.changePercent ?? record.changePercent;
  const chartPoints = marketReaction?.chartPoints.length
    ? marketReaction.chartPoints
    : storedChartPoints;
  const hasPrice = Number.isFinite(price);
  const hasChange = Number.isFinite(changePercent);
  const hasChart = chartPoints.length >= 2;
  const hasQuote = hasPrice || hasChange;
  const change = changePercent ?? 0;
  const marketToneClass = hasChange
    ? change >= 0
      ? styles.bullish
      : styles.bearish
    : styles.neutral;
  const priceLabel = hasPrice ? `$${price!.toFixed(2)}` : "—";
  const changeLabel = hasChange ? `${change >= 0 ? "+" : ""}${change.toFixed(2)}%` : "—";

  return (
    <span className={styles.filingMarketReaction}>
      <span
        className={`${styles.filingPrice}${hasQuote ? "" : ` ${styles.filingPriceUnavailable}`}`}
      >
        {hasQuote ? (
          <>
            {hasPrice ? <strong>{priceLabel}</strong> : null}
            {hasChange ? <span className={marketToneClass}>{changeLabel}</span> : null}
          </>
        ) : (
          <span className={styles.filingDataUnavailable} title="Quote unavailable">
            <span aria-hidden="true">—</span>
            <span className={styles.visuallyHidden}>Quote unavailable</span>
          </span>
        )}
      </span>
      {hasChart ? (
        <svg
          aria-label={`${record.ticker ?? record.company} market trend`}
          className={`${styles.filingSparkline} ${marketToneClass}`}
          preserveAspectRatio="none"
          role="img"
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
        >
          <polyline points={createSparklinePoints(chartPoints)} />
        </svg>
      ) : (
        <span
          className={`${styles.filingSparkline} ${styles.filingDataUnavailable} ${styles.filingSparklineUnavailable}`}
          title="Chart unavailable"
        >
          <span aria-hidden="true">—</span>
          <span className={styles.visuallyHidden}>Chart unavailable</span>
        </span>
      )}
    </span>
  );
}

function getMarketReaction(ticker: string) {
  const cached = marketReactionCache.get(ticker);
  if (cached) return cached;

  const request = scheduleMarketRequest(() => fetchMarketReaction(ticker));
  marketReactionCache.set(ticker, request);
  return request;
}

function scheduleMarketRequest<T>(task: () => Promise<T>) {
  return new Promise<T>((resolve) => {
    const run = () => {
      activeMarketRequests += 1;
      task()
        .then(resolve)
        .finally(() => {
          activeMarketRequests -= 1;
          marketReactionQueue.shift()?.();
        });
    };

    if (activeMarketRequests < maxConcurrentMarketRequests) run();
    else marketReactionQueue.push(run);
  });
}

async function fetchMarketReaction(ticker: string): Promise<MarketReaction | null> {
  try {
    const response = await fetch(
      `/api/market/chart?symbol=${encodeURIComponent(ticker)}&range=1D&soft=1`,
      { cache: "force-cache" },
    );
    if (!response.ok) return null;

    const payload = await response.json() as MarketChartPayload;
    if (payload.ok !== true) return null;

    const price = Number(payload.latestPrice);
    const changePercent = Number(payload.changePercent);
    const chartPoints = Array.isArray(payload.points)
      ? payload.points
        .map((point) => Number(point.close))
        .filter(Number.isFinite)
      : [];

    if (!Number.isFinite(price) && !Number.isFinite(changePercent) && chartPoints.length < 2) {
      return null;
    }

    return {
      price: Number.isFinite(price) ? price : undefined,
      changePercent: Number.isFinite(changePercent) ? changePercent : undefined,
      chartPoints,
    };
  } catch {
    return null;
  }
}
