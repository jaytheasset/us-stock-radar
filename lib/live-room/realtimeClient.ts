import {
  createClient,
  type RealtimeChannel,
} from "@supabase/supabase-js";

export type LiveRoomRealtimeConfig = {
  publishableKey: string;
  url: string;
  developmentAllowedOrigins?: readonly string[];
};

type LiveRoomRealtimeStatus =
  | "CHANNEL_ERROR"
  | "CLOSED"
  | "SUBSCRIBED"
  | "TIMED_OUT";

type LiveRoomRealtimeChannel = {
  on: (
    type: "broadcast",
    filter: { event: string },
    callback: () => void,
  ) => LiveRoomRealtimeChannel;
  subscribe: (
    callback: (status: LiveRoomRealtimeStatus) => void,
  ) => LiveRoomRealtimeChannel;
};

type LiveRoomRealtimeClient = {
  channel: (
    topic: string,
    options: { config: { private: false } },
  ) => LiveRoomRealtimeChannel;
  removeChannel: (
    channel: LiveRoomRealtimeChannel,
  ) => Promise<unknown> | unknown;
};

type LiveRoomRealtimeClientFactory = (
  config: LiveRoomRealtimeConfig,
) => LiveRoomRealtimeClient;

type ChannelListener = {
  onSignal: () => void;
  onStatus: (status: LiveRoomRealtimeStatus) => void;
};

type ManagedChannel = {
  channel: LiveRoomRealtimeChannel;
  listeners: Set<ChannelListener>;
};

type ChannelState = {
  current: ManagedChannel | null;
  removal: Promise<void> | null;
};

export type LiveRoomRealtimeChannelLease = {
  close: () => Promise<void>;
};

export class LiveRoomRealtimeClientRegistry {
  private readonly createRealtimeClient: LiveRoomRealtimeClientFactory;
  private readonly clients = new Map<
    string,
    Map<string, LiveRoomRealtimeClient>
  >();
  private readonly channels = new WeakMap<
    LiveRoomRealtimeClient,
    Map<string, ChannelState>
  >();

  constructor(
    createRealtimeClient: LiveRoomRealtimeClientFactory =
      createPublicRealtimeClient,
  ) {
    this.createRealtimeClient = createRealtimeClient;
  }

  async subscribe({
    config,
    onSignal,
    onStatus,
    topic,
  }: {
    config: LiveRoomRealtimeConfig;
    onSignal: () => void;
    onStatus: (status: LiveRoomRealtimeStatus) => void;
    topic: string;
  }): Promise<LiveRoomRealtimeChannelLease> {
    const client = this.getClient(config);
    const topics = this.getTopics(client);
    let state = topics.get(topic);
    if (!state) {
      state = { current: null, removal: null };
      topics.set(topic, state);
    }
    if (state.removal) await state.removal;

    const listener = { onSignal, onStatus };
    let managed = state.current;
    if (!managed) {
      const listeners = new Set<ChannelListener>([listener]);
      const channel = client
        .channel(topic, { config: { private: false } })
        .on("broadcast", { event: "live-room-changed" }, () => {
          listeners.forEach((current) => current.onSignal());
        })
        .subscribe((status) => {
          listeners.forEach((current) => current.onStatus(status));
        });
      managed = { channel, listeners };
      state.current = managed;
    } else {
      managed.listeners.add(listener);
    }

    let closed = false;
    return {
      close: async () => {
        if (closed) return;
        closed = true;
        managed.listeners.delete(listener);
        if (managed.listeners.size || state.current !== managed) return;

        state.current = null;
        const removal = Promise.resolve(
          client.removeChannel(managed.channel),
        )
          .catch(() => {
            // A disconnected socket can reject cleanup; the lease is still
            // closed and a later subscription must create a fresh channel.
          })
          .then(() => undefined);
        state.removal = removal;
        await removal;
        if (state.removal === removal) state.removal = null;
      },
    };
  }

  private getClient(config: LiveRoomRealtimeConfig) {
    let byKey = this.clients.get(config.url);
    if (!byKey) {
      byKey = new Map();
      this.clients.set(config.url, byKey);
    }
    let client = byKey.get(config.publishableKey);
    if (!client) {
      client = this.createRealtimeClient(config);
      byKey.set(config.publishableKey, client);
    }
    return client;
  }

  private getTopics(client: LiveRoomRealtimeClient) {
    let topics = this.channels.get(client);
    if (!topics) {
      topics = new Map();
      this.channels.set(client, topics);
    }
    return topics;
  }
}

const LIVE_ROOM_REALTIME_REGISTRY_KEY =
  "__stockRadarLiveRoomRealtimeRegistryV1__";

export function getLiveRoomRealtimeClientRegistry() {
  const scope = globalThis as typeof globalThis & {
    [LIVE_ROOM_REALTIME_REGISTRY_KEY]?: LiveRoomRealtimeClientRegistry;
  };
  scope[LIVE_ROOM_REALTIME_REGISTRY_KEY] ??=
    new LiveRoomRealtimeClientRegistry();
  return scope[LIVE_ROOM_REALTIME_REGISTRY_KEY];
}

function createPublicRealtimeClient(
  config: LiveRoomRealtimeConfig,
): LiveRoomRealtimeClient {
  const client = createClient(config.url, config.publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
  return {
    channel: (topic, options) => client.channel(topic, options),
    removeChannel: (channel) =>
      client.removeChannel(channel as RealtimeChannel),
  };
}
