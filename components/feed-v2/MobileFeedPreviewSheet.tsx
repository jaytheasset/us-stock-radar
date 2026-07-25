"use client";

import type { MutableRefObject } from "react";
import { FeedPreviewPanel } from "@/components/feed-v2/FeedPreviewPanel";
import { BottomSheetShell } from "@/components/ui/BottomSheetShell";
import type { LiveFeedV2Item } from "@/lib/liveFeedV2Contract";

type MobileFeedPreviewSheetProps = {
  isOpen: boolean;
  item: LiveFeedV2Item | null;
  onClose: () => void;
  openerRef: MutableRefObject<HTMLElement | null>;
};

export function MobileFeedPreviewSheet({
  isOpen,
  item,
  onClose,
  openerRef,
}: MobileFeedPreviewSheetProps) {
  if (!item) return null;

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
    >
      <FeedPreviewPanel item={item} variant="mobile" />
    </BottomSheetShell>
  );
}
