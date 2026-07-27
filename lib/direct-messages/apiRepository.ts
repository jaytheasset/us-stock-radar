import { LiveRoomApiError } from "@/lib/live-room/apiRepository";
import type {
  DirectMessage,
  DirectMessageConversation,
  DirectMessageInbox,
  DirectMessageReportReason,
  DirectMessageSettings,
  DirectMessageStartResult,
} from "./types";

export const DIRECT_MESSAGE_POLL_INTERVAL_MS = 12_000;
export const DIRECT_MESSAGE_REFRESH_EVENT =
  "stock-radar:direct-message-refresh";

export class DirectMessageApiRepository {
  start(messageId: string) {
    return requestJson<DirectMessageStartResult>("/api/messages", {
      method: "POST",
      body: JSON.stringify({ messageId }),
    });
  }

  request(messageId: string, body: string) {
    return requestJson<DirectMessageStartResult>("/api/messages", {
      method: "POST",
      body: JSON.stringify({ body, messageId }),
    });
  }

  inbox() {
    return requestJson<DirectMessageInbox>("/api/messages");
  }

  read(
    conversationId: string,
    options: { before?: string | null } = {},
  ) {
    const search = new URLSearchParams({ limit: "50" });
    if (options.before) search.set("before", options.before);
    return requestJson<DirectMessageConversation>(
      `/api/messages/${encodeURIComponent(conversationId)}?${search}`,
    );
  }

  send(conversationId: string, body: string) {
    return requestJson<DirectMessage>(
      `/api/messages/${encodeURIComponent(conversationId)}`,
      {
        method: "POST",
        body: JSON.stringify({ body }),
      },
    );
  }

  markRead(conversationId: string, messageId?: string | null) {
    return requestJson<{ markedRead: boolean }>(
      `/api/messages/${encodeURIComponent(conversationId)}/read`,
      {
        method: "PUT",
        body: JSON.stringify({ messageId: messageId || null }),
      },
    );
  }

  respond(
    conversationId: string,
    action: "accept" | "block" | "decline",
  ) {
    return requestJson<{
      conversationId: string | null;
      status: "accepted" | "blocked" | "declined";
    }>(
      `/api/messages/${encodeURIComponent(conversationId)}/request`,
      {
        method: "PATCH",
        body: JSON.stringify({ action }),
      },
    );
  }

  report(
    conversationId: string,
    messageId: string,
    reason: DirectMessageReportReason,
  ) {
    return requestJson<{ reported: boolean }>(
      `/api/messages/${encodeURIComponent(conversationId)}/reports`,
      {
        method: "POST",
        body: JSON.stringify({ messageId, reason }),
      },
    );
  }

  readSettings() {
    return requestJson<DirectMessageSettings>(
      "/api/account/message-settings",
    );
  }

  writeSettings(settings: DirectMessageSettings) {
    return requestJson<DirectMessageSettings>(
      "/api/account/message-settings",
      {
        method: "PUT",
        body: JSON.stringify(settings),
      },
    );
  }
}

export function requestDirectMessageRefresh() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(DIRECT_MESSAGE_REFRESH_EVENT));
  }
}

async function requestJson<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
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
        : "LIVE_ROOM_DIRECT_REQUEST_FAILED",
      typeof payload?.message === "string"
        ? payload.message
        : "The message request failed.",
      response.status,
      typeof payload?.retryAfterSeconds === "number"
        ? payload.retryAfterSeconds
        : undefined,
    );
  }
  return payload?.data as T;
}
