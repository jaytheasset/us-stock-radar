import Link from "next/link";
import { Hash } from "lucide-react";
import {
  getCommunityFocusTagLabel,
  getCommunityLanguageLabel,
  getCommunityRoomIndustryLabel,
  getCommunityRoomStyleLabel,
  getCommunityRoomThemeLabel,
  getCommunityTopicLabel,
  type CommunityRoom,
} from "@/lib/live-room/community";
import styles from "./LiveRoom.module.css";

export function CommunityRoomAbout({
  compact = false,
  room,
}: {
  compact?: boolean;
  room: CommunityRoom;
}) {
  return (
    <div
      className={styles.communityAbout}
      data-compact={compact ? "true" : undefined}
    >
      <div>
        <h2>About this room</h2>
        <p>{room.summary}</p>
      </div>
      <div
        aria-label="Room classification"
        className={styles.communityAboutMeta}
      >
        <span>{getCommunityTopicLabel(room.topic)}</span>
        <span>{getCommunityRoomStyleLabel(room.roomStyle)}</span>
        <span>{getCommunityLanguageLabel(room.language)}</span>
      </div>
      {room.focusTags.length ? (
        <div aria-label="Room focus tags" className={styles.communityAboutTags}>
          {room.focusTags.map((tag) => (
            <span key={tag}>
              <Hash aria-hidden="true" size={12} />
              {getCommunityFocusTagLabel(tag)}
            </span>
          ))}
        </div>
      ) : null}
      {room.themes.length || room.industries.length ? (
        <div
          aria-label="Room discovery themes and industries"
          className={styles.communityAboutLinks}
        >
          {room.themes.map((theme) => (
            <Link href={`/live?theme=${theme}`} key={`theme:${theme}`}>
              Theme · {getCommunityRoomThemeLabel(theme)}
            </Link>
          ))}
          {room.industries.map((industry) => (
            <Link
              href={`/live?industry=${industry}`}
              key={`industry:${industry}`}
            >
              Industry · {getCommunityRoomIndustryLabel(industry)}
            </Link>
          ))}
        </div>
      ) : null}
      {room.relatedTickers.length ? (
        <div
          aria-label="Related company tickers"
          className={styles.communityAboutTickers}
        >
          {room.relatedTickers.map((ticker) => (
            <Link href={`/live/${ticker}`} key={ticker}>
              {ticker}
            </Link>
          ))}
        </div>
      ) : null}
      <small>
        Created {new Date(room.createdAt).toLocaleDateString("en-US")}
      </small>
    </div>
  );
}
