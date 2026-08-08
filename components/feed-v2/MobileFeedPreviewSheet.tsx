"use client";

import type { MutableRefObject } from "react";
import { FeedPreviewAd } from "@/components/feed-v2/FeedMobilePreviewAd";
import { FeedPreviewActions } from "@/components/feed-v2/FeedPreviewActions";
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
  viewport: "mobile" | "intermediate";
  viewerPlan: Plan;
};

export function MobileFeedPreviewSheet({
  isOpen,
  item,
  onClose,
  openerRef,
  viewport,
  viewerPlan,
}: MobileFeedPreviewSheetProps) {
  if (!item) return null;

  const previewAdSize =
    viewerPlan === "free"
      ? viewport === "mobile"
        ? "320x100"
        : "300x250"
      : null;
  const previewContent = (
    <>
      <FeedPreviewPanel item={item} variant={viewport} />
      {previewAdSize ? <FeedPreviewAd size={previewAdSize} /> : null}
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
      showCloseButton={viewport === "mobile"}
      showHandle={viewport === "mobile"}
      surfaceClassName={sheetStyles.previewSurface}
      topControls={
        viewport === "mobile" ? <FeedPreviewActions preview={item.preview} /> : undefined
      }
      viewport={viewport}
    >
      {viewport === "mobile" ? (
        previewContent
      ) : (
        <div className={sheetStyles.previewScrollRegion}>{previewContent}</div>
      )}
    </BottomSheetShell>
  );
}
