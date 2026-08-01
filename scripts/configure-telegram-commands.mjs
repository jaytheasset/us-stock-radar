const commands = [
  { command: "stock", description: "Find a listed ticker or company" },
  { command: "watchlist", description: "View your Stock Radar watchlist" },
  { command: "rooms", description: "View Live Rooms you joined" },
  { command: "room", description: "Open a Company Live Room" },
  { command: "say", description: "Post to a Live Room you joined" },
  { command: "settings", description: "Manage Stock Radar Alerts" },
  { command: "help", description: "Show supported commands" },
];

const apply = process.argv.includes("--apply");
if (!apply) {
  console.log(`Dry run: ${commands.length} Telegram commands are ready. No bot settings changed.`);
  process.exit(0);
}

if (process.env.TELEGRAM_BOT_COMMANDS_WRITE_ENABLED !== "true") {
  console.error("Command registration is locked. Set TELEGRAM_BOT_COMMANDS_WRITE_ENABLED=true for an approved window.");
  process.exit(1);
}

const token = process.env.TELEGRAM_BOT_TOKEN || "";
if (!token) {
  console.error("TELEGRAM_BOT_TOKEN is missing.");
  process.exit(1);
}

try {
  const response = await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      commands,
      scope: { type: "all_private_chats" },
    }),
  });
  if (!response.ok) {
    console.error(`Telegram command registration failed with HTTP ${response.status}.`);
    process.exit(1);
  }
  const payload = await response.json().catch(() => null);
  if (payload?.ok !== true) {
    console.error("Telegram command registration was rejected.");
    process.exit(1);
  }
  console.log(`Registered ${commands.length} Telegram commands for private chats.`);
} catch {
  console.error("Telegram command registration request failed.");
  process.exit(1);
}
