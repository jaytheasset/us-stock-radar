import type { Plan } from "../subscriptionPolicy.ts";
import type { LiveRoomSocialBadge } from "../social-verification/types.ts";
import type { LiveRoomPostSignal } from "./postSignals.ts";

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
  canModerate?: boolean;
  displayName: string;
  emoji: string;
  isGuest: boolean;
  plan: Plan;
  publicProfileId?: string;
  socialBadges?: LiveRoomSocialBadge[];
};

export type LiveRoomReplyPreview = {
  authorDisplayName: string;
  authorEmoji: string;
  bodyPreview: string;
  messageId: string;
};

export type LiveRoomChatMessage = {
  author: LiveRoomProfile;
  body: string;
  canFollowMember?: boolean;
  canMessageMember?: boolean;
  createdAt: string;
  eventReference: CompanyEventReference | null;
  id: string;
  isOnline?: boolean;
  isMemberFollowed?: boolean;
  isMine?: boolean;
  kind: "message";
  replyPreview: LiveRoomReplyPreview | null;
};

export type LiveRoomPresenceMessage = {
  isOnline: boolean;
  messageId: string;
};

export type LiveRoomPresenceSummary = {
  messages: LiveRoomPresenceMessage[];
  onlineMemberCount: number;
};

export type LiveRoomPresenceSetting = {
  isAuthenticated: true;
  showPresence: boolean;
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
  displayName: string;
  emoji: string;
  publicProfileId: string;
};

export type LiveRoomPostPreview = {
  author: LiveRoomPostAuthor;
  bodyPreview: string;
  canLike: boolean;
  commentCount: number;
  createdAt: string;
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
  canLike: boolean;
  canModerate: boolean;
  commentCount: number;
  createdAt: string;
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
  eventId: string | null;
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
  author: LiveRoomProfile;
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
