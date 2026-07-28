import { LiveRoomApiError } from "@/lib/live-room/apiRepository";
import type {
  CommunityHubPeopleFilter,
  CommunityHubPeoplePage,
  CommunityHubRoomsPage,
} from "./types";

export class CommunityHubApiRepository {
  people(
    filter: CommunityHubPeopleFilter,
    cursor: string | null = null,
  ) {
    const search = new URLSearchParams({ filter });
    if (cursor) search.set("cursor", cursor);
    return requestJson<CommunityHubPeoplePage>(
      `/api/community/people?${search}`,
    );
  }

  rooms(cursor: string | null = null) {
    const search = new URLSearchParams();
    if (cursor) search.set("cursor", cursor);
    const suffix = search.size ? `?${search}` : "";
    return requestJson<CommunityHubRoomsPage>(
      `/api/community/rooms${suffix}`,
    );
  }

  setMemberFollow(publicProfileId: string, followed: boolean) {
    return requestJson<{
      followed: boolean;
      publicProfileId: string;
    }>("/api/community/people", {
      method: "PUT",
      body: JSON.stringify({ followed, publicProfileId }),
    });
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
  } | null;
  if (!response.ok || !("data" in (payload || {}))) {
    throw new LiveRoomApiError(
      typeof payload?.error === "string"
        ? payload.error
        : "COMMUNITY_HUB_REQUEST_FAILED",
      typeof payload?.message === "string"
        ? payload.message
        : "Community could not be loaded.",
      response.status,
    );
  }
  return payload?.data as T;
}
