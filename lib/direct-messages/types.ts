import type { Plan } from "@/lib/subscriptionPolicy";

export type DirectMessagePeer = {
  displayName: string;
  emoji: string;
  plan: Plan;
};
export type DirectMessageConversationSummary = {
  conversationId: string;
  latestBodyPreview: string;
  latestCreatedAt: string | null;
  latestIsMine: boolean;
  mutualFollow: boolean;
  peer: DirectMessagePeer;
  unreadCount: number;
};

export type DirectMessageInbox = {
  conversations: DirectMessageConversationSummary[];
  isAuthenticated: boolean;
  totalUnreadCount: number;
};

export type DirectMessage = {
  body: string;
  createdAt: string;
  id: string;
  isMine: boolean;
};

export type DirectMessageConversation = {
  canSend: boolean;
  conversationId: string;
  messages: DirectMessage[];
  mutualFollow: boolean;
  nextCursor: string | null;
  peer: DirectMessagePeer;
  readOnlyReason: string | null;
};
