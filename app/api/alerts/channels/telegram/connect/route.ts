import { NextResponse } from "next/server";
import { buildChannelNotAvailableMessage, getChannelLockState, getUserPlan } from "@/lib/alerts/alertValidation";
import { getOptionalCurrentUserId } from "@/lib/currentUser";
import { buildTelegramDeepLink, createTelegramConnectToken } from "@/lib/telegram/telegramConnect";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
};

export async function POST() {
  try {
    const userId = await getOptionalCurrentUserId();
    if (!userId) {
      return NextResponse.json(
        {
          ok: false,
          guestMode: true,
          error: "ACCOUNT_REQUIRED",
          message: "Create an account or log in to connect Telegram alerts.",
        },
        { headers: NO_STORE_HEADERS },
      );
    }

    const plan = await getUserPlan(userId);
    if (getChannelLockState(plan, "telegram")) {
      return NextResponse.json(
        {
          ok: false,
          error: "CHANNEL_NOT_AVAILABLE",
          message: buildChannelNotAvailableMessage("telegram"),
        },
        { status: 403, headers: NO_STORE_HEADERS },
      );
    }

    const token = await createTelegramConnectToken(userId);
    const connectUrl = buildTelegramDeepLink(token.token);

    return NextResponse.json(
      {
        ok: true,
        connectUrl,
        expiresAt: token.expiresAt,
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to start Telegram connection.";
    return NextResponse.json(
      {
        ok: false,
        error: message.includes("TELEGRAM_BOT_USERNAME") ? "TELEGRAM_CONFIG_MISSING" : "TELEGRAM_CONNECT_FAILED",
        message,
      },
      { status: message.includes("TELEGRAM_BOT_USERNAME") ? 500 : 502, headers: NO_STORE_HEADERS },
    );
  }
}
