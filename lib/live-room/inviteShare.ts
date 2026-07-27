import { getLiveRoomHref } from "./adapters.ts";
import type { CompanyRoomIdentity } from "./types.ts";

export type LiveRoomInviteShareData = {
  text: string;
  title: string;
  url: string;
};

export type LiveRoomInviteShareEnvironment = {
  canShare?: (data: LiveRoomInviteShareData) => boolean;
  clipboard?: {
    writeText: (value: string) => Promise<void>;
  };
  coarsePointer?: boolean;
  currentUrl: string;
  maxTouchPoints?: number;
  share?: (data: LiveRoomInviteShareData) => Promise<void>;
};

export type LiveRoomInviteShareResult =
  | "cancelled"
  | "copied"
  | "error"
  | "shared";

export type LiveRoomInviteUiState =
  | Exclude<LiveRoomInviteShareResult, "cancelled">
  | "idle"
  | "working";

export function createCanonicalLiveRoomInviteUrl(
  ticker: unknown,
  currentUrl: string,
) {
  const roomHref = getLiveRoomHref(ticker);
  if (!roomHref) return null;

  try {
    return new URL(roomHref, new URL(currentUrl).origin).toString();
  } catch {
    return null;
  }
}

export function createLiveRoomInviteShareData(
  identity: CompanyRoomIdentity,
  currentUrl: string,
): LiveRoomInviteShareData | null {
  const url = createCanonicalLiveRoomInviteUrl(
    identity.ticker,
    currentUrl,
  );
  if (!url) return null;

  const company = identity.companyName.trim() || identity.ticker;
  const companyWithTicker = `${company} (${identity.ticker})`;
  return {
    text: `Open the public company Live Room for ${companyWithTicker}.`,
    title: `${companyWithTicker} Live Room`,
    url,
  };
}

export function shouldPreferLiveRoomWebShare(
  environment: LiveRoomInviteShareEnvironment,
) {
  return Boolean(
    environment.share &&
      (environment.coarsePointer ||
        (environment.maxTouchPoints ?? 0) > 0),
  );
}

export async function shareLiveRoomInvite(input: {
  environment?: LiveRoomInviteShareEnvironment | null;
  identity: CompanyRoomIdentity;
}): Promise<LiveRoomInviteShareResult> {
  const environment =
    input.environment === undefined
      ? readLiveRoomInviteShareEnvironment()
      : input.environment;
  if (!environment) return "error";

  const shareData = createLiveRoomInviteShareData(
    input.identity,
    environment.currentUrl,
  );
  if (!shareData) return "error";

  if (shouldPreferLiveRoomWebShare(environment)) {
    let canShare = true;
    try {
      canShare = environment.canShare?.(shareData) ?? true;
    } catch {
      canShare = false;
    }

    if (canShare) {
      try {
        await environment.share?.(shareData);
        return "shared";
      } catch (error) {
        if (isWebShareCancellation(error)) return "cancelled";
      }
    }
  }

  try {
    if (!environment.clipboard) return "error";
    await environment.clipboard.writeText(shareData.url);
    return "copied";
  } catch {
    return "error";
  }
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
    coarsePointer:
      typeof window.matchMedia === "function"
        ? window.matchMedia("(pointer: coarse)").matches
        : false,
    currentUrl: window.location.href,
    maxTouchPoints: navigator.maxTouchPoints,
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
