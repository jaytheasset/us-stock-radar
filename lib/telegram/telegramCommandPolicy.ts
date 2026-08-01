const TELEGRAM_COMMAND_INPUT_MAX_LENGTH = 768;

export type TelegramCommand =
  | { name: "start" }
  | { name: "settings" }
  | { name: "help" }
  | { name: "watchlist" }
  | { name: "rooms" }
  | { name: "stock"; ticker: string }
  | { name: "room"; ticker: string }
  | { name: "say"; ticker: string; body: string }
  | { name: "invalid"; message: string }
  | { name: "ignored" };

export type TelegramConnectedCommand = Extract<
  TelegramCommand,
  { name: "stock" | "watchlist" | "rooms" | "room" | "say" }
>;

const tickerPattern = /^[A-Z0-9][A-Z0-9.-]{0,11}$/;

export function parseTelegramCommand(value: unknown): TelegramCommand {
  if (typeof value !== "string") return { name: "ignored" };
  const input = value.trim();
  if (!input.startsWith("/")) return { name: "ignored" };
  if (input.length > TELEGRAM_COMMAND_INPUT_MAX_LENGTH) {
    return { name: "invalid", message: "That command is too long." };
  }

  const match = input.match(
    /^\/([A-Za-z]+)(?:@[A-Za-z0-9_]{1,32})?(?:\s+([\s\S]*))?$/,
  );
  if (!match) return { name: "ignored" };
  const name = match[1].toLowerCase();
  const argument = (match[2] || "").trim();

  if (name === "start") return { name: "start" };
  if (name === "settings" || name === "help" || name === "watchlist" || name === "rooms") {
    return argument
      ? { name: "invalid", message: `/${name} does not take an argument.` }
      : { name };
  }
  if (name === "stock" || name === "room") {
    const ticker = normalizeTelegramTickerArgument(argument);
    return ticker
      ? { name, ticker }
      : { name: "invalid", message: `Use /${name} TICKER, for example /${name} AMD.` };
  }
  if (name === "say") {
    const sayMatch = argument.match(/^(\S+)\s+([\s\S]+)$/);
    const ticker = normalizeTelegramTickerArgument(sayMatch?.[1]);
    const body = sayMatch?.[2]?.trim() || "";
    return ticker && body
      ? { name: "say", ticker, body }
      : {
          name: "invalid",
          message: "Use /say TICKER message, for example /say AMD Watching guidance closely.",
        };
  }

  return { name: "ignored" };
}

export function normalizeTelegramTickerArgument(value: unknown) {
  const ticker = typeof value === "string" ? value.trim().toUpperCase() : "";
  return tickerPattern.test(ticker) ? ticker : "";
}

export function isTelegramConnectedCommand(
  command: TelegramCommand,
): command is TelegramConnectedCommand {
  return (
    command.name === "stock" ||
    command.name === "watchlist" ||
    command.name === "rooms" ||
    command.name === "room" ||
    command.name === "say"
  );
}

export function buildTelegramHelpText() {
  return [
    "Stock Radar Telegram commands",
    "",
    "/stock TICKER — Find a listed company",
    "/watchlist — View your Stock Radar watchlist",
    "/rooms — View Live Rooms you joined",
    "/room TICKER — Open a Company Live Room",
    "/say TICKER message — Post to a room you already joined",
    "/settings — Manage Alerts",
    "/help — Show this help",
  ].join("\n");
}
