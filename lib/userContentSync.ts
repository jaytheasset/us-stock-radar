export type UserContentChange =
  | {
      kind: "saved";
      contentId: string;
      contentType: "news" | "filing" | "live_room_post";
      value: boolean;
    }
  | {
      kind: "watchlist";
      ticker: string;
      value: boolean;
    };

const eventName = "stock-radar:user-content-change";
const channelName = "stock-radar-user-content";
const savedOverrides = new Map<string, boolean>();
const watchlistOverrides = new Map<string, boolean>();

export function getSavedContentOverride(
  contentType: "news" | "filing" | "live_room_post",
  contentId: string,
) {
  return savedOverrides.get(`${contentType}:${contentId.toLowerCase()}`);
}

export function getWatchlistOverride(ticker: string) {
  return watchlistOverrides.get(ticker.trim().toUpperCase());
}

export function publishUserContentChange(change: UserContentChange) {
  if (typeof window === "undefined") return;
  rememberChange(change);
  window.dispatchEvent(new CustomEvent<UserContentChange>(eventName, { detail: change }));

  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(channelName);
  channel.postMessage(change);
  channel.close();
}

export function subscribeToUserContentChanges(
  listener: (change: UserContentChange) => void,
) {
  if (typeof window === "undefined") return () => undefined;
  const handleWindowEvent = (event: Event) => {
    const change = (event as CustomEvent<UserContentChange>).detail;
    rememberChange(change);
    listener(change);
  };
  window.addEventListener(eventName, handleWindowEvent);

  const channel =
    typeof BroadcastChannel === "undefined"
      ? null
      : new BroadcastChannel(channelName);
  if (channel) {
    channel.onmessage = (event: MessageEvent<UserContentChange>) => {
      rememberChange(event.data);
      listener(event.data);
    };
  }

  return () => {
    window.removeEventListener(eventName, handleWindowEvent);
    channel?.close();
  };
}

function rememberChange(change: UserContentChange) {
  if (change.kind === "saved") {
    savedOverrides.set(
      `${change.contentType}:${change.contentId.toLowerCase()}`,
      change.value,
    );
    return;
  }
  watchlistOverrides.set(change.ticker.trim().toUpperCase(), change.value);
}
