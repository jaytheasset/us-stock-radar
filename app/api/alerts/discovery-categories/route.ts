import { NextRequest, NextResponse } from "next/server";
import { getAlertSettingsViewModel } from "@/lib/alerts/getAlertSettingsViewModel";
import {
  AlertValidationError,
  assertDiscoveryCategoryLimit,
  assertValidCategories,
  getAllCategoryRowsForUser,
  getUserPlan,
} from "@/lib/alerts/alertValidation";
import { getCurrentUserId } from "@/lib/currentUser";
import { supabaseUpsert } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
};

export async function PATCH(request: NextRequest) {
  const userId = getCurrentUserId();

  try {
    const body = await request.json().catch(() => null);
    const categories = assertValidCategories((body as { categories?: unknown } | null)?.categories);
    const plan = await getUserPlan(userId);
    assertDiscoveryCategoryLimit(plan, categories);

    const result = await supabaseUpsert("user_discovery_categories", getAllCategoryRowsForUser(userId, categories), {
      onConflict: "user_id,category",
      prefer: "resolution=merge-duplicates,return=representation",
    });

    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: "DISCOVERY_CATEGORIES_SAVE_FAILED",
          message: result.error || "Failed to save Discovery categories.",
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
        { status: error.code === "CATEGORY_LIMIT_EXCEEDED" ? 409 : 400, headers: NO_STORE_HEADERS },
      );
    }

    return NextResponse.json(
      {
        ok: false,
        error: "DISCOVERY_CATEGORIES_UPDATE_FAILED",
        message: error instanceof Error ? error.message : "Failed to update Discovery categories.",
      },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
