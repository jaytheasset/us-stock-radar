"use client";

import Link from "next/link";
import {
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
  type ReactNode,
} from "react";
import { MemberPlanBadge } from "@/components/ui/MemberPlanBadge";
import { MemberAvatar } from "@/components/ui/MemberAvatar";
import { formatPublicChatName } from "@/lib/live-room/chatIdentity";
import { BrokerageProofCard } from "@/components/brokerage/BrokerageProofCard";
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
import { PostDirectionBadge, PostSignalChips } from "./PostSignals";
import directionSurfaceStyles from "./PostDirectionSurface.module.css";
import type { CompanyLiveRoomTab } from "./RoomTabs";
import styles from "./LiveRoom.module.css";

type SidePanelTab =
  | "about"
  | "activity"
  | "events"
  | "members"
  | "posts"
  | "rooms";
type PostState = "error" | "loading" | "ready";

const COMPANY_SIDE_PANEL_TABS = [
  { label: "Activity", value: "activity" },
  { label: "Posts", value: "posts" },
  { label: "Events", value: "events" },
  { label: "Members", value: "members" },
] as const satisfies ReadonlyArray<{
  label: string;
  value: SidePanelTab;
}>;

const COMMUNITY_SIDE_PANEL_TABS = [
  { label: "Posts", value: "posts" },
  { label: "Members", value: "members" },
  { label: "My Rooms", value: "rooms" },
  { label: "About", value: "about" },
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
  allEvents,
  aboutContent,
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
  onOpenAbout,
  onMessageMember,
  onRetryPosts,
  onToggleMemberFollow,
  posts,
  postsState,
  timeline,
  currentRoomHref,
  variant = "rail",
}: {
  allEvents?: readonly CompanyEvent[];
  aboutContent?: ReactNode;
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
  onOpenAbout?: () => void;
  onMessageMember: (messageId: string) => Promise<void>;
  onRetryPosts: () => void;
  onToggleMemberFollow: (messageId: string, followed: boolean) => Promise<void>;
  posts: readonly LiveRoomPost[];
  postsState: PostState;
  timeline: readonly LiveRoomTimelineItem[];
  currentRoomHref: string;
  variant?: "drawer" | "rail";
}) {
  const sidePanelTabs = aboutContent
    ? COMMUNITY_SIDE_PANEL_TABS
    : COMPANY_SIDE_PANEL_TABS;
  const [activeTab, setActiveTab] = useState<SidePanelTab>(
    aboutContent ? "posts" : "activity",
  );
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
      nextIndex = (index + 1) % sidePanelTabs.length;
    }
    if (event.key === "ArrowLeft") {
      nextIndex = (index - 1 + sidePanelTabs.length) % sidePanelTabs.length;
    }
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") {
      nextIndex = sidePanelTabs.length - 1;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    const nextTab = sidePanelTabs[nextIndex];
    if (!nextTab) return;
    setActiveTab(nextTab.value);
    tabRefs.current[nextIndex]?.focus();
  };

  const viewAllTab: CompanyLiveRoomTab =
    activeTab === "posts"
      ? "posts"
      : activeTab === "activity" || activeTab === "events"
        ? "events"
        : "chat";
  const sectionTitle =
    activeTab === "activity"
      ? "Recent updates"
      : activeTab === "posts"
        ? "Recent posts"
        : activeTab === "events"
          ? "Events"
          : activeTab === "members"
            ? "Members"
            : activeTab === "rooms"
              ? "My Rooms"
              : "About";
  const viewAllAction =
    activeTab === "rooms" ? (
      <Link
        className={styles.sidePanelViewAll}
        href={isGuest ? loginHref : "/live?view=joined"}
      >
        View all →
      </Link>
    ) : activeTab === "about" ? (
      <button
        className={styles.sidePanelViewAll}
        onClick={onOpenAbout}
        type="button"
      >
        View about →
      </button>
    ) : (
      <button
        className={styles.sidePanelViewAll}
        onClick={() => onChangeMainTab(viewAllTab)}
        type="button"
      >
        {activeTab === "members" ? "View in chat →" : "View all →"}
      </button>
    );

  return (
    <aside
      aria-label="Live Room quick preview"
      className={`${styles.desktopSidePanel} ${
        variant === "drawer" ? styles.drawerSidePanel : ""
      }`}
      data-live-room-preview-surface={variant}
    >
      <div className={styles.sidePanelHeader}>
        <div
          aria-label="Quick preview sections"
          className={styles.sidePanelTabs}
          role="tablist"
        >
          {sidePanelTabs.map((tab, index) => (
            <button
              aria-controls={`live-room-side-${variant}-${tab.value}-panel`}
              aria-selected={activeTab === tab.value}
              className={
                activeTab === tab.value ? styles.activeSidePanelTab : undefined
              }
              id={`live-room-side-${variant}-${tab.value}-tab`}
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
      </div>

      <div
        aria-labelledby={`live-room-side-${variant}-${activeTab}-tab`}
        className={styles.sidePanelBody}
        id={`live-room-side-${variant}-${activeTab}-panel`}
        role="tabpanel"
        tabIndex={0}
      >
        <div className={styles.sidePanelSectionHeading}>
          <strong>{sectionTitle}</strong>
          {viewAllAction}
        </div>
        {activeTab === "activity" ? (
          <UpdatesPreview eventSource={eventSource} events={events} />
        ) : activeTab === "events" ? (
          <UpdatesPreview
            eventSource={eventSource}
            events={allEvents ?? events}
          />
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
        ) : activeTab === "about" ? (
          aboutContent
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
      {events.slice(0, LIVE_ROOM_SIDE_PANEL_ITEM_LIMIT).map((event) =>
        event.detailHref ? (
          <Link
            className={styles.sidePanelItem}
            href={event.detailHref}
            key={event.eventId}
          >
            <span className={styles.sidePanelItemIcon} data-kind={event.kind}>
              {event.kind === "filing" ? (
                <FileText aria-hidden="true" size={14} />
              ) : (
                <Newspaper aria-hidden="true" size={14} />
              )}
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
          <div className={styles.sidePanelItem} key={event.eventId}>
            <span className={styles.sidePanelItemIcon} data-kind={event.kind}>
              {event.kind === "filing" ? (
                <FileText aria-hidden="true" size={14} />
              ) : (
                <Newspaper aria-hidden="true" size={14} />
              )}
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
      {posts.slice(0, LIVE_ROOM_SIDE_PANEL_ITEM_LIMIT).map((post) => (
        <Link
          className={`${styles.sidePanelItem} ${directionSurfaceStyles.surface}`}
          data-direction={post.direction ?? "unspecified"}
          href={`/live/posts/${post.id}`}
          key={post.id}
        >
          <span className={styles.sidePanelItemIcon}>
            <FileText aria-hidden="true" size={14} />
          </span>
          <div className={styles.sidePanelPostContent}>
            <strong>{post.title}</strong>
            {post.brokerageProof ? (
              <BrokerageProofCard compact proof={post.brokerageProof} />
            ) : null}
            <small>
              <MemberAvatar
                displayName={post.author.displayName}
                imageUrl={post.author.avatarUrl}
                size="small"
              />
              {formatPublicChatName(post.author.displayName)} ·{" "}
              {formatPreviewDate(post.createdAt)}
            </small>
            <div className={styles.sidePanelPostMeta}>
              {post.direction || post.signalLabels.length ? (
                <div className={styles.sidePanelPostSignals}>
                  <PostDirectionBadge direction={post.direction} />
                  <PostSignalChips maxVisible={1} signals={post.signalLabels} />
                </div>
              ) : null}
              <span
                aria-label="Post activity"
                className={styles.sidePanelPostActivity}
              >
                <span
                  aria-label={`${post.likeCount} likes`}
                  data-kind="like"
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
                  data-kind="comment"
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
  onToggleMemberFollow: (messageId: string, followed: boolean) => Promise<void>;
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
    memberSummaries.map((summary) => [summary.publicProfileId, summary]),
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
        const publicDisplayName = formatPublicChatName(displayName);
        const sourceMessageId = member.sourceMessageId;
        const busy =
          Boolean(sourceMessageId) && messageActionId === sourceMessageId;
        return (
          <div className={styles.sidePanelMember} key={member.publicProfileId}>
            <Link
              className={styles.sidePanelMemberProfile}
              href={`/live/members/${member.publicProfileId}`}
            >
              <MemberAvatar
                className={styles.sidePanelAvatar}
                displayName={displayName}
                imageUrl={summary.avatarUrl}
              />
              <span className={styles.sidePanelMemberSummary}>
                <span className={styles.sidePanelMemberIdentity}>
                  <strong>{publicDisplayName}</strong>
                  {socialBadges.length ? (
                    <BadgeCheck
                      aria-label={`Verified creator: ${socialBadges
                        .map((badge) => badge.label.replace("Verified ", ""))
                        .join(", ")}`}
                      className={styles.sidePanelVerified}
                      size={13}
                    />
                  ) : null}
                  <MemberPlanBadge plan={summary.plan} />
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
                    <span className={styles.visuallyHidden}> followers</span>
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
                aria-label={`Actions for ${publicDisplayName}`}
                className={styles.sidePanelMemberActions}
                role="group"
              >
                {isGuest ? (
                  <>
                    <Link
                      aria-label={`Sign in to follow ${publicDisplayName}`}
                      href={loginHref}
                      title="Follow"
                    >
                      <UserPlus aria-hidden="true" size={14} />
                      <span className={styles.visuallyHidden}>Follow</span>
                    </Link>
                    <Link
                      aria-label={`Sign in to message ${publicDisplayName}`}
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
                        ? `Unfollow ${publicDisplayName}`
                        : `Follow ${publicDisplayName}`
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
                    aria-label={`Message ${publicDisplayName}`}
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
