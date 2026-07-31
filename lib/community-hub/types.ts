import type { Plan } from "@/lib/subscriptionPolicy";
import type { LiveRoomNotificationScope } from "@/lib/live-room/types";

export const COMMUNITY_HUB_PEOPLE_FILTERS = [
  "following",
  "followers",
  "mutual",
] as const;

export type CommunityHubPeopleFilter =
  (typeof COMMUNITY_HUB_PEOPLE_FILTERS)[number];

export type CommunityHubPerson = {
  avatarUrl: string | null;
  displayName: string;
  emoji: string;
  followsYou: boolean;
  isFollowing: boolean;
  isVerified: boolean;
  messageId: string | null;
  plan: Plan;
  publicProfileId: string;
  relationship: "follower" | "following" | "mutual";
};

export type CommunityHubPeoplePage = {
  counts: {
    followers: number;
    following: number;
    mutual: number;
  };
  items: CommunityHubPerson[];
  nextCursor: string | null;
};

export type CommunityHubRoom = {
  href: string;
  kind: "community" | "company";
  label: string;
  notificationScope: LiveRoomNotificationScope;
  slug: string | null;
  ticker: string | null;
  unreadCount: number;
};

export type CommunityHubRoomsPage = {
  items: CommunityHubRoom[];
  nextCursor: string | null;
  totalUnreadCount: number;
};
