export const adSenseInventories = [
  "news-rail-300x250",
  "news-rail-300x600",
  "news-desktop-inline",
  "news-mobile-inline",
  "filings-rail-300x250",
  "filings-rail-300x600",
  "filings-desktop-inline",
  "filings-mobile-inline",
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
  },
});
