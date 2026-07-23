"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  adsenseConfig,
  type AdSenseInventory,
} from "@/components/ads/adsenseConfig";
import { loadAdSenseScript } from "@/components/ads/adsenseScriptLoader";
import styles from "./AdSenseSlot.module.css";

type AdSenseSlotProps = {
  className?: string;
  format?: "fixed" | "horizontal";
  height: number;
  inventory: AdSenseInventory;
  mediaQuery: string;
  placeholderSize: string;
  width: number;
};

export function AdSenseSlot({
  className,
  format = "fixed",
  height,
  inventory,
  mediaQuery,
  placeholderSize,
  width,
}: AdSenseSlotProps) {
  const containerRef = useRef<HTMLElement | null>(null);
  const requestStartedRef = useRef(false);
  const hasPushedRef = useRef(false);
  const [isMediaActive, setIsMediaActive] = useState(false);
  const slotId = adsenseConfig.slotIds[inventory];
  const isManualSlotEnabled = adsenseConfig.manualSlotEnabled[inventory];
  const canRequestAd = isManualSlotEnabled && isMediaActive;
  const slotStyle = {
    "--adsense-slot-height": `${height}px`,
    "--adsense-slot-width": `${width}px`,
  } as CSSProperties;

  useEffect(() => {
    if (!isManualSlotEnabled) return;

    const media = window.matchMedia(mediaQuery);
    const updateMediaState = () => setIsMediaActive(media.matches);
    updateMediaState();
    media.addEventListener("change", updateMediaState);

    return () => media.removeEventListener("change", updateMediaState);
  }, [isManualSlotEnabled, mediaQuery]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !canRequestAd || hasPushedRef.current) return;

    let isDisposed = false;
    const observer = new IntersectionObserver(
      (entries) => {
        const isNearViewport = entries.some((entry) => entry.isIntersecting);
        if (!isNearViewport || requestStartedRef.current || hasPushedRef.current) return;

        const { width: renderedWidth, height: renderedHeight } =
          container.getBoundingClientRect();
        if (renderedWidth <= 0 || renderedHeight <= 0) return;

        requestStartedRef.current = true;
        void loadAdSenseScript(adsenseConfig.publisherId)
          .then(() => {
            if (isDisposed || hasPushedRef.current || !container.isConnected) return;

            const currentBounds = container.getBoundingClientRect();
            if (currentBounds.width <= 0 || currentBounds.height <= 0) {
              requestStartedRef.current = false;
              return;
            }

            window.adsbygoogle = window.adsbygoogle || [];
            hasPushedRef.current = true;
            window.adsbygoogle.push({});
            observer.disconnect();
          })
          .catch(() => {
            requestStartedRef.current = false;
          });
      },
      { rootMargin: "800px 0px" },
    );

    observer.observe(container);
    return () => {
      isDisposed = true;
      observer.disconnect();
      if (!hasPushedRef.current) requestStartedRef.current = false;
    };
  }, [canRequestAd]);

  return (
    <section
      aria-label="Advertisement"
      className={[styles.slot, className].filter(Boolean).join(" ")}
      ref={containerRef}
      style={slotStyle}
    >
      {canRequestAd ? (
        <ins
          className={`adsbygoogle ${styles.ad}`}
          data-ad-client={adsenseConfig.publisherId}
          data-ad-format={format === "horizontal" ? "horizontal" : undefined}
          data-ad-slot={slotId}
          data-full-width-responsive={format === "horizontal" ? "true" : undefined}
        />
      ) : (
        <>
          <span className={styles.placeholderLabel}>Advertisement</span>
          <span className={styles.placeholderSize}>{placeholderSize}</span>
        </>
      )}
    </section>
  );
}
