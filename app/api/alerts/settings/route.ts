import { NextResponse } from "next/server";
import { getAlertSettingsViewModel, getGuestAlertSettingsViewModel } from "@/lib/alerts/getAlertSettingsViewModel";
import { getOptionalCurrentUserId } from "@/lib/currentUser";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
};

export async function GET() {
  try {
    const userId = await getOptionalCurrentUserId();
    const data = userId ? await getAlertSettingsViewModel(userId) : getGuestAlertSettingsViewModel();
    return NextResponse.json(
      {
        ok: true,
        guestMode: data.guestMode === true,
        user: userId ? { id: userId } : null,
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
