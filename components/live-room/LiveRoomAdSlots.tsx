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
        format="responsive"
        height={250}
        inventory="live-room-rail-300x250"
        mediaQuery="(min-width: 1181px)"
        placeholderSize="Responsive display"
        width={336}
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
        format="responsive"
        height={100}
        inventory="live-room-mobile-inline"
        mediaQuery="(max-width: 760px)"
        mobileHeight={100}
        mobileWidth={320}
        placeholderSize="Responsive display"
        width={480}
      />
    </div>
  );
}
