import type { Plan } from "../subscriptionPolicy.ts";
import type { LiveRoomSocialBadge } from "../social-verification/types.ts";

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
  createdAt: string;
  id: string;
  kind: "post_preview";
  room: LiveRoomPostRoom;
  title: string;
};

export type LiveRoomTimelineItem =
  | LiveRoomChatMessage
  | LiveRoomPostPreview
  | LiveRoomSystemUpdate;

export type LiveRoomPost = {
  author: LiveRoomPostAuthor;
  body: string;
  canModerate: boolean;
  createdAt: string;
  eventReference: CompanyEventReference | null;
  id: string;
  isMine: boolean;
  relatedTickers: string[];
  room: LiveRoomPostRoom;
  title: string;
  updatedAt: string;
};

export type LiveRoomPostPage = {
  items: LiveRoomPost[];
  nextCursor: string | null;
};

export type LiveRoomPublicMember = {
  displayName: string;
  emoji: string;
  publicProfileId: string;
};

export type LiveRoomPublicMemberPostPage = LiveRoomPostPage & {
  member: LiveRoomPublicMember;
};

export type LiveRoomPostDraft = {
  body: string;
  eventId: string | null;
  relatedTickers: string[];
  title: string;
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

export type LiveRoomFollowPreference = {
  followed: boolean;
  notificationScope: LiveRoomNotificationScope;
  roomKey: CompanyRoomKey;
};

export type LiveRoomUnreadRoom = {
  ticker: string;
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

export type LiveRoomUnreadSummary = {
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
