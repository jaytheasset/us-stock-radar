"use client";

import {
  useEffect,
  useRef,
  type MutableRefObject,
} from "react";
import { X } from "lucide-react";
import { FeedPreviewPanel } from "@/components/feed-v2/FeedPreviewPanel";
import { IconButton } from "@/components/ui/IconButton";
import type { LiveFeedV2Item } from "@/lib/liveFeedV2Contract";
import styles from "./StockRadarFeedV2.module.css";

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
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      openerRef.current?.focus();
    };
  }, [isOpen, onClose, openerRef]);

  if (!isOpen || !item) return null;

  return (
    <div className={styles.sheetLayer}>
      <button
        aria-label="Close event preview"
        className={styles.sheetBackdrop}
        onClick={onClose}
        type="button"
      />
      <section
        aria-label={`${item.ticker} event preview`}
        aria-modal="true"
        className={styles.mobileSheet}
        role="dialog"
      >
        <div className={styles.sheetHandle} />
        <IconButton
          aria-label="Close event preview"
          className={styles.sheetClose}
          onClick={onClose}
          ref={closeButtonRef}
        >
          <X aria-hidden="true" size={18} />
        </IconButton>
        <FeedPreviewPanel item={item} variant="mobile" />
      </section>
    </div>
  );
}
