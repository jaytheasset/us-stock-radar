"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import styles from "./AdSenseSlot.module.css";

type AdSenseInventory =
  | "news-rail-300x250"
  | "news-rail-300x600"
  | "news-desktop-inline"
  | "news-mobile-inline";

type AdSenseWindow = Window & {
  adsbygoogle?: Array<Record<string, never>>;
};

type AdSenseSlotProps = {
  className?: string;
  format?: "fixed" | "horizontal";
  height: number;
  inventory: AdSenseInventory;
  mediaQuery: string;
  placeholderSize: string;
  width: number;
};

const publisherId = process.env.NEXT_PUBLIC_ADSENSE_PUBLISHER_ID?.trim() || "";
const slotIds: Record<AdSenseInventory, string> = {
  "news-rail-300x250":
    process.env.NEXT_PUBLIC_ADSENSE_NEWS_V2_RAIL_300X250_SLOT_ID?.trim() || "",
  "news-rail-300x600":
    process.env.NEXT_PUBLIC_ADSENSE_NEWS_V2_RAIL_300X600_SLOT_ID?.trim() || "",
  "news-desktop-inline":
    process.env.NEXT_PUBLIC_ADSENSE_NEWS_V2_DESKTOP_INLINE_SLOT_ID?.trim() || "",
  "news-mobile-inline":
    process.env.NEXT_PUBLIC_ADSENSE_NEWS_V2_MOBILE_INLINE_SLOT_ID?.trim() || "",
};
const hasCompleteAdSenseConfiguration =
  Boolean(publisherId) && Object.values(slotIds).every(Boolean);
const isAdSenseEnabled =
  process.env.NODE_ENV === "production" && hasCompleteAdSenseConfiguration;
const scriptId = "google-adsense-script";
let scriptLoadPromise: Promise<void> | null = null;

function loadAdSenseScript() {
  if (scriptLoadPromise) return scriptLoadPromise;

  scriptLoadPromise = new Promise<void>((resolve, reject) => {
    const existingScript = document.getElementById(scriptId) as HTMLScriptElement | null;
    if (existingScript) {
      if ((window as AdSenseWindow).adsbygoogle) {
        resolve();
        return;
      }

      existingScript.addEventListener("load", () => resolve(), { once: true });
      existingScript.addEventListener(
        "error",
        () => reject(new Error("AdSense script failed to load.")),
        { once: true },
      );
      return;
    }

    const script = document.createElement("script");
    script.id = scriptId;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.src =
      "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js" +
      `?client=${encodeURIComponent(publisherId)}`;
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener(
      "error",
      () => reject(new Error("AdSense script failed to load.")),
      { once: true },
    );
    document.head.appendChild(script);
  }).catch((error) => {
    scriptLoadPromise = null;
    throw error;
  });

  return scriptLoadPromise;
}

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
  const slotId = slotIds[inventory];
  const canRequestAd = isAdSenseEnabled && isMediaActive;
  const slotStyle = {
    "--adsense-slot-height": `${height}px`,
    "--adsense-slot-width": `${width}px`,
  } as CSSProperties;

  useEffect(() => {
    if (!isAdSenseEnabled) return;

    const media = window.matchMedia(mediaQuery);
    const updateMediaState = () => setIsMediaActive(media.matches);
    updateMediaState();
    media.addEventListener("change", updateMediaState);

    return () => media.removeEventListener("change", updateMediaState);
  }, [mediaQuery]);

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
        void loadAdSenseScript()
          .then(() => {
            if (isDisposed || hasPushedRef.current || !container.isConnected) return;

            const currentBounds = container.getBoundingClientRect();
            if (currentBounds.width <= 0 || currentBounds.height <= 0) {
              requestStartedRef.current = false;
              return;
            }

            const adsbygoogleWindow = window as AdSenseWindow;
            adsbygoogleWindow.adsbygoogle = adsbygoogleWindow.adsbygoogle || [];
            hasPushedRef.current = true;
            adsbygoogleWindow.adsbygoogle.push({});
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
          data-ad-client={publisherId}
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
