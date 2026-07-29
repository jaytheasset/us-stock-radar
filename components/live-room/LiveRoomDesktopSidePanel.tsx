"use client";

import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  FileText,
  Heart,
  MessageCircle,
  Newspaper,
  UserCheck,
  UserPlus,
  Users,
} from "lucide-react";
import {
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { getPlanDisplayName } from "@/lib/subscriptionPolicy";
import {
  LIVE_ROOM_SIDE_PANEL_ITEM_LIMIT,
  selectLiveRoomSidePanelMembers,
} from "@/lib/live-room/sidePanel";
import type {
  CompanyEvent,
  CompanyEventSource,
  LiveRoomPost,
  LiveRoomMembershipList,
  LiveRoomMemberSummary,
  LiveRoomTimelineItem,
} from "@/lib/live-room/types";
import { CompanyEventSignalScore } from "./CompanyEventSignalScore";
import { JoinedRoomsList } from "./JoinedRoomsList";
import { PostSignalChips } from "./PostSignals";
import type { CompanyLiveRoomTab } from "./RoomTabs";
import styles from "./LiveRoom.module.css";

type SidePanelTab = "members" | "posts" | "rooms" | "updates";
type PostState = "error" | "loading" | "ready";

const SIDE_PANEL_TABS = [
  { label: "Updates", value: "updates" },
  { label: "Posts", value: "posts" },
  { label: "Members", value: "members" },
  { label: "My Rooms", value: "rooms" },
] as const satisfies ReadonlyArray<{
  label: string;
  value: SidePanelTab;
}>;

const compactCountFormatter = new Intl.NumberFormat("en-US", {
  compactDisplay: "short",
  maximumFractionDigits: 1,
  notation: "compact",
});

export function LiveRoomDesktopSidePanel({
  eventSource,
  events,
  isGuest,
  joinedRooms,
  joinedRoomsError,
  joinedRoomsLoading,
  loginHref,
  memberSummaries,
  messageActionId,
  onChangeMainTab,
  onMessageMember,
  onRetryPosts,
  onToggleMemberFollow,
  posts,
  postsState,
  timeline,
  currentRoomHref,
}: {
  eventSource: CompanyEventSource;
  events: readonly CompanyEvent[];
  isGuest: boolean;
  joinedRooms: LiveRoomMembershipList | null;
  joinedRoomsError: string | null;
  joinedRoomsLoading: boolean;
  loginHref: string;
  memberSummaries: readonly LiveRoomMemberSummary[] | null;
  messageActionId?: string | null;
  onChangeMainTab: (tab: CompanyLiveRoomTab) => void;
  onMessageMember: (messageId: string) => Promise<void>;
  onRetryPosts: () => void;
  onToggleMemberFollow: (
    messageId: string,
    followed: boolean,
  ) => Promise<void>;
  posts: readonly LiveRoomPost[];
  postsState: PostState;
  timeline: readonly LiveRoomTimelineItem[];
  currentRoomHref: string;
}) {
  const [activeTab, setActiveTab] =
    useState<SidePanelTab>("updates");
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const members = useMemo(
    () => selectLiveRoomSidePanelMembers({ posts, timeline }),
    [posts, timeline],
  );

  const handleKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") {
      nextIndex = (index + 1) % SIDE_PANEL_TABS.length;
    }
    if (event.key === "ArrowLeft") {
      nextIndex =
        (index - 1 + SIDE_PANEL_TABS.length) %
        SIDE_PANEL_TABS.length;
    }
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") {
      nextIndex = SIDE_PANEL_TABS.length - 1;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    const nextTab = SIDE_PANEL_TABS[nextIndex];
    if (!nextTab) return;
    setActiveTab(nextTab.value);
    tabRefs.current[nextIndex]?.focus();
  };

  const viewAllTab: CompanyLiveRoomTab =
    activeTab === "posts"
      ? "posts"
      : activeTab === "updates"
        ? "events"
        : "chat";

  return (
    <aside
      aria-label="Live Room quick preview"
      className={styles.desktopSidePanel}
    >
      <div
        aria-label="Quick preview sections"
        className={styles.sidePanelTabs}
        role="tablist"
      >
        {SIDE_PANEL_TABS.map((tab, index) => (
          <button
            aria-controls={`live-room-side-${tab.value}-panel`}
            aria-selected={activeTab === tab.value}
            className={
              activeTab === tab.value
                ? styles.activeSidePanelTab
                : undefined
            }
            id={`live-room-side-${tab.value}-tab`}
            key={tab.value}
            onClick={() => setActiveTab(tab.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            ref={(element) => {
              tabRefs.current[index] = element;
            }}
            role="tab"
            tabIndex={activeTab === tab.value ? 0 : -1}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div
        aria-labelledby={`live-room-side-${activeTab}-tab`}
        className={styles.sidePanelBody}
        id={`live-room-side-${activeTab}-panel`}
        role="tabpanel"
        tabIndex={0}
      >
        {activeTab === "updates" ? (
          <UpdatesPreview eventSource={eventSource} events={events} />
        ) : activeTab === "posts" ? (
          <PostsPreview
            onRetry={onRetryPosts}
            posts={posts}
            state={postsState}
          />
        ) : activeTab === "members" ? (
          <LiveRoomMemberList
            isGuest={isGuest}
            loginHref={loginHref}
            members={members}
            memberSummaries={memberSummaries}
            messageActionId={messageActionId}
            onMessageMember={onMessageMember}
            onToggleMemberFollow={onToggleMemberFollow}
          />
        ) : isGuest ? (
          <div className={styles.sidePanelStatus}>
            <Users aria-hidden="true" size={17} />
            <Link href={loginHref}>Sign in to view My Rooms</Link>
          </div>
        ) : (
          <JoinedRoomsList
            currentHref={currentRoomHref}
            data={joinedRooms}
            error={joinedRoomsError}
            loading={joinedRoomsLoading}
          />
        )}
      </div>

      {activeTab === "rooms" ? (
        <Link
          className={styles.sidePanelViewAll}
          href={isGuest ? loginHref : "/live?view=joined"}
        >
          View all
          <ArrowRight aria-hidden="true" size={14} />
        </Link>
      ) : (
        <button
          className={styles.sidePanelViewAll}
          onClick={() => onChangeMainTab(viewAllTab)}
          type="button"
        >
          {activeTab === "members" ? "View in chat" : "View all"}
          <ArrowRight aria-hidden="true" size={14} />
        </button>
      )}
    </aside>
  );
}

function UpdatesPreview({
  eventSource,
  events,
}: {
  eventSource: CompanyEventSource;
  events: readonly CompanyEvent[];
}) {
  if (eventSource === "loading") {
    return <PreviewStatus label="Loading company updates…" />;
  }
  if (eventSource === "error") {
    return <PreviewStatus label="Company updates are unavailable." />;
  }
  if (!events.length) {
    return <PreviewStatus label="No company updates yet." />;
  }

  return (
    <div className={styles.sidePanelList}>
      {events
        .slice(0, LIVE_ROOM_SIDE_PANEL_ITEM_LIMIT)
        .map((event) =>
          event.detailHref ? (
            <Link
              className={styles.sidePanelItem}
              href={event.detailHref}
              key={event.eventId}
            >
              <span className={styles.sidePanelItemIcon}>
                <Newspaper aria-hidden="true" size={14} />
              </span>
              <span>
                <strong>{event.title}</strong>
                <small>
                  {event.kind === "filing" ? "Filing" : "News"} ·{" "}
                  {formatPreviewDate(event.occurredAt)}
                </small>
                <CompanyEventSignalScore
                  score={event.score}
                  signal={event.signal}
                />
              </span>
            </Link>
          ) : (
            <div
              className={styles.sidePanelItem}
              key={event.eventId}
            >
              <span className={styles.sidePanelItemIcon}>
                <Newspaper aria-hidden="true" size={14} />
              </span>
              <span>
                <strong>{event.title}</strong>
                <small>
                  Analysis unavailable ·{" "}
                  {formatPreviewDate(event.occurredAt)}
                </small>
                <CompanyEventSignalScore
                  score={event.score}
                  signal={event.signal}
                />
              </span>
            </div>
          ),
        )}
    </div>
  );
}

function PostsPreview({
  onRetry,
  posts,
  state,
}: {
  onRetry: () => void;
  posts: readonly LiveRoomPost[];
  state: PostState;
}) {
  if (state === "loading") {
    return <PreviewStatus label="Loading public posts…" />;
  }
  if (state === "error") {
    return (
      <div className={styles.sidePanelStatus} role="alert">
        <span>Public posts could not be loaded.</span>
        <button onClick={onRetry} type="button">
          Retry
        </button>
      </div>
    );
  }
  if (!posts.length) {
    return <PreviewStatus label="No public posts yet." />;
  }

  return (
    <div className={styles.sidePanelList}>
      {posts
        .slice(0, LIVE_ROOM_SIDE_PANEL_ITEM_LIMIT)
        .map((post) => (
          <Link
            className={styles.sidePanelItem}
            href={`/live/posts/${post.id}`}
            key={post.id}
          >
            <span className={styles.sidePanelItemIcon}>
              <FileText aria-hidden="true" size={14} />
            </span>
            <div className={styles.sidePanelPostContent}>
              <strong>{post.title}</strong>
              <small>
                {post.author.emoji} {post.author.displayName} ·{" "}
                {formatPreviewDate(post.createdAt)}
              </small>
              <div className={styles.sidePanelPostMeta}>
                {post.signalLabels.length ? (
                  <div className={styles.sidePanelPostSignals}>
                    <PostSignalChips
                      maxVisible={1}
                      signals={post.signalLabels}
                    />
                  </div>
                ) : null}
                <span
                  aria-label="Post activity"
                  className={styles.sidePanelPostActivity}
                >
                  <span
                    aria-label={`${post.likeCount} likes`}
                    title="Likes"
                  >
                    <Heart
                      aria-hidden="true"
                      fill={post.isLiked ? "currentColor" : "none"}
                      size={12}
                    />
                    {post.likeCount}
                  </span>
                  <span
                    aria-label={`${post.commentCount} comments`}
                    title="Comments"
                  >
                    <MessageCircle aria-hidden="true" size={12} />
                    {post.commentCount}
                  </span>
                </span>
              </div>
            </div>
          </Link>
        ))}
    </div>
  );
}

export function LiveRoomMemberList({
  isGuest,
  loginHref,
  members,
  memberSummaries,
  messageActionId,
  onMessageMember,
  onToggleMemberFollow,
}: {
  isGuest: boolean;
  loginHref: string;
  members: ReturnType<typeof selectLiveRoomSidePanelMembers>;
  memberSummaries: readonly LiveRoomMemberSummary[] | null;
  messageActionId?: string | null;
  onMessageMember: (messageId: string) => Promise<void>;
  onToggleMemberFollow: (
    messageId: string,
    followed: boolean,
  ) => Promise<void>;
}) {
  if (!members.length) {
    return (
      <PreviewStatus label="No public member activity is available yet." />
    );
  }
  if (memberSummaries === null) {
    return <PreviewStatus label="Loading public member summaries…" />;
  }
  const summaries = new Map(
    memberSummaries.map((summary) => [
      summary.publicProfileId,
      summary,
    ]),
  );
  const visibleMembers = members.flatMap((member) => {
    const summary = summaries.get(member.publicProfileId);
    return summary ? [{ member, summary }] : [];
  });
  if (!visibleMembers.length) {
    return (
      <PreviewStatus label="No public member activity is available yet." />
    );
  }

  return (
    <div className={styles.sidePanelList}>
      {visibleMembers.map(({ member, summary }) => {
        const socialBadges = summary.socialBadges;
        const displayName = summary.displayName;
        const emoji = summary.emoji;
        const sourceMessageId = member.sourceMessageId;
        const busy =
          Boolean(sourceMessageId) &&
          messageActionId === sourceMessageId;
        return (
          <div
            className={styles.sidePanelMember}
            key={member.publicProfileId}
          >
            <Link
              className={styles.sidePanelMemberProfile}
              href={`/live/members/${member.publicProfileId}`}
            >
              <span aria-hidden="true" className={styles.sidePanelAvatar}>
                {emoji}
              </span>
              <span className={styles.sidePanelMemberSummary}>
                <span className={styles.sidePanelMemberIdentity}>
                  <strong>{displayName}</strong>
                  {socialBadges.length ? (
                    <BadgeCheck
                      aria-label={`Verified creator: ${socialBadges
                        .map((badge) => badge.label.replace("Verified ", ""))
                        .join(", ")}`}
                      className={styles.sidePanelVerified}
                      size={13}
                    />
                  ) : null}
                  <span
                    className={styles.planBadge}
                    data-plan={summary.plan}
                  >
                    {getPlanDisplayName(summary.plan)}
                  </span>
                  {summary.isOnline ? (
                    <span
                      aria-label="Online"
                      className={styles.sidePanelOnline}
                      title="Online"
                    >
                      <i aria-hidden="true" />
                    </span>
                  ) : null}
                </span>
                <span
                  aria-label={`${summary.followerCount} followers, ${summary.postCount} posts, ${summary.receivedLikeCount} received likes`}
                  className={styles.sidePanelMemberStats}
                >
                  <span title="Followers">
                    <Users aria-hidden="true" size={11} />
                    {formatMemberCount(summary.followerCount)}
                    <span className={styles.visuallyHidden}>
                      {" "}
                      followers
                    </span>
                  </span>
                  <span title="Posts">
                    <FileText aria-hidden="true" size={11} />
                    {formatMemberCount(summary.postCount)}
                    <span className={styles.visuallyHidden}> posts</span>
                  </span>
                  <span title="Received likes">
                    <Heart aria-hidden="true" size={11} />
                    {formatMemberCount(summary.receivedLikeCount)}
                    <span className={styles.visuallyHidden}>
                      {" "}
                      received likes
                    </span>
                  </span>
                </span>
              </span>
            </Link>
            {isGuest ||
            (sourceMessageId &&
              (member.canFollowMember || member.canMessageMember)) ? (
              <div
                aria-label={`Actions for ${displayName}`}
                className={styles.sidePanelMemberActions}
                role="group"
              >
                {isGuest ? (
                  <>
                    <Link
                      aria-label={`Sign in to follow ${displayName}`}
                      href={loginHref}
                      title="Follow"
                    >
                      <UserPlus aria-hidden="true" size={14} />
                      <span className={styles.visuallyHidden}>Follow</span>
                    </Link>
                    <Link
                      aria-label={`Sign in to message ${displayName}`}
                      href={loginHref}
                      title="Message"
                    >
                      <MessageCircle aria-hidden="true" size={14} />
                      <span className={styles.visuallyHidden}>Message</span>
                    </Link>
                  </>
                ) : null}
                {!isGuest && member.canFollowMember && sourceMessageId ? (
                  <button
                    aria-label={
                      member.isMemberFollowed
                        ? `Unfollow ${displayName}`
                        : `Follow ${displayName}`
                    }
                    aria-pressed={member.isMemberFollowed}
                    data-followed={member.isMemberFollowed}
                    disabled={busy}
                    onClick={() =>
                      void onToggleMemberFollow(
                        sourceMessageId,
                        !member.isMemberFollowed,
                      ).catch(() => undefined)
                    }
                    title={member.isMemberFollowed ? "Following" : "Follow"}
                    type="button"
                  >
                    {member.isMemberFollowed ? (
                      <UserCheck aria-hidden="true" size={14} />
                    ) : (
                      <UserPlus aria-hidden="true" size={14} />
                    )}
                    <span className={styles.visuallyHidden}>
                      {member.isMemberFollowed ? "Following" : "Follow"}
                    </span>
                  </button>
                ) : null}
                {!isGuest && member.canMessageMember && sourceMessageId ? (
                  <button
                    aria-label={`Message ${displayName}`}
                    disabled={busy}
                    onClick={() =>
                      void onMessageMember(sourceMessageId).catch(
                        () => undefined,
                      )
                    }
                    title="Message"
                    type="button"
                  >
                    <MessageCircle aria-hidden="true" size={14} />
                    <span className={styles.visuallyHidden}>Message</span>
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function PreviewStatus({ label }: { label: string }) {
  return (
    <div className={styles.sidePanelStatus}>
      <Users aria-hidden="true" size={17} />
      <span>{label}</span>
    </div>
  );
}

function formatPreviewDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time unavailable";
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
  }).format(date);
}

function formatMemberCount(value: number) {
  const count = Math.max(0, Math.trunc(value));
  return count < 1_000 ? String(count) : compactCountFormatter.format(count);
}
