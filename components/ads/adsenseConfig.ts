export const adSenseInventories = [
  "news-rail-300x250",
  "news-rail-300x600",
  "news-desktop-inline",
  "news-mobile-inline",
  "filings-rail-300x250",
  "filings-rail-300x600",
  "filings-desktop-inline",
  "filings-mobile-inline",
  "analysis-signal-companion",
  "analysis-collapsed-rail-inline",
  "feed-rail-300x250",
  "feed-desktop-inline",
  "feed-mobile-inline",
  "dashboard-rail",
  "dashboard-desktop-inline",
  "dashboard-mobile-inline",
  "alerts-rail-300x250",
  "alerts-rail-300x600",
] as const;

export type AdSenseInventory = (typeof adSenseInventories)[number];

type AdSenseSlotIds = Record<AdSenseInventory, string>;
type AdSenseManualSlotState = Record<AdSenseInventory, boolean>;

export type AdSenseConfigInput = {
  anchorEnabled?: string;
  nodeEnv?: string;
  publisherId?: string;
  slotIds?: Partial<AdSenseSlotIds>;
};

export type AdSenseConfig = {
  anchorEnabled: boolean;
  isProductionPublisher: boolean;
  manualSlotEnabled: AdSenseManualSlotState;
  publisherId: string;
  publisherScriptEnabled: boolean;
  slotIds: AdSenseSlotIds;
};

function normalize(value?: string) {
  return value?.trim() || "";
}

export function resolveAdSenseConfig(input: AdSenseConfigInput): AdSenseConfig {
  const publisherId = normalize(input.publisherId);
  const slotIds: AdSenseSlotIds = {
    "news-rail-300x250": normalize(input.slotIds?.["news-rail-300x250"]),
    "news-rail-300x600": normalize(input.slotIds?.["news-rail-300x600"]),
    "news-desktop-inline": normalize(input.slotIds?.["news-desktop-inline"]),
    "news-mobile-inline": normalize(input.slotIds?.["news-mobile-inline"]),
    "filings-rail-300x250": normalize(input.slotIds?.["filings-rail-300x250"]),
    "filings-rail-300x600": normalize(input.slotIds?.["filings-rail-300x600"]),
    "filings-desktop-inline": normalize(input.slotIds?.["filings-desktop-inline"]),
    "filings-mobile-inline": normalize(input.slotIds?.["filings-mobile-inline"]),
    "analysis-signal-companion": normalize(
      input.slotIds?.["analysis-signal-companion"],
    ),
    "analysis-collapsed-rail-inline": normalize(
      input.slotIds?.["analysis-collapsed-rail-inline"],
    ),
    "feed-rail-300x250": normalize(
      input.slotIds?.["feed-rail-300x250"],
    ),
    "feed-desktop-inline": normalize(
      input.slotIds?.["feed-desktop-inline"],
    ),
    "feed-mobile-inline": normalize(
      input.slotIds?.["feed-mobile-inline"],
    ),
    "dashboard-rail": normalize(input.slotIds?.["dashboard-rail"]),
    "dashboard-desktop-inline": normalize(
      input.slotIds?.["dashboard-desktop-inline"],
    ),
    "dashboard-mobile-inline": normalize(
      input.slotIds?.["dashboard-mobile-inline"],
    ),
    "alerts-rail-300x250": normalize(
      input.slotIds?.["alerts-rail-300x250"],
    ),
    "alerts-rail-300x600": normalize(
      input.slotIds?.["alerts-rail-300x600"],
    ),
  };
  const isProductionPublisher =
    input.nodeEnv === "production" && Boolean(publisherId);
  const anchorEnabled =
    isProductionPublisher && normalize(input.anchorEnabled).toLowerCase() === "true";
  const manualSlotEnabled: AdSenseManualSlotState = {
    "news-rail-300x250":
      isProductionPublisher && Boolean(slotIds["news-rail-300x250"]),
    "news-rail-300x600":
      isProductionPublisher && Boolean(slotIds["news-rail-300x600"]),
    "news-desktop-inline":
      isProductionPublisher && Boolean(slotIds["news-desktop-inline"]),
    "news-mobile-inline":
      isProductionPublisher && Boolean(slotIds["news-mobile-inline"]),
    "filings-rail-300x250":
      isProductionPublisher && Boolean(slotIds["filings-rail-300x250"]),
    "filings-rail-300x600":
      isProductionPublisher && Boolean(slotIds["filings-rail-300x600"]),
    "filings-desktop-inline":
      isProductionPublisher && Boolean(slotIds["filings-desktop-inline"]),
    "filings-mobile-inline":
      isProductionPublisher && Boolean(slotIds["filings-mobile-inline"]),
    "analysis-signal-companion":
      isProductionPublisher && Boolean(slotIds["analysis-signal-companion"]),
    "analysis-collapsed-rail-inline":
      isProductionPublisher &&
      Boolean(slotIds["analysis-collapsed-rail-inline"]),
    "feed-rail-300x250":
      isProductionPublisher && Boolean(slotIds["feed-rail-300x250"]),
    "feed-desktop-inline":
      isProductionPublisher && Boolean(slotIds["feed-desktop-inline"]),
    "feed-mobile-inline":
      isProductionPublisher && Boolean(slotIds["feed-mobile-inline"]),
    "dashboard-rail":
      isProductionPublisher && Boolean(slotIds["dashboard-rail"]),
    "dashboard-desktop-inline":
      isProductionPublisher && Boolean(slotIds["dashboard-desktop-inline"]),
    "dashboard-mobile-inline":
      isProductionPublisher && Boolean(slotIds["dashboard-mobile-inline"]),
    "alerts-rail-300x250":
      isProductionPublisher && Boolean(slotIds["alerts-rail-300x250"]),
    "alerts-rail-300x600":
      isProductionPublisher && Boolean(slotIds["alerts-rail-300x600"]),
  };

  return {
    anchorEnabled,
    isProductionPublisher,
    manualSlotEnabled,
    publisherId,
    publisherScriptEnabled:
      anchorEnabled || Object.values(manualSlotEnabled).some(Boolean),
    slotIds,
  };
}

export const adsenseConfig = resolveAdSenseConfig({
  anchorEnabled: process.env.NEXT_PUBLIC_ADSENSE_ANCHOR_ENABLED,
  nodeEnv: process.env.NODE_ENV,
  publisherId: process.env.NEXT_PUBLIC_ADSENSE_PUBLISHER_ID,
  slotIds: {
    "news-rail-300x250":
      process.env.NEXT_PUBLIC_ADSENSE_NEWS_V2_RAIL_300X250_SLOT_ID,
    "news-rail-300x600":
      process.env.NEXT_PUBLIC_ADSENSE_NEWS_V2_RAIL_300X600_SLOT_ID,
    "news-desktop-inline":
      process.env.NEXT_PUBLIC_ADSENSE_NEWS_V2_DESKTOP_INLINE_SLOT_ID,
    "news-mobile-inline":
      process.env.NEXT_PUBLIC_ADSENSE_NEWS_V2_MOBILE_INLINE_SLOT_ID,
    "filings-rail-300x250":
      process.env.NEXT_PUBLIC_ADSENSE_FILINGS_RAIL_300X250_SLOT_ID,
    "filings-rail-300x600":
      process.env.NEXT_PUBLIC_ADSENSE_FILINGS_RAIL_300X600_SLOT_ID,
    "filings-desktop-inline":
      process.env.NEXT_PUBLIC_ADSENSE_FILINGS_DESKTOP_INLINE_SLOT_ID,
    "filings-mobile-inline":
      process.env.NEXT_PUBLIC_ADSENSE_FILINGS_MOBILE_INLINE_SLOT_ID,
    "analysis-signal-companion":
      process.env.NEXT_PUBLIC_ADSENSE_ANALYSIS_SIGNAL_COMPANION_SLOT_ID,
    "analysis-collapsed-rail-inline":
      process.env.NEXT_PUBLIC_ADSENSE_ANALYSIS_COLLAPSED_RAIL_INLINE_SLOT_ID,
    "feed-rail-300x250":
      process.env.NEXT_PUBLIC_ADSENSE_FEED_RAIL_300X250_SLOT_ID,
    "feed-desktop-inline":
      process.env.NEXT_PUBLIC_ADSENSE_FEED_DESKTOP_INLINE_SLOT_ID,
    "feed-mobile-inline":
      process.env.NEXT_PUBLIC_ADSENSE_FEED_MOBILE_INLINE_SLOT_ID,
    "dashboard-rail": process.env.NEXT_PUBLIC_ADSENSE_DASHBOARD_V2_RAIL_SLOT_ID,
    "dashboard-desktop-inline":
      process.env.NEXT_PUBLIC_ADSENSE_DASHBOARD_V2_DESKTOP_INLINE_SLOT_ID,
    "dashboard-mobile-inline":
      process.env.NEXT_PUBLIC_ADSENSE_DASHBOARD_V2_MOBILE_INLINE_SLOT_ID,
    "alerts-rail-300x250":
      process.env.NEXT_PUBLIC_ADSENSE_ALERTS_RAIL_300X250_SLOT_ID,
    "alerts-rail-300x600":
      process.env.NEXT_PUBLIC_ADSENSE_ALERTS_RAIL_300X600_SLOT_ID,
  },
});
