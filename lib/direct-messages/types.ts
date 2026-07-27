import type { Plan } from "@/lib/subscriptionPolicy";

export const DIRECT_MESSAGE_RECEIVE_MODES = [
  "mutual_only",
  "people_i_follow",
  "followers",
  "everyone",
  "nobody",
] as const;
export const DIRECT_MESSAGE_REQUEST_FILTERS = [
  "any",
  "moderators",
  "verified",
  "pro_members",
] as const;
export const DIRECT_MESSAGE_REPORT_REASONS = [
  "spam",
  "harassment",
  "scam",
  "misinformation",
  "other",
] as const;
export const DIRECT_MESSAGE_RISK_FLAGS = [
  "off_platform_contact",
  "money_transfer",
  "guaranteed_return",
  "paid_room",
  "crypto_wallet",
  "repeated_contact",
] as const;

export type DirectMessageReceiveMode =
  (typeof DIRECT_MESSAGE_RECEIVE_MODES)[number];
export type DirectMessageRequestFilter =
  (typeof DIRECT_MESSAGE_REQUEST_FILTERS)[number];
export type DirectMessageReportReason =
  (typeof DIRECT_MESSAGE_REPORT_REASONS)[number];
export type DirectMessageRiskFlag =
  (typeof DIRECT_MESSAGE_RISK_FLAGS)[number];
export type DirectMessageConversationStatus = "accepted" | "pending";
export type DirectMessageRequestRole = "recipient" | "sender" | null;

export type DirectMessagePeer = {
  displayName: string;
  emoji: string;
  plan: Plan;
};

export type DirectMessageStartResult = {
  conversationId: string | null;
  isRequestSender: boolean;
  mode: "accepted" | "pending" | "request_required";
  peer: Pick<DirectMessagePeer, "displayName" | "emoji">;
};

export type DirectMessageConversationSummary = {
  conversationId: string;
  latestBodyPreview: string;
  latestCreatedAt: string | null;
  latestIsMine: boolean;
  mutualFollow: boolean;
  peer: DirectMessagePeer;
  status: "accepted";
  unreadCount: number;
};

export type DirectMessageRequestSummary = {
  bodyPreview: string;
  conversationId: string;
  createdAt: string | null;
  peer: DirectMessagePeer;
  riskFlags: DirectMessageRiskFlag[];
  riskScore: number;
};

export type DirectMessageInbox = {
  conversations: DirectMessageConversationSummary[];
  incomingRequests: DirectMessageRequestSummary[];
  isAuthenticated: boolean;
  outgoingRequests: DirectMessageRequestSummary[];
  pendingRequestCount: number;
  totalUnreadCount: number;
};

export type DirectMessage = {
  body: string;
  createdAt: string;
  id: string;
  isMine: boolean;
  kind: "chat" | "request";
  riskFlags: DirectMessageRiskFlag[];
  riskScore: number;
};

export type DirectMessageConversation = {
  canRespond: boolean;
  canSend: boolean;
  conversationId: string;
  messages: DirectMessage[];
  mutualFollow: boolean;
  nextCursor: string | null;
  peer: DirectMessagePeer;
  readOnlyReason: string | null;
  requestRole: DirectMessageRequestRole;
  status: DirectMessageConversationStatus;
};

export type DirectMessageSettings = {
  canUseSelectiveFilters: boolean;
  receiveMode: DirectMessageReceiveMode;
  requestFilter: DirectMessageRequestFilter;
};
