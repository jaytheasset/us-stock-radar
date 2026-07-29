import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  LIVE_ROOM_SHARE_PLATFORMS,
  canUseLiveRoomNativeShare,
  copyLiveRoomInvite,
  createCanonicalCommunityRoomInviteUrl,
  createCanonicalLiveRoomInviteUrl,
  createCommunityRoomInviteShareData,
  createLiveRoomInviteShareData,
  createLiveRoomPlatformIntent,
  openLiveRoomPlatformIntent,
  shareLiveRoomInviteNatively,
  shareLiveRoomInviteToInstagram,
  type LiveRoomInviteShareData,
} from "./inviteShare.ts";
import type { CompanyRoomIdentity } from "./types.ts";

const identity: CompanyRoomIdentity = {
  companyName: "Apple Inc.",
  exchange: "Nasdaq",
  roomKey: { kind: "ticker_fallback", value: "AAPL" },
  ticker: "AAPL",
};

const companyShareData: LiveRoomInviteShareData = {
  text: "Open the public company Live Room for Apple Inc. (AAPL).",
  title: "Apple Inc. (AAPL) Live Room",
  url: "https://radar.example/live/AAPL",
};

function readSource(relativePath: string) {
  return readFileSync(
    new URL(`../../${relativePath}`, import.meta.url),
    "utf8",
  );
}

test("canonical invite URLs remove message anchors, query, and hashes for both room kinds", () => {
  assert.equal(
    createCanonicalLiveRoomInviteUrl(
      "aapl",
      "https://radar.example/live/AAPL?message=public-message&utm_source=inbox#chat",
    ),
    "https://radar.example/live/AAPL",
  );
  assert.equal(
    createCanonicalCommunityRoomInviteUrl(
      "small-cap-research-ab12",
      "https://radar.example/live/community/small-cap-research-ab12?message=public-message#chat",
    ),
    "https://radar.example/live/community/small-cap-research-ab12",
  );
  assert.equal(
    createCanonicalLiveRoomInviteUrl(
      "bad ticker",
      "https://radar.example/live/AAPL",
    ),
    null,
  );
  assert.equal(
    createCanonicalCommunityRoomInviteUrl("bad", "https://radar.example/live"),
    null,
  );
});

test("company and Community rooms use distinct public share copy", () => {
  assert.deepEqual(
    createLiveRoomInviteShareData(
      identity,
      "https://radar.example/live/AAPL?message=public-message",
    ),
    companyShareData,
  );
  assert.deepEqual(
    createCommunityRoomInviteShareData(
      {
        name: "Small Cap Research",
        slug: "small-cap-research-ab12",
      },
      "https://radar.example/live/community/small-cap-research-ab12?utm_source=activity#chat",
    ),
    {
      text: 'Open the public Community Room "Small Cap Research" on Stock Radar.',
      title: "Small Cap Research Community Room",
      url: "https://radar.example/live/community/small-cap-research-ab12",
    },
  );
});

test("platform intents encode only canonical public room data", () => {
  assert.deepEqual(LIVE_ROOM_SHARE_PLATFORMS, [
    "x",
    "facebook",
    "reddit",
    "linkedin",
    "whatsapp",
    "telegram",
  ]);
  assert.equal(
    createLiveRoomPlatformIntent("x", companyShareData),
    "https://x.com/intent/tweet?text=Apple+Inc.+%28AAPL%29+Live+Room%0AOpen+the+public+company+Live+Room+for+Apple+Inc.+%28AAPL%29.&url=https%3A%2F%2Fradar.example%2Flive%2FAAPL",
  );
  assert.equal(
    createLiveRoomPlatformIntent("facebook", companyShareData),
    "https://www.facebook.com/sharer/sharer.php?u=https%3A%2F%2Fradar.example%2Flive%2FAAPL",
  );
  assert.equal(
    createLiveRoomPlatformIntent("reddit", companyShareData),
    "https://www.reddit.com/submit?title=Apple+Inc.+%28AAPL%29+Live+Room&url=https%3A%2F%2Fradar.example%2Flive%2FAAPL",
  );
  assert.equal(
    createLiveRoomPlatformIntent("linkedin", companyShareData),
    "https://www.linkedin.com/sharing/share-offsite/?url=https%3A%2F%2Fradar.example%2Flive%2FAAPL",
  );
  assert.equal(
    createLiveRoomPlatformIntent("whatsapp", companyShareData),
    "https://api.whatsapp.com/send?text=Apple+Inc.+%28AAPL%29+Live+Room%0AOpen+the+public+company+Live+Room+for+Apple+Inc.+%28AAPL%29.%0Ahttps%3A%2F%2Fradar.example%2Flive%2FAAPL",
  );
  assert.equal(
    createLiveRoomPlatformIntent("telegram", companyShareData),
    "https://t.me/share/url?text=Apple+Inc.+%28AAPL%29+Live+Room%0AOpen+the+public+company+Live+Room+for+Apple+Inc.+%28AAPL%29.&url=https%3A%2F%2Fradar.example%2Flive%2FAAPL",
  );
});

test("platform popup uses noopener noreferrer and blocked popups preserve the link", async () => {
  let openedUrl = "";
  let openedFeatures = "";
  let opener: unknown = "unsafe";
  const result = await openLiveRoomPlatformIntent({
    environment: {
      currentUrl: companyShareData.url,
      openWindow: (url, target, features) => {
        assert.equal(target, "_blank");
        openedUrl = url;
        openedFeatures = features;
        return {
          get opener() {
            return opener;
          },
          set opener(value: unknown) {
            opener = value;
          },
        };
      },
    },
    platform: "x",
    shareData: companyShareData,
  });

  assert.equal(result, "opened");
  assert.equal(openedUrl, createLiveRoomPlatformIntent("x", companyShareData));
  assert.equal(openedFeatures, "noopener,noreferrer");
  assert.equal(opener, null);

  let copiedUrl = "";
  assert.equal(
    await openLiveRoomPlatformIntent({
      environment: {
        clipboard: {
          writeText: async (value) => {
            copiedUrl = value;
          },
        },
        currentUrl: companyShareData.url,
        openWindow: () => null,
      },
      platform: "reddit",
      shareData: companyShareData,
    }),
    "popup-fallback-copied",
  );
  assert.equal(copiedUrl, companyShareData.url);
});

test("native share support, success, cancellation, and failure fallback stay explicit", async () => {
  let sharedUrl = "";
  let copiedUrl = "";
  const environment = {
    canShare: () => true,
    clipboard: {
      writeText: async (value: string) => {
        copiedUrl = value;
      },
    },
    currentUrl: companyShareData.url,
    share: async (data: LiveRoomInviteShareData) => {
      sharedUrl = data.url;
    },
  };
  assert.equal(canUseLiveRoomNativeShare(companyShareData, environment), true);
  assert.equal(
    await shareLiveRoomInviteNatively({
      environment,
      shareData: companyShareData,
    }),
    "shared",
  );
  assert.equal(sharedUrl, companyShareData.url);
  assert.equal(copiedUrl, "");

  let cancellationCopied = false;
  assert.equal(
    await shareLiveRoomInviteNatively({
      environment: {
        canShare: () => true,
        clipboard: {
          writeText: async () => {
            cancellationCopied = true;
          },
        },
        currentUrl: companyShareData.url,
        share: async () => {
          throw Object.assign(new Error("Share cancelled"), {
            name: "AbortError",
          });
        },
      },
      shareData: companyShareData,
    }),
    "cancelled",
  );
  assert.equal(cancellationCopied, false);

  assert.equal(
    await shareLiveRoomInviteNatively({
      environment: {
        canShare: () => true,
        clipboard: {
          writeText: async (value) => {
            copiedUrl = value;
          },
        },
        currentUrl: companyShareData.url,
        share: async () => {
          throw new Error("Share unavailable");
        },
      },
      shareData: companyShareData,
    }),
    "native-fallback-copied",
  );
  assert.equal(copiedUrl, companyShareData.url);
});

test("copy link reports success and failure without changing Invite", async () => {
  let copiedUrl = "";
  assert.equal(
    await copyLiveRoomInvite(companyShareData, {
      clipboard: {
        writeText: async (value) => {
          copiedUrl = value;
        },
      },
      currentUrl: companyShareData.url,
    }),
    "copied",
  );
  assert.equal(copiedUrl, companyShareData.url);
  assert.equal(
    await copyLiveRoomInvite(companyShareData, {
      clipboard: {
        writeText: async () => {
          throw new Error("Clipboard unavailable");
        },
      },
      currentUrl: companyShareData.url,
    }),
    "error",
  );
});

test("Instagram uses native share when possible and otherwise copies with guidance", async () => {
  let shareCalls = 0;
  let copiedUrl = "";
  assert.equal(
    await shareLiveRoomInviteToInstagram({
      environment: {
        canShare: () => true,
        currentUrl: companyShareData.url,
        share: async () => {
          shareCalls += 1;
        },
      },
      shareData: companyShareData,
    }),
    "shared",
  );
  assert.equal(shareCalls, 1);

  assert.equal(
    await shareLiveRoomInviteToInstagram({
      environment: {
        clipboard: {
          writeText: async (value) => {
            copiedUrl = value;
          },
        },
        currentUrl: companyShareData.url,
      },
      shareData: companyShareData,
    }),
    "instagram-copied",
  );
  assert.equal(copiedUrl, companyShareData.url);
});

test("shared Invite UI is guest-accessible and keeps the keyboard dialog contract", () => {
  const menu = readSource("components/live-room/LiveRoomInviteMenu.tsx");
  const companyHeader = readSource(
    "components/live-room/CompanyRoomHeader.tsx",
  );
  const companyClient = readSource("components/live-room/LiveRoomClient.tsx");
  const communityHeader = readSource(
    "components/live-room/CommunityRoomHeader.tsx",
  );

  assert.match(menu, /aria-expanded=\{isOpen\}/);
  assert.match(menu, /aria-controls=\{panelId\}/);
  assert.match(menu, /aria-haspopup="dialog"/);
  assert.match(menu, /event\.key === "Escape"/);
  assert.match(menu, /document\.addEventListener\("pointerdown"/);
  assert.match(menu, /firstActionRef\.current\?\.focus/);
  assert.match(menu, /<span>Invite<\/span>/);
  assert.match(menu, /Share to Instagram[\s\S]*Copy for Instagram/);
  assert.match(menu, /Paste it into Instagram/);
  assert.match(menu, /Popup blocked\. Link copied instead\./);
  assert.doesNotMatch(menu, /loginHref|isGuest|signIn|signup/);

  assert.match(companyHeader, /<LiveRoomInviteMenu[\s\S]*kind: "company"/);
  assert.match(communityHeader, /<LiveRoomInviteMenu[\s\S]*kind: "community"/);
  assert.doesNotMatch(companyClient, /inviteState|setInviteState/);
});
