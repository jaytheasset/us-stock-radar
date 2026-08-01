import "server-only";

import { getChannelLockState, getUserPlan } from "@/lib/alerts/alertValidation";
import { findTickerBySymbol } from "@/lib/alerts/tickers/getAlertTickersViewModel";
import {
  getLiveRoomMembership,
  listLiveRoomMemberships,
} from "@/lib/live-room/serverRepository";
import type { LiveRoomActor } from "@/lib/live-room/policy";
import { getWatchlistViewModel } from "@/lib/watchlist/getWatchlistViewModel";
import {
  executeTelegramConnectedCommand,
  type TelegramCommandPresentation,
} from "@/lib/telegram/telegramCommandRuntime";
import type { TelegramConnectedCommand } from "@/lib/telegram/telegramCommandPolicy";
import { resolveTelegramConnectionOwner } from "@/lib/telegram/telegramInteractions";

export async function handleTelegramConnectedCommand(input: {
  baseUrl: string;
  command: TelegramConnectedCommand;
  destination: string;
}): Promise<TelegramCommandPresentation> {
  return executeTelegramConnectedCommand(input, {
    resolveOwner: async (destination) => {
      const result = await resolveTelegramConnectionOwner(destination);
      if (!result.ok) {
        if (result.error === "CONNECTION_NOT_FOUND") return null;
        throw new Error("Telegram connection lookup failed");
      }
      return result.userId;
    },
    isTelegramAllowed: async (userId) =>
      !getChannelLockState(await getUserPlan(userId), "telegram"),
    findStock: async (ticker) => {
      const stock = await findTickerBySymbol(ticker);
      return stock
        ? { ticker: stock.ticker, companyName: stock.companyName }
        : null;
    },
    readWatchlist: async (userId) => {
      const viewModel = await getWatchlistViewModel(userId);
      return viewModel.items.map((item) => ({
        ticker: item.ticker,
        companyName: item.companyName || item.ticker,
      }));
    },
    listRooms: async (userId, limit) =>
      listLiveRoomMemberships(memberActor(userId), limit),
    readRoomMembership: async (userId, ticker) =>
      getLiveRoomMembership({ actor: memberActor(userId), ticker }),
  });
}

function memberActor(userId: string): LiveRoomActor {
  return { kind: "member", userId, email: null };
}
