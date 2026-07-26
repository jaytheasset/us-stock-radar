import type { Plan } from "../subscriptionPolicy.ts";

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
  | "loading"
  | "mock-fallback"
  | "mock-simulation";

export type LiveRoomProfile = {
  displayName: string;
  emoji: string;
  isGuest: boolean;
  plan: Plan;
};

export type LiveRoomChatMessage = {
  author: LiveRoomProfile;
  body: string;
  createdAt: string;
  eventReference: CompanyEventReference | null;
  id: string;
  kind: "message";
};

export type LiveRoomSystemUpdate = {
  createdAt: string;
  event: CompanyEvent;
  id: string;
  kind: "company_update";
};

export type LiveRoomTimelineItem =
  | LiveRoomChatMessage
  | LiveRoomSystemUpdate;

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

export type LiveRoomNotificationScope =
  | "all_room_messages"
  | "company_updates_only";

export type LiveRoomFollowPreference = {
  followed: boolean;
  notificationScope: LiveRoomNotificationScope;
  roomKey: CompanyRoomKey;
};

export interface LiveRoomFollowRepository {
  read(roomKey: CompanyRoomKey): LiveRoomFollowPreference;
  write(preference: LiveRoomFollowPreference): void;
}

export interface LiveRoomProfileRepository {
  read(): LiveRoomProfile;
  write(profile: LiveRoomProfile): void;
}
