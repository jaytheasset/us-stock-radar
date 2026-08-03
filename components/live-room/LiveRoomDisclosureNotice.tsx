import Link from "next/link";
import styles from "./LiveRoomDisclosureNotice.module.css";

export const LIVE_ROOM_DISCLOSURE_TEXT =
  "User posts and verified trades are not endorsed by Stock Radar and are not investment advice. Verify independently.";

export function LiveRoomDisclosureNotice({
  hideOnMobile = false,
}: {
  hideOnMobile?: boolean;
}) {
  return (
    <p className={styles.notice} data-mobile-hidden={hideOnMobile || undefined}>
      <span>{LIVE_ROOM_DISCLOSURE_TEXT}</span>{" "}
      <Link href="/terms#live-room-community-disclosures">
        Disclosures
      </Link>
    </p>
  );
}
