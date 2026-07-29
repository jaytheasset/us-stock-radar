"use client";

import { useEffect } from "react";
import { adsenseConfig } from "@/components/ads/adsenseConfig";
import { loadAdSenseScript } from "@/components/ads/adsenseScriptLoader";

type AdSensePublisherLoaderProps = {
  enabledForViewer: boolean;
};

export function AdSensePublisherLoader({
  enabledForViewer,
}: AdSensePublisherLoaderProps) {
  const shouldLoadAnchorScript =
    enabledForViewer && adsenseConfig.anchorEnabled;

  useEffect(() => {
    if (!shouldLoadAnchorScript) return;

    void loadAdSenseScript(adsenseConfig.publisherId, {
      bottomAnchorEnabled: adsenseConfig.anchorEnabled,
    }).catch(() => undefined);
  }, [shouldLoadAnchorScript]);

  return null;
}
