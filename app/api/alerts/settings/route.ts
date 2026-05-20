import { NextResponse } from "next/server";
import { getAlertSettingsViewModel } from "@/lib/alerts/getAlertSettingsViewModel";
import { getCurrentUserId } from "@/lib/currentUser";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
};

export async function GET() {
  const userId = getCurrentUserId();

  try {
    const data = await getAlertSettingsViewModel(userId);
    return NextResponse.json(
      {
        ok: true,
        data,
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "ALERT_SETTINGS_READ_FAILED",
        message: error instanceof Error ? error.message : "Failed to read alert settings.",
      },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
