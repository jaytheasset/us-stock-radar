export const ADSENSE_SCRIPT_ID = "google-adsense-script";
export const ADSENSE_SCRIPT_ORIGIN =
  "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js";

declare global {
  interface Window {
    adsbygoogle?: Array<Record<string, never>>;
    __stockRadarAdSenseScriptPromise?: Promise<void>;
  }
}

export function loadAdSenseScript(publisherId: string) {
  if (
    !publisherId ||
    typeof window === "undefined" ||
    typeof document === "undefined"
  ) {
    return Promise.reject(new Error("AdSense publisher configuration is unavailable."));
  }

  if (window.__stockRadarAdSenseScriptPromise) {
    return window.__stockRadarAdSenseScriptPromise;
  }

  const scriptPromise = new Promise<void>((resolve, reject) => {
    const existingScript = document.getElementById(
      ADSENSE_SCRIPT_ID,
    ) as HTMLScriptElement | null;

    if (existingScript) {
      if (
        window.adsbygoogle ||
        existingScript.dataset.adsenseLoaderState === "loaded"
      ) {
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
    script.id = ADSENSE_SCRIPT_ID;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.src = `${ADSENSE_SCRIPT_ORIGIN}?client=${encodeURIComponent(publisherId)}`;
    script.addEventListener(
      "load",
      () => {
        script.dataset.adsenseLoaderState = "loaded";
        resolve();
      },
      { once: true },
    );
    script.addEventListener(
      "error",
      () => {
        script.dataset.adsenseLoaderState = "failed";
        reject(new Error("AdSense script failed to load."));
      },
      { once: true },
    );
    document.head.appendChild(script);
  });

  window.__stockRadarAdSenseScriptPromise = scriptPromise;
  return scriptPromise;
}
