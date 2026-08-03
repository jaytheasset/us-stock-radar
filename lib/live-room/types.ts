import type { Plan } from "../subscriptionPolicy.ts";
import type { LiveRoomSocialBadge } from "../social-verification/types.ts";
import type {
  LiveRoomPostDirection,
  LiveRoomPostSignal,
} from "./postSignals.ts";
import type { BrokerageProofSummary } from "../brokerage/types.ts";
import type {
  KlipyMediaAttachment,
  KlipyReplyMediaPreview,
} from "../klipy/types.ts";

export type CompanyRoomKey =
  | { kind: "issuer_id"; value: string }
  | { kind: "ticker_fallback"; value: string };

export type CompanyRoomIdentity = {
  companyName: string;
  exchange: string;
  roomKey: CompanyRoomKey;
  ticker: string;
};

export type CompanyEventKind = "filing" | "news";
export type CompanyEventSignal =
  | "bearish"
  | "bullish"
  | "neutral"
  | "volatile";

export type CompanyEventReference = {
  eventId: string;
  kind: CompanyEventKind;
  title: string;
};

export type CompanyEvent = CompanyEventReference & {
  detailHref: string | null;
  occurredAt: string;
  score: number | null;
  signal: CompanyEventSignal;
  source: string;
};

export type CompanyEventSource =
  | "api"
  | "error"
  | "loading"
  | "mock-fallback"
  | "mock-simulation";

export type LiveRoomProfile = {
  avatarUrl: string | null;
  bio: string | null;
  canModerate?: boolean;
  displayName: string;
  emoji: string;
  isDisplayNameCustom?: boolean;
  isGuest: boolean;
  plan: Plan;
  publicProfileId?: string;
  socialBadges?: LiveRoomSocialBadge[];
};

export type LiveRoomReplyPreview = {
  authorAvatarUrl: string | null;
  authorDisplayName: string;
  authorEmoji: string;
  bodyPreview: string;
  messageId: string;
  mediaPreview?: KlipyReplyMediaPreview | null;
};

export type LiveRoomMessageAuthor = Omit<LiveRoomProfile, "bio">;

export type LiveRoomChatMessage = {
  author: LiveRoomMessageAuthor;
  body: string;
  brokerageProof?: BrokerageProofSummary | null;
  canFollowMember?: boolean;
  canMessageMember?: boolean;
  createdAt: string;
  eventReference: CompanyEventReference | null;
  id: string;
  isLiked: boolean;
  isOnline?: boolean;
  isMemberFollowed?: boolean;
  isMine?: boolean;
  kind: "message";
  likeCount: number;
  media?: KlipyMediaAttachment | null;
  replyCount: number;
  replyPreview: LiveRoomReplyPreview | null;
};

export type LiveRoomMessageLikeResult = {
  liked: boolean;
  likeCount: number;
  messageId: string;
};

export type LiveRoomPresenceMessage = {
  isOnline: boolean;
  messageId: string;
};

export type LiveRoomPublicRoomCounts = {
  /**
   * Distinct room memberships and visible authenticated contributors.
   */
  memberCount: number;
  /**
   * Current opt-in authenticated nonmembers plus opaque guest visitors.
   * Visitors never become room members merely by being online.
   */
  visitorCount: number;
  /**
   * Backward-compatible aggregate display total: memberCount plus current
   * anonymous visitors. It is always at least onlineCount.
   */
  participantCount: number;
  /** Current opt-in authenticated and opaque guest visitors. */
  onlineCount: number;
};

export type LiveRoomPresenceSummary = LiveRoomPublicRoomCounts & {
  messages: LiveRoomPresenceMessage[];
};

export type LiveRoomPresenceSetting = {
  isAuthenticated: true;
  showPresence: boolean;
};

export type LiveRoomMembershipState = LiveRoomPublicRoomCounts & {
  joined: boolean;
};

export type LiveRoomMembershipListItem = {
  href: string;
  joinedAt: string;
  kind: "community" | "company";
  label: string;
  onlineCount: number;
  participantCount: number;
  recentActivityAt: string;
  ticker: string | null;
  unreadCount: number;
};

export type LiveRoomMembershipList = {
  hasMore: boolean;
  items: LiveRoomMembershipListItem[];
};

export type LiveRoomMemberSummary = {
  avatarUrl: string | null;
  displayName: string;
  emoji: string;
  followerCount: number;
  isOnline: boolean;
  plan: Plan;
  postCount: number;
  publicProfileId: string;
  receivedLikeCount: number;
  socialBadges: LiveRoomSocialBadge[];
};

export type LiveRoomMemberSummaryList = {
  items: LiveRoomMemberSummary[];
};

export type LiveRoomSystemUpdate = {
  createdAt: string;
  event: CompanyEvent;
  id: string;
  kind: "company_update";
};

export type LiveRoomPostRoom =
  | {
      href: string;
      kind: "company";
      label: string;
      ticker: string;
    }
  | {
      href: string;
      kind: "community";
      label: string;
    };

export type LiveRoomPostAuthor = {
  avatarUrl: string | null;
  displayName: string;
  emoji: string;
  publicProfileId: string;
};

export type LiveRoomPostPreview = {
  author: LiveRoomPostAuthor;
  bodyPreview: string;
  brokerageProof?: BrokerageProofSummary | null;
  canLike: boolean;
  commentCount: number;
  createdAt: string;
  direction: LiveRoomPostDirection | null;
  id: string;
  isLiked: boolean;
  kind: "post_preview";
  likeCount: number;
  room: LiveRoomPostRoom;
  signalLabels: LiveRoomPostSignal[];
  title: string;
};

export type LiveRoomTimelineItem =
  | LiveRoomChatMessage
  | LiveRoomPostPreview
  | LiveRoomSystemUpdate;

export type LiveRoomPost = {
  author: LiveRoomPostAuthor;
  body: string;
  brokerageProof?: BrokerageProofSummary | null;
  canLike: boolean;
  canModerate: boolean;
  commentCount: number;
  createdAt: string;
  direction: LiveRoomPostDirection | null;
  eventReference: CompanyEventReference | null;
  id: string;
  isLiked: boolean;
  isMine: boolean;
  likeCount: number;
  relatedTickers: string[];
  room: LiveRoomPostRoom;
  signalLabels: LiveRoomPostSignal[];
  title: string;
  updatedAt: string;
};

export type LiveRoomPostLikeResult = {
  liked: boolean;
  likeCount: number;
  postId: string;
};

export type LiveRoomPostPage = {
  items: LiveRoomPost[];
  nextCursor: string | null;
};

export type LiveRoomPublicMember = {
  avatarUrl: string | null;
  bio: string | null;
  brokerageConnected: boolean;
  displayName: string;
  emoji: string;
  publicProfileId: string;
  receivedLikeCount: number;
};

export type LiveRoomPublicMemberActions = {
  canFollow: boolean;
  canMessage: boolean;
  isFollowing: boolean;
  isGuest: boolean;
  isSelf: boolean;
  sourceMessageId: string | null;
};

export type LiveRoomPublicMemberFollowResult = {
  followed: boolean;
  publicProfileId: string;
};

export type LiveRoomPublicMemberPostPage = LiveRoomPostPage & {
  member: LiveRoomPublicMember;
};

export type LiveRoomPostDraft = {
  body: string;
  direction: LiveRoomPostDirection | null;
  eventId: string | null;
  proofId: string | null;
  relatedTickers: string[];
  signalLabels: LiveRoomPostSignal[];
  title: string;
};

export type LiveRoomPostComment = {
  author: LiveRoomPostAuthor;
  body: string;
  createdAt: string;
  id: string;
  isMine: boolean;
  parentCommentId: string | null;
  updatedAt: string;
};

export type LiveRoomPostCommentDraft = {
  body: string;
  parentCommentId: string | null;
};

export type LiveRoomPostCommentPage = {
  canComment: boolean;
  items: LiveRoomPostComment[];
  nextCursor: string | null;
};

export const LIVE_ROOM_REPORT_REASONS = [
  "spam",
  "harassment",
  "misinformation",
  "other",
] as const;

export type LiveRoomReportReason =
  (typeof LIVE_ROOM_REPORT_REASONS)[number];

export type LiveRoomBlockedActor = {
  blockedAt: string;
  displayName: string;
  emoji: string;
  id: string;
};

export type LiveRoomBlockResult = {
  block: LiveRoomBlockedActor;
  removedMessageIds: string[];
};

export type LiveRoomModerationItem = LiveRoomChatMessage & {
  hiddenAt: string;
  moderationReason: string;
};

export type LiveRoomMessageDraft = {
  author: LiveRoomMessageAuthor;
  body: string;
  eventReference: CompanyEventReference | null;
};

export interface LiveRoomMessageRepository {
  list(roomKey: CompanyRoomKey): Promise<LiveRoomTimelineItem[]>;
  send(
    roomKey: CompanyRoomKey,
    draft: LiveRoomMessageDraft,
  ): Promise<LiveRoomChatMessage>;
  publishCompanyUpdate(
    roomKey: CompanyRoomKey,
    event: CompanyEvent,
  ): Promise<LiveRoomSystemUpdate>;
  subscribe(
    roomKey: CompanyRoomKey,
    listener: (items: LiveRoomTimelineItem[]) => void,
  ): () => void;
}

export type LiveRoomNotificationScope = "new_chat_messages";

export type LiveRoomFollowRoomKey =
  | CompanyRoomKey
  | { kind: "community_slug"; value: string };

export type LiveRoomFollowPreference = {
  followed: boolean;
  notificationScope: LiveRoomNotificationScope;
  roomKey: LiveRoomFollowRoomKey;
};

export type LiveRoomUnreadRoom = {
  href: string;
  kind: "community" | "company";
  label: string;
  ticker: string | null;
  unreadCount: number;
};

export type LiveRoomFollowedMember = {
  authorDisplayName: string;
  authorEmoji: string;
  messageId: string;
  ticker: string;
};

export type LiveRoomMemberActivity = LiveRoomFollowedMember & {
  bodyPreview: string;
  createdAt: string;
};

export type LiveRoomPostActivityKind =
  | "comment_reply"
  | "followed_member_post"
  | "followed_room_post"
  | "post_comment";

export type LiveRoomPostActivity = {
  activityId: string;
  actorDisplayName: string;
  actorEmoji: string;
  bodyPreview: string;
  commentId: string | null;
  createdAt: string;
  isRead: boolean;
  kind: LiveRoomPostActivityKind;
  postId: string;
  postTitle: string;
  roomLabel: string;
};

export type LiveRoomUnreadSummary = {
  activity: LiveRoomPostActivity[];
  activityUnreadCount: number;
  followedPeople: LiveRoomFollowedMember[];
  hasMemberFollows: boolean;
  isAuthenticated: boolean;
  people: LiveRoomMemberActivity[];
  peopleUnreadCount: number;
  rooms: LiveRoomUnreadRoom[];
  totalUnreadCount: number;
};

export type LiveRoomMemberFollowResult = {
  followed: boolean;
  messageId: string;
};

export interface LiveRoomFollowRepository {
  read(roomKey: CompanyRoomKey): LiveRoomFollowPreference;
  write(preference: LiveRoomFollowPreference): void;
}

export interface LiveRoomProfileRepository {
  read(): LiveRoomProfile;
  write(profile: LiveRoomProfile): void;
}
