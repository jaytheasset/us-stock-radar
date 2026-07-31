import { NextRequest, NextResponse } from "next/server";
import { getAlertSettingsViewModel, getGuestAlertSettingsViewModel } from "@/lib/alerts/getAlertSettingsViewModel";
import {
  AlertValidationError,
  assertAdvancedAlertFiltersAllowed,
  getUserPlan,
  normalizePreferencePatch,
} from "@/lib/alerts/alertValidation";
import { getOptionalCurrentUserId } from "@/lib/currentUser";
import { supabaseUpsert } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
};

const FIELD_MAP: Record<string, string> = {
  watchlistNewsEnabled: "watchlist_news_enabled",
  watchlistFilingsEnabled: "watchlist_filings_enabled",
  watchlistCalendarEnabled: "watchlist_calendar_enabled",
  watchlistRiskEnabled: "watchlist_risk_enabled",
  discoveryEnabled: "discovery_enabled",
  groupDuplicates: "group_duplicates",
  cooldownMinutes: "cooldown_minutes",
  marketCapFilters: "market_cap_filters",
  filingTypeFilters: "filing_type_filters",
};

export async function PATCH(request: NextRequest) {
  try {
    const userId = await getOptionalCurrentUserId();
    const body = await request.json().catch(() => null);
    const patch = normalizePreferencePatch(body);

    if (!userId) {
      return NextResponse.json(
        {
          ok: true,
          guestMode: true,
          persisted: false,
          message: "Create an account to save your alert settings.",
          data: getGuestAlertSettingsViewModel(),
        },
        { headers: NO_STORE_HEADERS },
      );
    }

    const plan = await getUserPlan(userId);
    assertAdvancedAlertFiltersAllowed(plan, patch);

    const payload: Record<string, unknown> = {
      user_id: userId,
    };

    for (const [key, value] of Object.entries(patch)) {
      payload[FIELD_MAP[key]] = value;
    }

    const result = await supabaseUpsert("alert_preferences", payload, {
      onConflict: "user_id",
      prefer: "resolution=merge-duplicates,return=representation",
    });

    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: "PREFERENCES_SAVE_FAILED",
          message: result.error || "Failed to save alert preferences.",
        },
        { status: result.status || 502, headers: NO_STORE_HEADERS },
      );
    }

    const data = await getAlertSettingsViewModel(userId);
    return NextResponse.json(
      {
        ok: true,
        data,
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    if (error instanceof AlertValidationError) {
      return NextResponse.json(
        {
          ok: false,
          error: error.code,
          message: error.message,
          ...error.details,
        },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    return NextResponse.json(
      {
        ok: false,
        error: "PREFERENCES_UPDATE_FAILED",
        message: error instanceof Error ? error.message : "Failed to update alert preferences.",
      },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
