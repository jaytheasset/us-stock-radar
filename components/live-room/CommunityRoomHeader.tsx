"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { CommunityRoom } from "@/lib/live-room/community";
import type { LiveRoomPublicRoomCounts } from "@/lib/live-room/types";
import { LiveRoomInviteMenu } from "./LiveRoomInviteMenu";
import { RoomMembershipControl } from "./RoomMembershipControl";
import styles from "./LiveRoom.module.css";

type CommunityRoomHeaderProps = {
  isGuest: boolean;
  loginHref: string;
  joiningDisabled?: boolean;
  membershipBusy: boolean;
  membershipJoined: boolean | null;
  onJoin: () => Promise<void>;
  onLeave: () => Promise<void>;
  room: CommunityRoom;
  roomCounts: LiveRoomPublicRoomCounts | null;
};

export function CommunityRoomHeader({
  isGuest,
  loginHref,
  joiningDisabled = false,
  membershipBusy,
  membershipJoined,
  onJoin,
  onLeave,
  room,
  roomCounts,
}: CommunityRoomHeaderProps) {
  return (
    <header className={`${styles.roomHeader} ${styles.communityRoomHeader}`}>
      <div className={styles.roomIdentity}>
        <div className={styles.roomTitleLine}>
          <div className={styles.roomTitlePrimary}>
            <h1>{room.name}</h1>
            <small className={styles.mobileExchange}>Community</small>
          </div>
          <strong className={styles.roomCompanyName}>{room.summary}</strong>
        </div>
        <div className={styles.roomMeta}>
          <small className={styles.desktopExchange}>Community Room</small>
          {roomCounts ? (
            <>
              <small
                className={`${styles.roomCounts} ${styles.desktopRoomCounts}`}
              >
                <strong>{roomCounts.memberCount} members</strong>
                {roomCounts.visitorCount > 0 ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{roomCounts.visitorCount} visitors</span>
                  </>
                ) : null}
                <span aria-hidden="true">·</span>
                <span className={styles.onlineCount}>
                  <i aria-hidden="true" />
                  {roomCounts.onlineCount} online
                </span>
              </small>
              <small
                className={`${styles.roomCounts} ${styles.mobileRoomCounts}`}
              >
                <strong>{roomCounts.participantCount} participants</strong>
                <span aria-hidden="true">·</span>
                <span className={styles.onlineCount}>
                  <i aria-hidden="true" />
                  {roomCounts.onlineCount} online
                </span>
              </small>
            </>
          ) : null}
        </div>
      </div>

      <div className={styles.roomActions}>
        <Link
          aria-label="Back to Community Rooms"
          className={styles.communityRoomsBackLink}
          href="/live"
        >
          <ArrowLeft aria-hidden="true" size={15} />
          <span className={styles.actionLabel}>Community Rooms</span>
        </Link>
        <RoomMembershipControl
          busy={membershipBusy}
          isGuest={isGuest}
          joined={membershipJoined}
          joiningDisabled={joiningDisabled}
          loginHref={loginHref}
          onJoin={onJoin}
          onLeave={onLeave}
          roomLabel={room.name}
        />
        <LiveRoomInviteMenu
          ariaLabel="Invite people to this Community Room"
          room={{
            kind: "community",
            name: room.name,
            slug: room.slug,
          }}
        />
      </div>
    </header>
  );
}
