import { getLiveRoomHref } from "./adapters.ts";
import { getCommunityRoomSlugOrNull } from "./community.ts";
import type { CompanyRoomIdentity } from "./types.ts";

export const LIVE_ROOM_SHARE_PLATFORMS = [
  "x",
  "facebook",
  "reddit",
  "linkedin",
  "whatsapp",
  "telegram",
] as const;

export type LiveRoomSharePlatform =
  (typeof LIVE_ROOM_SHARE_PLATFORMS)[number];

export type LiveRoomInviteRoom =
  | {
      identity: CompanyRoomIdentity;
      kind: "company";
    }
  | {
      kind: "community";
      name: string;
      slug: string;
    };

export type LiveRoomInviteShareData = {
  text: string;
  title: string;
  url: string;
};

type LiveRoomInviteWindow = {
  opener: unknown;
};

export type LiveRoomInviteShareEnvironment = {
  canShare?: (data: LiveRoomInviteShareData) => boolean;
  clipboard?: {
    writeText: (value: string) => Promise<void>;
  };
  currentUrl: string;
  openWindow?: (
    url: string,
    target: "_blank",
    features: string,
  ) => LiveRoomInviteWindow | null;
  share?: (data: LiveRoomInviteShareData) => Promise<void>;
};

export type LiveRoomInviteActionResult =
  | "cancelled"
  | "copied"
  | "error"
  | "instagram-copied"
  | "native-fallback-copied"
  | "opened"
  | "popup-fallback-copied"
  | "shared";

export function createCanonicalLiveRoomInviteUrl(
  ticker: unknown,
  currentUrl: string,
) {
  const roomHref = getLiveRoomHref(ticker);
  return createCanonicalRoomUrl(roomHref, currentUrl);
}

export function createCanonicalCommunityRoomInviteUrl(
  slug: unknown,
  currentUrl: string,
) {
  const normalizedSlug = getCommunityRoomSlugOrNull(slug);
  const roomHref = normalizedSlug
    ? `/live/community/${encodeURIComponent(normalizedSlug)}`
    : null;
  return createCanonicalRoomUrl(roomHref, currentUrl);
}

export function createLiveRoomInviteShareData(
  identity: CompanyRoomIdentity,
  currentUrl: string,
): LiveRoomInviteShareData | null {
  return createLiveRoomInviteShareDataForRoom(
    { identity, kind: "company" },
    currentUrl,
  );
}

export function createCommunityRoomInviteShareData(
  room: { name: string; slug: string },
  currentUrl: string,
): LiveRoomInviteShareData | null {
  return createLiveRoomInviteShareDataForRoom(
    { kind: "community", name: room.name, slug: room.slug },
    currentUrl,
  );
}

export function createLiveRoomInviteShareDataForRoom(
  room: LiveRoomInviteRoom,
  currentUrl: string,
): LiveRoomInviteShareData | null {
  if (room.kind === "community") {
    const url = createCanonicalCommunityRoomInviteUrl(
      room.slug,
      currentUrl,
    );
    if (!url) return null;
    const name = room.name.trim();
    if (!name) return null;
    return {
      text: `Open the public Community Room "${name}" on Stock Radar.`,
      title: `${name} Community Room`,
      url,
    };
  }

  const url = createCanonicalLiveRoomInviteUrl(
    room.identity.ticker,
    currentUrl,
  );
  if (!url) return null;
  const company =
    room.identity.companyName.trim() || room.identity.ticker;
  const companyWithTicker = `${company} (${room.identity.ticker})`;
  return {
    text: `Open the public company Live Room for ${companyWithTicker}.`,
    title: `${companyWithTicker} Live Room`,
    url,
  };
}

export function createLiveRoomPlatformIntent(
  platform: LiveRoomSharePlatform,
  shareData: LiveRoomInviteShareData,
) {
  const publicMessage = `${shareData.title}\n${shareData.text}`;
  switch (platform) {
    // Official X Web Intent: https://docs.x.com/x-for-websites/web-intents/overview
    case "x":
      return createIntentUrl("https://x.com/intent/tweet", {
        text: publicMessage,
        url: shareData.url,
      });
    // Meta's documented dialog requires app_id. This no-key sharer is the
    // currently operating public web endpoint and accepts only the canonical URL.
    case "facebook":
      return createIntentUrl(
        "https://www.facebook.com/sharer/sharer.php",
        { u: shareData.url },
      );
    // Public submission endpoint; the title and canonical URL remain editable.
    case "reddit":
      return createIntentUrl("https://www.reddit.com/submit", {
        title: shareData.title,
        url: shareData.url,
      });
    // LinkedIn's public offsite composer derives preview copy from the URL.
    case "linkedin":
      return createIntentUrl(
        "https://www.linkedin.com/sharing/share-offsite/",
        { url: shareData.url },
      );
    // WhatsApp's public send endpoint accepts one prefilled message.
    case "whatsapp":
      return createIntentUrl("https://api.whatsapp.com/send", {
        text: `${publicMessage}\n${shareData.url}`,
      });
    // Official Telegram Sharing Button:
    // https://core.telegram.org/widgets/share
    case "telegram":
      return createIntentUrl("https://t.me/share/url", {
        text: publicMessage,
        url: shareData.url,
      });
  }
}

export function canUseLiveRoomNativeShare(
  shareData: LiveRoomInviteShareData,
  environment?: LiveRoomInviteShareEnvironment | null,
) {
  const resolvedEnvironment =
    environment === undefined
      ? readLiveRoomInviteShareEnvironment()
      : environment;
  if (!resolvedEnvironment?.share) return false;
  try {
    return resolvedEnvironment.canShare?.(shareData) ?? true;
  } catch {
    return false;
  }
}

export async function copyLiveRoomInvite(
  shareData: LiveRoomInviteShareData,
  environment?: LiveRoomInviteShareEnvironment | null,
): Promise<Extract<LiveRoomInviteActionResult, "copied" | "error">> {
  const resolvedEnvironment =
    environment === undefined
      ? readLiveRoomInviteShareEnvironment()
      : environment;
  try {
    if (!resolvedEnvironment?.clipboard) return "error";
    await resolvedEnvironment.clipboard.writeText(shareData.url);
    return "copied";
  } catch {
    return "error";
  }
}

export async function openLiveRoomPlatformIntent(input: {
  environment?: LiveRoomInviteShareEnvironment | null;
  platform: LiveRoomSharePlatform;
  shareData: LiveRoomInviteShareData;
}): Promise<
  Extract<
    LiveRoomInviteActionResult,
    "error" | "opened" | "popup-fallback-copied"
  >
> {
  const environment =
    input.environment === undefined
      ? readLiveRoomInviteShareEnvironment()
      : input.environment;
  if (!environment?.openWindow) return "error";

  const intentUrl = createLiveRoomPlatformIntent(
    input.platform,
    input.shareData,
  );
  let popup: LiveRoomInviteWindow | null = null;
  try {
    popup = environment.openWindow(
      intentUrl,
      "_blank",
      "noopener,noreferrer",
    );
  } catch {
    popup = null;
  }
  if (popup) {
    popup.opener = null;
    return "opened";
  }

  const copyResult = await copyLiveRoomInvite(
    input.shareData,
    environment,
  );
  return copyResult === "copied"
    ? "popup-fallback-copied"
    : "error";
}

export async function shareLiveRoomInviteNatively(input: {
  environment?: LiveRoomInviteShareEnvironment | null;
  shareData: LiveRoomInviteShareData;
}): Promise<
  Extract<
    LiveRoomInviteActionResult,
    "cancelled" | "error" | "native-fallback-copied" | "shared"
  >
> {
  const environment =
    input.environment === undefined
      ? readLiveRoomInviteShareEnvironment()
      : input.environment;
  if (!canUseLiveRoomNativeShare(input.shareData, environment)) {
    return "error";
  }
  try {
    await environment?.share?.(input.shareData);
    return "shared";
  } catch (error) {
    if (isWebShareCancellation(error)) return "cancelled";
  }

  const copyResult = await copyLiveRoomInvite(
    input.shareData,
    environment,
  );
  return copyResult === "copied"
    ? "native-fallback-copied"
    : "error";
}

export async function shareLiveRoomInviteToInstagram(input: {
  environment?: LiveRoomInviteShareEnvironment | null;
  shareData: LiveRoomInviteShareData;
}): Promise<
  Extract<
    LiveRoomInviteActionResult,
    "cancelled" | "error" | "instagram-copied" | "shared"
  >
> {
  const environment =
    input.environment === undefined
      ? readLiveRoomInviteShareEnvironment()
      : input.environment;
  if (canUseLiveRoomNativeShare(input.shareData, environment)) {
    try {
      await environment?.share?.(input.shareData);
      return "shared";
    } catch (error) {
      if (isWebShareCancellation(error)) return "cancelled";
    }
  }

  const copyResult = await copyLiveRoomInvite(
    input.shareData,
    environment,
  );
  return copyResult === "copied" ? "instagram-copied" : "error";
}

function createCanonicalRoomUrl(
  roomHref: string | null,
  currentUrl: string,
) {
  if (!roomHref) return null;
  try {
    return new URL(roomHref, new URL(currentUrl).origin).toString();
  } catch {
    return null;
  }
}

function createIntentUrl(
  baseUrl: string,
  parameters: Record<string, string>,
) {
  const url = new URL(baseUrl);
  for (const [key, value] of Object.entries(parameters)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function readLiveRoomInviteShareEnvironment():
  | LiveRoomInviteShareEnvironment
  | null {
  if (
    typeof window === "undefined" ||
    typeof navigator === "undefined"
  ) {
    return null;
  }

  return {
    canShare:
      typeof navigator.canShare === "function"
        ? (data) => navigator.canShare(data)
        : undefined,
    clipboard:
      typeof navigator.clipboard?.writeText === "function"
        ? {
            writeText: (value) =>
              navigator.clipboard.writeText(value),
          }
        : undefined,
    currentUrl: window.location.href,
    openWindow: (url, target, features) =>
      window.open(url, target, features),
    share:
      typeof navigator.share === "function"
        ? (data) => navigator.share(data)
        : undefined,
  };
}

function isWebShareCancellation(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "name" in error &&
      error.name === "AbortError",
  );
}
