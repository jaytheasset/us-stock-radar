import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildTelegramHelpText,
  parseTelegramCommand,
} from "./telegramCommandPolicy.ts";
import {
  executeTelegramConnectedCommand,
  TelegramCommandUserError,
  type TelegramCommandDependencies,
} from "./telegramCommandRuntime.ts";

const baseUrl = "https://us-stock-radar.com";
const ownerUserId = "11111111-1111-4111-8111-111111111111";

test("Telegram parser accepts only bounded, explicit supported commands", () => {
  assert.deepEqual(parseTelegramCommand("/stock amd"), {
    name: "stock",
    ticker: "AMD",
  });
  assert.deepEqual(parseTelegramCommand("/room@StockRadarBot brk.b"), {
    name: "room",
    ticker: "BRK.B",
  });
  assert.deepEqual(parseTelegramCommand("/say NVDA   Watching guidance closely."), {
    name: "say",
    ticker: "NVDA",
    body: "Watching guidance closely.",
  });
  assert.deepEqual(parseTelegramCommand("/watchlist"), { name: "watchlist" });
  assert.deepEqual(parseTelegramCommand("/rooms"), { name: "rooms" });
  assert.deepEqual(parseTelegramCommand("/settings"), { name: "settings" });
  assert.deepEqual(parseTelegramCommand("/help"), { name: "help" });
  assert.deepEqual(parseTelegramCommand("/start token"), { name: "start" });
  assert.equal(parseTelegramCommand("free form").name, "ignored");
  assert.equal(parseTelegramCommand("/stock").name, "invalid");
  assert.equal(parseTelegramCommand("/stock AMD,or=(user_id.neq.x)").name, "invalid");
  assert.equal(parseTelegramCommand("/watchlist extra").name, "invalid");
  assert.equal(parseTelegramCommand(`/say AMD ${"x".repeat(800)}`).name, "invalid");
});

test("help advertises only implemented Telegram commands", () => {
  const help = buildTelegramHelpText();
  for (const command of ["/stock", "/watchlist", "/rooms", "/room", "/say", "/settings", "/help"]) {
    assert.match(help, new RegExp(command.replace("/", "\\/")));
  }
  assert.doesNotMatch(help, /AI|vote|comment|mirror/i);
});

test("connected commands stop before member data when destination ownership is missing", async () => {
  let watchlistRead = false;
  const result = await executeTelegramConnectedCommand(
    {
      baseUrl,
      command: { name: "watchlist" },
      destination: "telegram-chat-a",
    },
    dependencies({
      resolveOwner: async () => null,
      readWatchlist: async () => {
        watchlistRead = true;
        return [];
      },
    }),
  );

  assert.equal(watchlistRead, false);
  assert.match(result.text, /Connect this private chat/);
  assert.equal(pathname(result.replyMarkup?.inline_keyboard[0][0].url), "/alerts");
});

test("current Telegram entitlement is authoritative before connected reads", async () => {
  let roomRead = false;
  const result = await executeTelegramConnectedCommand(
    { baseUrl, command: { name: "rooms" }, destination: "telegram-chat-a" },
    dependencies({
      isTelegramAllowed: async () => false,
      listRooms: async () => {
        roomRead = true;
        return { hasMore: false, items: [] };
      },
    }),
  );

  assert.equal(roomRead, false);
  assert.match(result.text, /Pro or higher/);
});

test("stock search returns canonical overview and company room actions", async () => {
  const found = await executeTelegramConnectedCommand(
    { baseUrl, command: { name: "stock", ticker: "AMD" }, destination: "telegram-chat-a" },
    dependencies(),
  );
  assert.equal(found.text, "$AMD — Advanced Micro Devices, Inc.");
  assert.deepEqual(
    found.replyMarkup?.inline_keyboard[0].map((button) => pathname(button.url)),
    ["/stocks/AMD", "/live/AMD"],
  );

  const missing = await executeTelegramConnectedCommand(
    { baseUrl, command: { name: "stock", ticker: "ZZZZ" }, destination: "telegram-chat-a" },
    dependencies({ findStock: async () => null }),
  );
  assert.match(missing.text, /not an active listed/);
  assert.equal(missing.replyMarkup, undefined);
});

test("watchlist is owner-scoped, bounded, and offers real site actions", async () => {
  let requestedUserId = "";
  const items = Array.from({ length: 12 }, (_, index) => ({
    ticker: `T${index}`,
    companyName: `Company ${index}`,
  }));
  const result = await executeTelegramConnectedCommand(
    { baseUrl, command: { name: "watchlist" }, destination: "telegram-chat-a" },
    dependencies({
      readWatchlist: async (userId) => {
        requestedUserId = userId;
        return items;
      },
    }),
  );

  assert.equal(requestedUserId, ownerUserId);
  assert.match(result.text, /Showing 8 of 12/);
  assert.doesNotMatch(result.text, /Company 8/);
  assert.equal(result.replyMarkup?.inline_keyboard.length, 8);
  assert.ok(Buffer.byteLength(result.text, "utf8") < 4096);

  const empty = await executeTelegramConnectedCommand(
    { baseUrl, command: { name: "watchlist" }, destination: "telegram-chat-a" },
    dependencies({ readWatchlist: async () => [] }),
  );
  assert.equal(pathname(empty.replyMarkup?.inline_keyboard[0][0].url), "/watchlist");
});

test("joined room lookup preserves canonical room hrefs and resolved ownership", async () => {
  let requestedUserId = "";
  const result = await executeTelegramConnectedCommand(
    { baseUrl, command: { name: "rooms" }, destination: "telegram-chat-a" },
    dependencies({
      listRooms: async (userId) => {
        requestedUserId = userId;
        return {
          hasMore: false,
          items: [
            { href: "/live/AMD", kind: "company", label: "AMD Live Room", ticker: "AMD" },
            { href: "/live/community/macro", kind: "community", label: "Macro Room", ticker: null },
            { href: "/\\evil.example", kind: "community", label: "Invalid Room", ticker: null },
          ],
        };
      },
    }),
  );

  assert.equal(requestedUserId, ownerUserId);
  assert.deepEqual(
    result.replyMarkup?.inline_keyboard.map((row) => pathname(row[0].url)),
    ["/live/AMD", "/live/community/macro"],
  );
  assert.equal(
    result.replyMarkup?.inline_keyboard.every((row) => new URL(row[0].url || "").origin === baseUrl),
    true,
  );
});

test("room lookup reports membership without joining automatically", async () => {
  let membershipUserId = "";
  const result = await executeTelegramConnectedCommand(
    { baseUrl, command: { name: "room", ticker: "AMD" }, destination: "telegram-chat-a" },
    dependencies({
      readRoomMembership: async (userId) => {
        membershipUserId = userId;
        return { joined: false };
      },
    }),
  );

  assert.equal(membershipUserId, ownerUserId);
  assert.match(result.text, /Not joined yet/);
  assert.equal(pathname(result.replyMarkup?.inline_keyboard[0][0].url), "/live/AMD");
});

test("say requires an existing membership and reuses the member write dependency", async () => {
  let sent: { userId: string; ticker: string; body: string } | null = null;
  const command = { name: "say", ticker: "AMD", body: "Watching guidance." } as const;
  const rejected = await executeTelegramConnectedCommand(
    { baseUrl, command, destination: "telegram-chat-a" },
    dependencies({ readRoomMembership: async () => ({ joined: false }) }),
  );
  assert.match(rejected.text, /Join AMD Live Room/);

  const accepted = await executeTelegramConnectedCommand(
    { baseUrl, command, destination: "telegram-chat-a" },
    dependencies({
      sendRoomMessage: async (userId, ticker, body) => {
        sent = { userId, ticker, body };
      },
    }),
  );
  assert.deepEqual(sent, { userId: ownerUserId, ticker: "AMD", body: "Watching guidance." });
  assert.match(accepted.text, /Message posted/);

  const moderated = await executeTelegramConnectedCommand(
    { baseUrl, command, destination: "telegram-chat-a" },
    dependencies({
      sendRoomMessage: async () => {
        throw new TelegramCommandUserError("This wording is blocked. Rephrase the message.");
      },
    }),
  );
  assert.equal(moderated.text, "This wording is blocked. Rephrase the message.");
});

test("server wiring reuses exact owner, catalog, watchlist, membership, and moderated message paths", () => {
  const webhook = read("app/api/telegram/webhook/route.ts");
  const interactions = read("lib/telegram/telegramInteractions.ts");
  const commandInteractions = read("lib/telegram/telegramCommandInteractions.ts");
  const runbook = read("docs/TELEGRAM_CONNECT.md");
  const commandScript = read("scripts/configure-telegram-commands.mjs");

  assert.match(webhook, /isPrivateTelegramChat/);
  assert.match(webhook, /handleTelegramConnectedCommand/);
  assert.doesNotMatch(webhook, /user_metadata|console\./);
  assert.match(interactions, /normalizeTelegramDestination\(destination\)/);
  assert.match(interactions, /destination: `eq\.\$\{normalizedDestination\}`/);
  assert.match(interactions, /channel: "eq\.telegram"/);
  assert.match(interactions, /verified_at: "not\.is\.null"/);
  assert.match(commandInteractions, /findTickerBySymbol/);
  assert.match(commandInteractions, /getWatchlistViewModel\(userId\)/);
  assert.match(commandInteractions, /listLiveRoomMemberships\(memberActor\(userId\), limit\)/);
  assert.match(commandInteractions, /getLiveRoomMembership/);
  assert.match(commandInteractions, /sendLiveRoomMessage/);
  assert.doesNotMatch(commandInteractions, /supabaseUpsert|supabaseRpc|live_room_messages|user_metadata/);
  assert.match(runbook, /callback_query/);
  assert.match(commandScript, /TELEGRAM_BOT_COMMANDS_WRITE_ENABLED !== "true"/);
  assert.match(commandScript, /process\.argv\.includes\("--apply"\)/);
  assert.doesNotMatch(commandScript, /console\.log\([^\n]*(token|TELEGRAM_BOT_TOKEN)/i);
});

function dependencies(
  overrides: Partial<TelegramCommandDependencies> = {},
): TelegramCommandDependencies {
  return {
    resolveOwner: async () => ownerUserId,
    isTelegramAllowed: async () => true,
    findStock: async (ticker) =>
      ticker === "AMD"
        ? { ticker: "AMD", companyName: "Advanced Micro Devices, Inc." }
        : null,
    readWatchlist: async () => [],
    listRooms: async () => ({ hasMore: false, items: [] }),
    readRoomMembership: async () => ({ joined: true }),
    sendRoomMessage: async () => undefined,
    ...overrides,
  };
}

function pathname(url: string | undefined) {
  return url ? new URL(url).pathname : "";
}

function read(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}
