import type {
  LiveRoomBlockedActor,
  LiveRoomBlockResult,
  LiveRoomChatMessage,
  LiveRoomMemberFollowResult,
  LiveRoomMemberSummaryList,
  LiveRoomMembershipList,
  LiveRoomMembershipState,
  LiveRoomMessageLikeResult,
  LiveRoomModerationItem,
  LiveRoomPost,
  LiveRoomPostComment,
  LiveRoomPostCommentDraft,
  LiveRoomPostCommentPage,
  LiveRoomPostDraft,
  LiveRoomPostLikeResult,
  LiveRoomPostPage,
  LiveRoomProfile,
  LiveRoomPresenceSetting,
  LiveRoomPresenceSummary,
  LiveRoomPublicMemberActions,
  LiveRoomPublicMemberFollowResult,
  LiveRoomPublicMemberPostPage,
  LiveRoomReportReason,
  LiveRoomTimelineItem,
  LiveRoomUnreadSummary,
} from "./types";
import {
  getLiveRoomRealtimeClientRegistry,
  type LiveRoomRealtimeChannelLease,
  type LiveRoomRealtimeConfig,
} from "./realtimeClient";

export type { LiveRoomRealtimeConfig } from "./realtimeClient";

export const LIVE_ROOM_FALLBACK_POLL_INTERVAL_MS = 45_000;
export const LIVE_ROOM_UNREAD_POLL_INTERVAL_MS = 60_000;
export const LIVE_ROOM_UNREAD_REFRESH_EVENT =
  "stock-radar:live-room-unread-refresh";
export const LIVE_ROOM_SIGNAL_DEBOUNCE_MS = 750;

export type LiveRoomMessagePage = {
  firstUnreadMessageId: string | null;
  initialMode: "latest" | "resume";
  isLatest: boolean;
  items: LiveRoomTimelineItem[];
  latestChangeCursor: string | null;
  latestCursor: string | null;
  nextCursor: string | null;
  unreadCount: number;
};

export type LiveRoomMessageChanges = {
  hasMore: boolean;
  latestChangeCursor: string | null;
  removedIds: string[];
  upserts: LiveRoomTimelineItem[];
};

export type LiveRoomUpdateSubscription = {
  close: () => void;
};

export type LiveRoomLocation =
  | string
  | { kind: "company"; ticker: string }
  | { kind: "community"; slug: string };

export interface LiveRoomUpdateTransport {
  subscribe(options: {
    afterChange: string | null;
    onError: (error: LiveRoomApiError) => void;
    onMessages: (messages: LiveRoomTimelineItem[]) => void;
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
  private readonly apiPath: string;
  private readonly realtimeTopicKey: string;

  constructor(
    location: LiveRoomLocation,
    realtimeConfig: LiveRoomRealtimeConfig | null = null,
  ) {
    const normalizedLocation =
      typeof location === "string"
        ? { kind: "company" as const, ticker: location }
        : location;
    if (normalizedLocation.kind === "community") {
      const slug = encodeURIComponent(normalizedLocation.slug);
      this.apiPath = `/api/live-room/community/${slug}`;
      this.realtimeTopicKey = `community:${normalizedLocation.slug}`;
    } else {
      const ticker = encodeURIComponent(normalizedLocation.ticker);
      this.apiPath = `/api/live-room/${ticker}`;
      this.realtimeTopicKey = normalizedLocation.ticker;
    }
    this.updates = new RealtimeLiveRoomUpdateTransport(
      this,
      this.realtimeTopicKey,
      realtimeConfig,
    );
  }

  list(
    options: {
      after?: string | null;
      before?: string | null;
      resume?: boolean;
    } = {},
  ) {
    const search = new URLSearchParams({ limit: "50" });
    if (options.after) search.set("after", options.after);
    if (options.before) search.set("before", options.before);
    if (options.resume) search.set("resume", "true");
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

  send(input: {
    body: string;
    eventId?: string | null;
    mediaId?: string | null;
    proofId?: string | null;
    replyToMessageId?: string | null;
  }) {
    return requestJson<LiveRoomChatMessage>(
      `${this.roomApiPath()}/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          body: input.body,
          eventId: input.eventId || null,
          mediaId: input.mediaId || null,
          proofId: input.proofId || null,
          replyToMessageId: input.replyToMessageId || null,
        }),
      },
    );
  }

  setMessageLike(messageId: string, liked: boolean) {
    return requestJson<LiveRoomMessageLikeResult>(
      `${this.roomApiPath()}/messages/${encodeURIComponent(messageId)}/like`,
      {
        method: "PUT",
        body: JSON.stringify({ liked }),
      },
    );
  }

  listPosts(before?: string | null) {
    const search = new URLSearchParams({ limit: "20" });
    if (before) search.set("before", before);
    return requestJson<LiveRoomPostPage>(
      `${this.roomApiPath()}/posts?${search}`,
    );
  }

  createPost(input: LiveRoomPostDraft) {
    return requestJson<LiveRoomPost>(`${this.roomApiPath()}/posts`, {
      method: "POST",
      body: JSON.stringify(input),
    });
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

  readMessageAnchor(messageId: string) {
    return requestJson<LiveRoomChatMessage>(
      `${this.roomApiPath()}/messages/${encodeURIComponent(messageId)}`,
    );
  }

  markRead(messageId: string | null) {
    return requestJson<{ markedRead: boolean }>(
      `${this.roomApiPath()}/read`,
      {
        method: "PUT",
        body: JSON.stringify({ messageId }),
      },
    );
  }

  markMemberActivityRead(messageId: string) {
    return requestJson<{ markedRead: boolean; messageId: string }>(
      `${this.roomApiPath()}/member-activity/read`,
      {
        method: "PUT",
        body: JSON.stringify({ messageId }),
      },
    );
  }

  writeMemberFollow(input: {
    followed: boolean;
    messageId: string;
  }) {
    return requestJson<LiveRoomMemberFollowResult>(
      `${this.roomApiPath()}/member-follow`,
      {
        method: "PUT",
        body: JSON.stringify(input),
      },
    );
  }

  readProfile() {
    return requestJson<LiveRoomProfile>("/api/live-room/profile");
  }

  writeProfile(input: Pick<LiveRoomProfile, "displayName">) {
    return requestJson<LiveRoomProfile>("/api/live-room/profile", {
      method: "PUT",
      body: JSON.stringify(input),
    });
  }

  readPresence(messageIds: readonly string[]) {
    return requestJson<LiveRoomPresenceSummary>(
      `${this.roomApiPath()}/presence`,
      {
        method: "POST",
        body: JSON.stringify({ messageIds: messageIds.slice(0, 50) }),
      },
    );
  }

  heartbeatPresence() {
    return requestJson<{ recorded: boolean }>(
      `${this.roomApiPath()}/presence`,
      { method: "PUT" },
    );
  }

  readPresenceSetting() {
    return requestJson<LiveRoomPresenceSetting>(
      "/api/live-room/presence/settings",
    );
  }

  writePresenceSetting(showPresence: boolean) {
    return requestJson<LiveRoomPresenceSetting>(
      "/api/live-room/presence/settings",
      {
        method: "PUT",
        body: JSON.stringify({ showPresence }),
      },
    );
  }

  readMembership() {
    return requestJson<LiveRoomMembershipState>(
      `${this.roomApiPath()}/membership`,
    );
  }

  joinRoom() {
    return requestJson<LiveRoomMembershipState>(
      `${this.roomApiPath()}/membership`,
      { method: "PUT" },
    );
  }

  leaveRoom() {
    return requestJson<LiveRoomMembershipState>(
      `${this.roomApiPath()}/membership`,
      { method: "DELETE" },
    );
  }

  listJoinedRooms(limit = 8) {
    const boundedLimit = Math.max(
      1,
      Math.min(
        Number.isFinite(limit) ? Math.trunc(limit) : 8,
        100,
      ),
    );
    return requestJson<LiveRoomMembershipList>(
      `/api/live-room/memberships?limit=${boundedLimit}`,
    );
  }

  listMemberSummaries(publicProfileIds: readonly string[]) {
    const search = new URLSearchParams();
    for (const publicProfileId of publicProfileIds.slice(0, 12)) {
      search.append("publicProfileId", publicProfileId);
    }
    return requestJson<LiveRoomMemberSummaryList>(
      `${this.roomApiPath()}/members?${search.toString()}`,
    );
  }

  private roomApiPath() {
    return this.apiPath;
  }
}

export class LiveRoomPostApiRepository {
  read(postId: string) {
    return requestJson<LiveRoomPost>(
      `/api/live-room/posts/${encodeURIComponent(postId)}`,
    );
  }

  update(postId: string, input: LiveRoomPostDraft) {
    return requestJson<LiveRoomPost>(
      `/api/live-room/posts/${encodeURIComponent(postId)}`,
      { method: "PATCH", body: JSON.stringify(input) },
    );
  }

  delete(postId: string) {
    return requestJson<{ deleted: true; postId: string }>(
      `/api/live-room/posts/${encodeURIComponent(postId)}`,
      { method: "DELETE" },
    );
  }

  toggleLike(postId: string) {
    return requestJson<LiveRoomPostLikeResult>(
      `/api/live-room/posts/${encodeURIComponent(postId)}/like`,
      { method: "POST" },
    );
  }

  report(postId: string, reason: LiveRoomReportReason) {
    return requestJson<{ reported: true }>(
      `/api/live-room/posts/${encodeURIComponent(postId)}/reports`,
      { method: "POST", body: JSON.stringify({ reason }) },
    );
  }

  block(postId: string) {
    return requestJson<LiveRoomBlockResult>(
      `/api/live-room/posts/${encodeURIComponent(postId)}/blocks`,
      { method: "POST" },
    );
  }

  moderate(
    postId: string,
    action: "hide" | "restore",
    reason?: string,
  ) {
    return requestJson<{
      action: "hide" | "restore";
      post: LiveRoomPost;
      postId: string;
    }>(
      `/api/live-room/posts/${encodeURIComponent(postId)}/moderation`,
      {
        method: "POST",
        body: JSON.stringify({ action, reason: reason || "" }),
      },
    );
  }

  listMemberPosts(publicProfileId: string, before?: string | null) {
    const search = new URLSearchParams({ limit: "20" });
    if (before) search.set("before", before);
    return requestJson<LiveRoomPublicMemberPostPage>(
      `/api/live-room/members/${encodeURIComponent(publicProfileId)}/posts?${search}`,
    );
  }

  readMemberActions(publicProfileId: string) {
    return requestJson<LiveRoomPublicMemberActions>(
      `/api/live-room/members/${encodeURIComponent(publicProfileId)}/actions`,
    );
  }

  writeMemberFollow(publicProfileId: string, followed: boolean) {
    return requestJson<LiveRoomPublicMemberFollowResult>(
      `/api/live-room/members/${encodeURIComponent(publicProfileId)}/actions`,
      {
        method: "PATCH",
        body: JSON.stringify({ followed }),
      },
    );
  }

  listComments(postId: string, after?: string | null) {
    const search = new URLSearchParams({ limit: "50" });
    if (after) search.set("after", after);
    return requestJson<LiveRoomPostCommentPage>(
      `/api/live-room/posts/${encodeURIComponent(postId)}/comments?${search}`,
    );
  }

  createComment(postId: string, input: LiveRoomPostCommentDraft) {
    return requestJson<LiveRoomPostComment>(
      `/api/live-room/posts/${encodeURIComponent(postId)}/comments`,
      { method: "POST", body: JSON.stringify(input) },
    );
  }

  updateComment(
    postId: string,
    commentId: string,
    input: LiveRoomPostCommentDraft,
  ) {
    return requestJson<LiveRoomPostComment>(
      `/api/live-room/posts/${encodeURIComponent(postId)}/comments/${encodeURIComponent(commentId)}`,
      { method: "PATCH", body: JSON.stringify(input) },
    );
  }

  deleteComment(postId: string, commentId: string) {
    return requestJson<{ commentId: string; deleted: true }>(
      `/api/live-room/posts/${encodeURIComponent(postId)}/comments/${encodeURIComponent(commentId)}`,
      { method: "DELETE" },
    );
  }

  reportComment(
    postId: string,
    commentId: string,
    reason: LiveRoomReportReason,
  ) {
    return requestJson<{ reported: true }>(
      `/api/live-room/posts/${encodeURIComponent(postId)}/comments/${encodeURIComponent(commentId)}/reports`,
      { method: "POST", body: JSON.stringify({ reason }) },
    );
  }
}

export function readLiveRoomUnreadSummary() {
  return requestJson<LiveRoomUnreadSummary>("/api/live-room/unread");
}

export function markLiveRoomPostActivityRead(activityId: string) {
  return requestJson<{ activityId: string; markedRead: boolean }>(
    `/api/live-room/activity/${encodeURIComponent(activityId)}/read`,
    { method: "PUT" },
  );
}

export function requestLiveRoomUnreadRefresh() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(LIVE_ROOM_UNREAD_REFRESH_EVENT));
  }
}

class RealtimeLiveRoomUpdateTransport
  implements LiveRoomUpdateTransport
{
  constructor(
    private readonly repository: LiveRoomApiRepository,
    private readonly topicKey: string,
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
    let realtimeLease: LiveRoomRealtimeChannelLease | null = null;

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
      void getLiveRoomRealtimeClientRegistry()
        .subscribe({
          config: this.realtimeConfig,
          onSignal: scheduleSignalSync,
          onStatus: (status) => {
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
          },
          topic: `live-room:${this.topicKey}`,
        })
        .then((lease) => {
          if (active) {
            realtimeLease = lease;
          } else {
            void lease.close();
          }
        })
        .catch((error) => {
          if (active) onError(toLiveRoomApiError(error));
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
        if (realtimeLease) void realtimeLease.close();
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

export async function requestJson<T>(
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
