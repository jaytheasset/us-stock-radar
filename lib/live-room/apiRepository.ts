import {
  createClient,
  type RealtimeChannel,
  type SupabaseClient,
} from "@supabase/supabase-js";
import type {
  LiveRoomBlockedActor,
  LiveRoomBlockResult,
  LiveRoomChatMessage,
  LiveRoomFollowPreference,
  LiveRoomModerationItem,
  LiveRoomProfile,
  LiveRoomReportReason,
} from "./types";

export const LIVE_ROOM_FALLBACK_POLL_INTERVAL_MS = 45_000;
export const LIVE_ROOM_SIGNAL_DEBOUNCE_MS = 750;

export type LiveRoomRealtimeConfig = {
  publishableKey: string;
  url: string;
};

export type LiveRoomMessagePage = {
  items: LiveRoomChatMessage[];
  latestChangeCursor: string | null;
  latestCursor: string | null;
  nextCursor: string | null;
};

export type LiveRoomMessageChanges = {
  hasMore: boolean;
  latestChangeCursor: string | null;
  removedIds: string[];
  upserts: LiveRoomChatMessage[];
};

export type LiveRoomUpdateSubscription = {
  close: () => void;
};

export interface LiveRoomUpdateTransport {
  subscribe(options: {
    afterChange: string | null;
    onError: (error: LiveRoomApiError) => void;
    onMessages: (messages: LiveRoomChatMessage[]) => void;
    onRemoved: (messageIds: string[]) => void;
    onSynced: () => void;
  }): LiveRoomUpdateSubscription;
}

export class LiveRoomApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryAfterSeconds?: number;

  constructor(
    code: string,
    message: string,
    status: number,
    retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "LiveRoomApiError";
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class LiveRoomApiRepository {
  readonly updates: LiveRoomUpdateTransport;

  constructor(
    private readonly ticker: string,
    realtimeConfig: LiveRoomRealtimeConfig | null = null,
  ) {
    this.updates = new RealtimeLiveRoomUpdateTransport(
      this,
      ticker,
      realtimeConfig,
    );
  }

  list(options: { after?: string | null; before?: string | null } = {}) {
    const search = new URLSearchParams({ limit: "50" });
    if (options.after) search.set("after", options.after);
    if (options.before) search.set("before", options.before);
    return requestJson<LiveRoomMessagePage>(
      `${this.roomApiPath()}/messages?${search}`,
    );
  }

  changes(afterChange: string | null) {
    const search = new URLSearchParams({ limit: "100", mode: "changes" });
    if (afterChange) search.set("changesAfter", afterChange);
    return requestJson<LiveRoomMessageChanges>(
      `${this.roomApiPath()}/messages?${search}`,
    );
  }

  send(input: { body: string; eventId?: string | null }) {
    return requestJson<LiveRoomChatMessage>(
      `${this.roomApiPath()}/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          body: input.body,
          eventId: input.eventId || null,
        }),
      },
    );
  }

  report(messageId: string, reason: LiveRoomReportReason) {
    return requestJson<{ reported: true }>(
      `${this.roomApiPath()}/reports`,
      {
        method: "POST",
        body: JSON.stringify({ messageId, reason }),
      },
    );
  }

  block(messageId: string) {
    return requestJson<LiveRoomBlockResult>(
      `${this.roomApiPath()}/blocks`,
      {
        method: "POST",
        body: JSON.stringify({ messageId }),
      },
    );
  }

  listBlocks() {
    return requestJson<LiveRoomBlockedActor[]>(
      `${this.roomApiPath()}/blocks`,
    );
  }

  unblock(blockId: string) {
    return requestJson<{ removed: true }>(
      `${this.roomApiPath()}/blocks/${encodeURIComponent(blockId)}`,
      { method: "DELETE" },
    );
  }

  listHiddenMessages() {
    return requestJson<LiveRoomModerationItem[]>(
      `${this.roomApiPath()}/moderation`,
    );
  }

  moderate(
    messageId: string,
    action: "hide" | "restore",
    reason?: string,
  ) {
    return requestJson<{
      action: "hide" | "restore";
      message: LiveRoomChatMessage | null;
      messageId: string;
    }>(
      `${this.roomApiPath()}/moderation`,
      {
        method: "POST",
        body: JSON.stringify({ messageId, action, reason: reason || "" }),
      },
    );
  }

  readFollow() {
    return requestJson<LiveRoomFollowPreference>(
      `${this.roomApiPath()}/follow`,
    );
  }

  writeFollow(input: {
    followed: boolean;
    notificationScope: LiveRoomFollowPreference["notificationScope"];
  }) {
    return requestJson<LiveRoomFollowPreference>(
      `${this.roomApiPath()}/follow`,
      {
        method: "PUT",
        body: JSON.stringify(input),
      },
    );
  }

  readProfile() {
    return requestJson<LiveRoomProfile>("/api/live-room/profile");
  }

  writeProfile(input: Pick<LiveRoomProfile, "displayName" | "emoji">) {
    return requestJson<LiveRoomProfile>("/api/live-room/profile", {
      method: "PUT",
      body: JSON.stringify(input),
    });
  }

  private roomApiPath() {
    return `/api/live-room/${encodeURIComponent(this.ticker)}`;
  }
}

class RealtimeLiveRoomUpdateTransport
  implements LiveRoomUpdateTransport
{
  constructor(
    private readonly repository: LiveRoomApiRepository,
    private readonly ticker: string,
    private readonly realtimeConfig: LiveRoomRealtimeConfig | null,
  ) {}

  subscribe({
    afterChange,
    onError,
    onMessages,
    onRemoved,
    onSynced,
  }: Parameters<LiveRoomUpdateTransport["subscribe"]>[0]) {
    let active = true;
    let changeCursor = afterChange;
    let fallbackTimer: number | null = null;
    let signalTimer: number | null = null;
    let inFlight = false;
    let queued = false;
    let client: SupabaseClient | null = null;
    let channel: RealtimeChannel | null = null;

    const scheduleFallback = () => {
      if (!active) return;
      if (fallbackTimer !== null) window.clearTimeout(fallbackTimer);
      fallbackTimer = window.setTimeout(
        () => void syncChanges(),
        LIVE_ROOM_FALLBACK_POLL_INTERVAL_MS,
      );
    };

    const syncChanges = async () => {
      if (!active) return;
      if (document.visibilityState === "hidden") {
        scheduleFallback();
        return;
      }
      if (inFlight) {
        queued = true;
        return;
      }

      inFlight = true;
      try {
        let hasMore = true;
        let pageCount = 0;
        while (active && hasMore && pageCount < 10) {
          const page = await this.repository.changes(changeCursor);
          if (!active) return;
          if (page.latestChangeCursor) {
            changeCursor = page.latestChangeCursor;
          }
          if (page.upserts.length) onMessages(page.upserts);
          if (page.removedIds.length) onRemoved(page.removedIds);
          hasMore = page.hasMore;
          pageCount += 1;
        }
        onSynced();
      } catch (error) {
        if (active) onError(toLiveRoomApiError(error));
      } finally {
        inFlight = false;
        scheduleFallback();
        if (queued && active) {
          queued = false;
          void syncChanges();
        }
      }
    };

    const scheduleSignalSync = () => {
      if (!active) return;
      if (signalTimer !== null) window.clearTimeout(signalTimer);
      signalTimer = window.setTimeout(() => {
        signalTimer = null;
        void syncChanges();
      }, LIVE_ROOM_SIGNAL_DEBOUNCE_MS);
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void syncChanges();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    if (isUsableRealtimeConfig(this.realtimeConfig)) {
      client = createClient(
        this.realtimeConfig.url,
        this.realtimeConfig.publishableKey,
        {
          auth: {
            autoRefreshToken: false,
            detectSessionInUrl: false,
            persistSession: false,
          },
        },
      );
      channel = client
        .channel(`live-room:${this.ticker}`, {
          config: { private: false },
        })
        .on(
          "broadcast",
          { event: "live-room-changed" },
          scheduleSignalSync,
        )
        .subscribe((status) => {
          if (!active) return;
          if (status === "SUBSCRIBED") {
            void syncChanges();
          } else if (
            status === "CHANNEL_ERROR" ||
            status === "TIMED_OUT" ||
            status === "CLOSED"
          ) {
            onError(
              new LiveRoomApiError(
                "LIVE_ROOM_REALTIME_DISCONNECTED",
                "Live updates disconnected; low-frequency retry is active.",
                0,
              ),
            );
          }
        });
    }

    scheduleFallback();
    return {
      close: () => {
        active = false;
        document.removeEventListener(
          "visibilitychange",
          onVisibilityChange,
        );
        if (fallbackTimer !== null) window.clearTimeout(fallbackTimer);
        if (signalTimer !== null) window.clearTimeout(signalTimer);
        if (client && channel) void client.removeChannel(channel);
      },
    };
  }
}

function isUsableRealtimeConfig(
  value: LiveRoomRealtimeConfig | null,
): value is LiveRoomRealtimeConfig {
  if (!value?.publishableKey) return false;
  try {
    const url = new URL(value.url);
    return (
      url.protocol === "https:" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "localhost"
    );
  } catch {
    return false;
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const payload = (await response.json().catch(() => null)) as {
    data?: T;
    error?: unknown;
    message?: unknown;
    retryAfterSeconds?: unknown;
  } | null;

  if (!response.ok || !("data" in (payload || {}))) {
    throw new LiveRoomApiError(
      typeof payload?.error === "string"
        ? payload.error
        : "LIVE_ROOM_REQUEST_FAILED",
      typeof payload?.message === "string"
        ? payload.message
        : "The Live Room request failed.",
      response.status,
      typeof payload?.retryAfterSeconds === "number"
        ? payload.retryAfterSeconds
        : undefined,
    );
  }

  return payload?.data as T;
}

export function toLiveRoomApiError(error: unknown) {
  return error instanceof LiveRoomApiError
    ? error
    : new LiveRoomApiError(
        "LIVE_ROOM_REQUEST_FAILED",
        "The Live Room request failed.",
        0,
      );
}
