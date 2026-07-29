import {
  serializeCompanyRoomKey,
} from "./adapters.ts";
import type {
  CompanyEvent,
  CompanyRoomKey,
  LiveRoomChatMessage,
  LiveRoomFollowPreference,
  LiveRoomFollowRepository,
  LiveRoomMessageDraft,
  LiveRoomMessageRepository,
  LiveRoomProfile,
  LiveRoomProfileRepository,
  LiveRoomTimelineItem,
  LiveRoomSystemUpdate,
} from "./types.ts";

const followStorageKey = "stock-radar:live-room:follows:v1";
const profileStorageKey = "stock-radar:live-room:guest-profile:v1";

export class InMemoryLiveRoomMessageRepository
  implements LiveRoomMessageRepository
{
  private readonly items = new Map<string, LiveRoomTimelineItem[]>();
  private readonly listeners = new Map<
    string,
    Set<(items: LiveRoomTimelineItem[]) => void>
  >();

  constructor(
    private readonly seed: (
      roomKey: CompanyRoomKey,
    ) => LiveRoomTimelineItem[] = createSeedMessages,
  ) {}

  async list(roomKey: CompanyRoomKey) {
    return this.readItems(roomKey);
  }

  async send(roomKey: CompanyRoomKey, draft: LiveRoomMessageDraft) {
    const message: LiveRoomChatMessage = {
      author: draft.author,
      body: draft.body,
      createdAt: new Date().toISOString(),
      eventReference: draft.eventReference,
      id: createId("message"),
      isLiked: false,
      kind: "message",
      likeCount: 0,
      replyCount: 0,
      replyPreview: null,
    };
    this.append(roomKey, message);
    return message;
  }

  async publishCompanyUpdate(roomKey: CompanyRoomKey, event: CompanyEvent) {
    const update: LiveRoomSystemUpdate = {
      createdAt: new Date().toISOString(),
      event,
      id: createId("update"),
      kind: "company_update",
    };
    this.append(roomKey, update);
    return update;
  }

  subscribe(
    roomKey: CompanyRoomKey,
    listener: (items: LiveRoomTimelineItem[]) => void,
  ) {
    const key = serializeCompanyRoomKey(roomKey);
    const listeners = this.listeners.get(key) ?? new Set();
    listeners.add(listener);
    this.listeners.set(key, listeners);
    return () => {
      listeners.delete(listener);
    };
  }

  private append(roomKey: CompanyRoomKey, item: LiveRoomTimelineItem) {
    const key = serializeCompanyRoomKey(roomKey);
    this.items.set(key, [...this.readItems(roomKey), item]);
    this.listeners.get(key)?.forEach((listener) => {
      listener(this.readItems(roomKey));
    });
  }

  private readItems(roomKey: CompanyRoomKey) {
    const key = serializeCompanyRoomKey(roomKey);
    if (!this.items.has(key)) {
      this.items.set(key, this.seed(roomKey));
    }
    return [...(this.items.get(key) ?? [])];
  }
}

export class BrowserLiveRoomFollowRepository
  implements LiveRoomFollowRepository
{
  read(roomKey: CompanyRoomKey): LiveRoomFollowPreference {
    const key = serializeCompanyRoomKey(roomKey);
    try {
      const stored = JSON.parse(
        localStorage.getItem(followStorageKey) ?? "{}",
      ) as Record<string, LiveRoomFollowPreference>;
      const preference = stored[key];
      if (preference?.roomKey && typeof preference.followed === "boolean") {
        return preference;
      }
    } catch (_) {}

    return {
      followed: false,
      notificationScope: "new_chat_messages",
      roomKey,
    };
  }

  write(preference: LiveRoomFollowPreference) {
    const key =
      preference.roomKey.kind === "community_slug"
        ? `community:${preference.roomKey.value}`
        : serializeCompanyRoomKey(preference.roomKey);
    try {
      const stored = JSON.parse(
        localStorage.getItem(followStorageKey) ?? "{}",
      ) as Record<string, LiveRoomFollowPreference>;
      localStorage.setItem(
        followStorageKey,
        JSON.stringify({ ...stored, [key]: preference }),
      );
    } catch (_) {}
  }
}

export class BrowserLiveRoomProfileRepository
  implements LiveRoomProfileRepository
{
  read(): LiveRoomProfile {
    try {
      const stored = JSON.parse(
        localStorage.getItem(profileStorageKey) ?? "null",
      ) as Partial<LiveRoomProfile> | null;
      if (
        stored &&
        typeof stored.displayName === "string" &&
        typeof stored.emoji === "string"
      ) {
        return {
          displayName: stored.displayName.trim().slice(0, 24) || "Guest",
          emoji: stored.emoji,
          isGuest: true,
          plan: "free",
        };
      }
    } catch (_) {}

    return {
      displayName: "Guest",
      emoji: "👋",
      isGuest: true,
      plan: "free",
    };
  }

  write(profile: LiveRoomProfile) {
    try {
      localStorage.setItem(
        profileStorageKey,
        JSON.stringify({
          ...profile,
          displayName: profile.displayName.trim().slice(0, 24) || "Guest",
          isGuest: true,
          plan: "free",
        }),
      );
    } catch (_) {}
  }
}

function createSeedMessages(
  roomKey: CompanyRoomKey,
): LiveRoomTimelineItem[] {
  const ticker = roomKey.value.toUpperCase();
  return [
    {
      author: {
        displayName: "Mina",
        emoji: "🦊",
        isGuest: false,
        plan: "pro",
      },
      body: `Watching how ${ticker} management frames the next quarter. The details matter more than the headline.`,
      createdAt: "2026-07-27T00:12:00.000Z",
      eventReference: null,
      id: "seed-message-1",
      isLiked: false,
      kind: "message",
      likeCount: 0,
      replyCount: 0,
      replyPreview: null,
    },
    {
      author: {
        displayName: "ChartPilot",
        emoji: "🛰️",
        isGuest: false,
        plan: "advanced",
      },
      body: "I am comparing the score with the filing language before changing my view.",
      createdAt: "2026-07-27T00:18:00.000Z",
      eventReference: null,
      id: "seed-message-2",
      isLiked: false,
      kind: "message",
      likeCount: 0,
      replyCount: 0,
      replyPreview: null,
    },
  ];
}

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
