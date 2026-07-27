import type {
  LiveRoomChatMessage,
  LiveRoomFollowPreference,
  LiveRoomProfile,
} from "./types";

export const LIVE_ROOM_POLL_INTERVAL_MS = 4_000;

export type LiveRoomMessagePage = {
  items: LiveRoomChatMessage[];
  latestCursor: string | null;
  nextCursor: string | null;
};

export type LiveRoomUpdateSubscription = {
  close: () => void;
};

export interface LiveRoomUpdateTransport {
  subscribe(options: {
    after: string | null;
    onError: (error: LiveRoomApiError) => void;
    onMessages: (
      messages: LiveRoomChatMessage[],
      latestCursor: string | null,
    ) => void;
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

  constructor(private readonly ticker: string) {
    this.updates = new PollingLiveRoomUpdateTransport(this);
  }

  list(options: { after?: string | null; before?: string | null } = {}) {
    const search = new URLSearchParams({ limit: "50" });
    if (options.after) search.set("after", options.after);
    if (options.before) search.set("before", options.before);
    return requestJson<LiveRoomMessagePage>(
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

class PollingLiveRoomUpdateTransport
  implements LiveRoomUpdateTransport
{
  constructor(private readonly repository: LiveRoomApiRepository) {}

  subscribe({
    after,
    onError,
    onMessages,
  }: Parameters<LiveRoomUpdateTransport["subscribe"]>[0]) {
    let active = true;
    let cursor = after;
    let timer: number | null = null;
    let inFlight = false;

    const schedule = () => {
      if (!active) return;
      timer = window.setTimeout(poll, LIVE_ROOM_POLL_INTERVAL_MS);
    };

    const poll = async () => {
      if (!active || inFlight) return;
      if (document.visibilityState === "hidden") {
        schedule();
        return;
      }
      inFlight = true;
      try {
        const page = await this.repository.list({ after: cursor });
        if (!active) return;
        if (page.latestCursor) cursor = page.latestCursor;
        if (page.items.length) {
          onMessages(page.items, page.latestCursor);
        }
      } catch (error) {
        if (active) onError(toLiveRoomApiError(error));
      } finally {
        inFlight = false;
        schedule();
      }
    };

    schedule();
    return {
      close: () => {
        active = false;
        if (timer !== null) window.clearTimeout(timer);
      },
    };
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

  if (!response.ok || !payload?.data) {
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

  return payload.data;
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
