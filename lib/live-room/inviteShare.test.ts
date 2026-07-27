import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createCanonicalLiveRoomInviteUrl,
  createLiveRoomInviteShareData,
  shareLiveRoomInvite,
} from "./inviteShare.ts";
import type { CompanyRoomIdentity } from "./types.ts";

const identity: CompanyRoomIdentity = {
  companyName: "Apple Inc.",
  exchange: "Nasdaq",
  roomKey: { kind: "ticker_fallback", value: "AAPL" },
  ticker: "AAPL",
};

test("canonical Live Room invite URLs remove message anchors, tracking query, and hashes", () => {
  assert.equal(
    createCanonicalLiveRoomInviteUrl(
      "aapl",
      "https://radar.example/live/AAPL?message=public-message&utm_source=inbox#chat",
    ),
    "https://radar.example/live/AAPL",
  );
  assert.equal(
    createCanonicalLiveRoomInviteUrl(
      "bad ticker",
      "https://radar.example/live/AAPL",
    ),
    null,
  );
});

test("Live Room share data uses the public company name and ticker without changing the canonical URL", () => {
  assert.deepEqual(
    createLiveRoomInviteShareData(
      identity,
      "https://radar.example/live/AAPL?message=public-message",
    ),
    {
      text: "Open the public company Live Room for Apple Inc. (AAPL).",
      title: "Apple Inc. (AAPL) Live Room",
      url: "https://radar.example/live/AAPL",
    },
  );
});

test("mobile-capable browsers use Web Share and report success", async () => {
  let sharedUrl = "";
  let copied = false;
  const result = await shareLiveRoomInvite({
    environment: {
      clipboard: {
        writeText: async () => {
          copied = true;
        },
      },
      coarsePointer: true,
      currentUrl:
        "https://radar.example/live/AAPL?message=public-message#chat",
      share: async (data) => {
        sharedUrl = data.url;
      },
    },
    identity,
  });

  assert.equal(result, "shared");
  assert.equal(copied, false);
  assert.equal(sharedUrl, "https://radar.example/live/AAPL");
});

test("cancelled Web Share does not copy to the clipboard", async () => {
  let copied = false;
  const result = await shareLiveRoomInvite({
    environment: {
      clipboard: {
        writeText: async () => {
          copied = true;
        },
      },
      currentUrl: "https://radar.example/live/AAPL",
      maxTouchPoints: 1,
      share: async () => {
        throw Object.assign(new Error("Share cancelled"), {
          name: "AbortError",
        });
      },
    },
    identity,
  });

  assert.equal(result, "cancelled");
  assert.equal(copied, false);
});

test("a real Web Share failure falls back to the canonical clipboard URL", async () => {
  let copiedUrl = "";
  const result = await shareLiveRoomInvite({
    environment: {
      clipboard: {
        writeText: async (value) => {
          copiedUrl = value;
        },
      },
      currentUrl:
        "https://radar.example/live/AAPL?message=public-message&utm_source=people",
      maxTouchPoints: 1,
      share: async () => {
        throw new Error("Share service unavailable");
      },
    },
    identity,
  });

  assert.equal(result, "copied");
  assert.equal(copiedUrl, "https://radar.example/live/AAPL");
});

test("desktop browsers naturally copy even when Web Share exists", async () => {
  let shareCalls = 0;
  let copiedUrl = "";
  const result = await shareLiveRoomInvite({
    environment: {
      clipboard: {
        writeText: async (value) => {
          copiedUrl = value;
        },
      },
      coarsePointer: false,
      currentUrl: "https://radar.example/live/AAPL",
      maxTouchPoints: 0,
      share: async () => {
        shareCalls += 1;
      },
    },
    identity,
  });

  assert.equal(result, "copied");
  assert.equal(shareCalls, 0);
  assert.equal(copiedUrl, "https://radar.example/live/AAPL");
});

test("Invite reports an error when Web Share and clipboard fallback both fail", async () => {
  const result = await shareLiveRoomInvite({
    environment: {
      clipboard: {
        writeText: async () => {
          throw new Error("Clipboard unavailable");
        },
      },
      coarsePointer: true,
      currentUrl: "https://radar.example/live/AAPL?message=public-message",
      share: async () => {
        throw new Error("Share unavailable");
      },
    },
    identity,
  });

  assert.equal(result, "error");
});

test("Live Room invite sharing is safe when browser APIs are unavailable", async () => {
  assert.equal(
    await shareLiveRoomInvite({ environment: null, identity }),
    "error",
  );
});
