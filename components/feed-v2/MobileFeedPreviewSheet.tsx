"use client";

import type { MutableRefObject } from "react";
import { FeedMobilePreviewAd } from "@/components/feed-v2/FeedMobilePreviewAd";
import { FeedPreviewPanel } from "@/components/feed-v2/FeedPreviewPanel";
import { BottomSheetShell } from "@/components/ui/BottomSheetShell";
import type { LiveFeedV2Item } from "@/lib/liveFeedV2Contract";
import type { Plan } from "@/lib/subscriptionPolicy";
import sheetStyles from "./MobileFeedPreviewSheet.module.css";

type MobileFeedPreviewSheetProps = {
  isOpen: boolean;
  item: LiveFeedV2Item | null;
  onClose: () => void;
  openerRef: MutableRefObject<HTMLElement | null>;
  viewerPlan: Plan;
};

export function MobileFeedPreviewSheet({
  isOpen,
  item,
  onClose,
  openerRef,
  viewerPlan,
}: MobileFeedPreviewSheetProps) {
  if (!item) return null;

  const showNewsPreviewAd =
    viewerPlan === "free" && item.preview.kind !== "filing";
  const previewContent = (
    <>
      <FeedPreviewPanel item={item} variant="mobile" />
      {showNewsPreviewAd ? <FeedMobilePreviewAd /> : null}
    </>
  );

  const previewName =
    item.preview.kind === "filing"
      ? `${item.preview.formType || item.preview.ticker} filing detail`
      : item.preview.kind === "market-news"
        ? `${item.preview.theme} market news detail`
        : `${item.preview.ticker} company news detail`;

  return (
    <BottomSheetShell
      aria-label={previewName}
      closeLabel="Close event preview"
      id={`feed-v2-${item.preview.kind}-detail-sheet`}
      isOpen={isOpen}
      layout="full-scroll"
      onDismiss={onClose}
      openerRef={openerRef}
      overlayLabel="Close event preview"
      surfaceClassName={sheetStyles.previewSurface}
    >
      <div className={sheetStyles.previewScrollRegion}>{previewContent}</div>
    </BottomSheetShell>
  );
}
