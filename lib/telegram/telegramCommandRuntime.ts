import type { TelegramInlineKeyboardMarkup } from "./sendTelegramMessage.ts";
import type { TelegramConnectedCommand } from "./telegramCommandPolicy.ts";

const MAX_LIST_ITEMS = 8;
const MAX_ROOM_ITEMS = 10;

export type TelegramCommandStock = {
  companyName: string;
  ticker: string;
};

export type TelegramCommandRoom = {
  href: string;
  kind: "community" | "company";
  label: string;
  ticker: string | null;
};

export type TelegramCommandPresentation = {
  replyMarkup?: TelegramInlineKeyboardMarkup;
  text: string;
};

export type TelegramCommandDependencies = {
  findStock: (ticker: string) => Promise<TelegramCommandStock | null>;
  isTelegramAllowed: (userId: string) => Promise<boolean>;
  listRooms: (
    userId: string,
    limit: number,
  ) => Promise<{ hasMore: boolean; items: TelegramCommandRoom[] }>;
  readRoomMembership: (userId: string, ticker: string) => Promise<{ joined: boolean }>;
  readWatchlist: (userId: string) => Promise<TelegramCommandStock[]>;
  resolveOwner: (destination: string) => Promise<string | null>;
};

export async function executeTelegramConnectedCommand(
  input: {
    baseUrl: string;
    command: TelegramConnectedCommand;
    destination: string;
  },
  dependencies: TelegramCommandDependencies,
): Promise<TelegramCommandPresentation> {
  try {
    const userId = await dependencies.resolveOwner(input.destination);
    if (!userId) {
      return presentation(
        "Connect this private chat to Stock Radar from Alert Center first.",
        input.baseUrl,
        [[siteButton("Open Alert Settings", "/alerts")]],
      );
    }
    if (!(await dependencies.isTelegramAllowed(userId))) {
      return presentation(
        "Telegram commands are available with Stock Radar Pro or higher.",
        input.baseUrl,
        [[siteButton("View plans", "/premium")]],
      );
    }

    if (input.command.name === "stock") {
      const stock = await dependencies.findStock(input.command.ticker);
      return stock
        ? stockPresentation(stock, input.baseUrl)
        : { text: `${input.command.ticker} is not an active listed Stock Radar ticker.` };
    }

    if (input.command.name === "watchlist") {
      const items = await dependencies.readWatchlist(userId);
      if (!items.length) {
        return presentation(
          "Your Stock Radar watchlist is empty.",
          input.baseUrl,
          [[siteButton("Manage Watchlist", "/watchlist")]],
        );
      }
      const visibleItems = items.slice(0, MAX_LIST_ITEMS);
      const suffix = items.length > visibleItems.length
        ? `\n\nShowing ${visibleItems.length} of ${items.length}.`
        : "";
      return presentation(
        [
          `Your Watchlist (${items.length})`,
          "",
          ...visibleItems.map(
            (item, index) => `${index + 1}. ${formatStockLabel(item)}`,
          ),
        ].join("\n") + suffix,
        input.baseUrl,
        visibleItems.map((item) => [
          siteButton(`Stock ${item.ticker}`, `/stocks/${encodeURIComponent(item.ticker)}`),
          siteButton("Live Room", `/live/${encodeURIComponent(item.ticker)}`),
        ]),
      );
    }

    if (input.command.name === "rooms") {
      const rooms = await dependencies.listRooms(userId, MAX_ROOM_ITEMS + 1);
      if (!rooms.items.length) {
        return presentation(
          "You have not joined any Live Rooms yet.",
          input.baseUrl,
          [[siteButton("Explore Live Rooms", "/live")]],
        );
      }
      const visibleItems = rooms.items.slice(0, MAX_ROOM_ITEMS);
      const hasMore = rooms.hasMore || rooms.items.length > visibleItems.length;
      return presentation(
        [
          "Your joined Live Rooms",
          "",
          ...visibleItems.map((room, index) => `${index + 1}. ${cleanDisplayText(room.label, 70)}`),
          ...(hasMore ? ["", "Open Stock Radar to see all joined rooms."] : []),
        ].join("\n"),
        input.baseUrl,
        visibleItems.map((room) => [
          siteButton(cleanDisplayText(room.label, 40), room.href),
        ]),
      );
    }

    const stock = await dependencies.findStock(input.command.ticker);
    if (!stock) {
      return { text: `${input.command.ticker} is not an active listed Stock Radar ticker.` };
    }
    const membership = await dependencies.readRoomMembership(userId, stock.ticker);

    return presentation(
      `${formatStockLabel(stock)}\n${membership.joined ? "Joined" : "Not joined yet"} · Company Live Room`,
      input.baseUrl,
      [[siteButton(`💬 Enter ${stock.ticker} Live Room`, `/live/${encodeURIComponent(stock.ticker)}`)]],
    );
  } catch {
    return {
      text: "Stock Radar could not complete that command right now.",
    };
  }
}

function stockPresentation(
  stock: TelegramCommandStock,
  baseUrl: string,
): TelegramCommandPresentation {
  return presentation(
    formatStockLabel(stock),
    baseUrl,
    [[
      siteButton("Stock Overview", `/stocks/${encodeURIComponent(stock.ticker)}`),
      siteButton(`💬 ${stock.ticker} Live Room`, `/live/${encodeURIComponent(stock.ticker)}`),
    ]],
  );
}

function formatStockLabel(stock: TelegramCommandStock) {
  const companyName = cleanDisplayText(stock.companyName, 100);
  return companyName && companyName.toUpperCase() !== stock.ticker
    ? `$${stock.ticker} — ${companyName}`
    : `$${stock.ticker}`;
}

function presentation(
  text: string,
  baseUrl: string,
  rows: Array<Array<{ path: string; text: string }>>,
): TelegramCommandPresentation {
  const inlineKeyboard = rows.flatMap((row) => {
    const buttons = row.flatMap((button) => {
      const url = buildSiteUrl(baseUrl, button.path);
      return url ? [{ text: button.text, url }] : [];
    });
    return buttons.length ? [buttons] : [];
  });
  return {
    text: cleanDisplayText(text, 3900),
    ...(inlineKeyboard.length
      ? { replyMarkup: { inline_keyboard: inlineKeyboard } }
      : {}),
  };
}

function siteButton(text: string, path: string) {
  return { path, text };
}

function buildSiteUrl(baseUrl: string, path: string) {
  try {
    const base = new URL(baseUrl.trim());
    if (base.protocol !== "https:" && base.protocol !== "http:") return "";
    if (!path.startsWith("/") || path.startsWith("//")) return "";
    const url = new URL(path, `${base.origin}/`);
    return url.origin === base.origin ? url.toString() : "";
  } catch {
    return "";
  }
}

function cleanDisplayText(value: string, maxLength: number) {
  return value
    .replace(/\r/g, "")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .trim()
    .slice(0, maxLength);
}
