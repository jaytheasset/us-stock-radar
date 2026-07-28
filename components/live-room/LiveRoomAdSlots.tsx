import { AdSenseSlot } from "@/components/ads/AdSenseSlot";
import styles from "./LiveRoom.module.css";

type LiveRoomAdSlotProps = {
  enabledForViewer: boolean;
};

export function LiveRoomRailAdSlot({
  enabledForViewer,
}: LiveRoomAdSlotProps) {
  if (!enabledForViewer) return null;

  return (
    <div className={styles.desktopRailAd}>
      <AdSenseSlot
        enabledForViewer={enabledForViewer}
        format="fixed"
        height={250}
        inventory="live-room-rail-300x250"
        mediaQuery="(min-width: 1181px)"
        placeholderSize="300 × 250"
        width={300}
      />
    </div>
  );
}

export function LiveRoomMobileInlineAdSlot({
  enabledForViewer,
}: LiveRoomAdSlotProps) {
  if (!enabledForViewer) return null;

  return (
    <div className={styles.mobileInlineAd}>
      <AdSenseSlot
        enabledForViewer={enabledForViewer}
        format="fixed"
        height={50}
        inventory="live-room-mobile-inline"
        mediaQuery="(max-width: 760px)"
        mobileHeight={50}
        mobileWidth={320}
        placeholderSize="320 × 50"
        showRemoveAdsLink={false}
        width={320}
      />
    </div>
  );
}
