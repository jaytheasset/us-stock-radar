import { NextRequest, NextResponse } from "next/server";
import {
  runSecDevAccessionDryRun,
  runSecDevAccessionSamples,
  runSecDevControlledPersist,
  runSecDevLatestAnalysisDryRun,
  runSecDevLiveDryRun,
  runSecDevResetAnalysis,
  runSecDevRouteOnly,
} from "@/lib/development/secFormDevDashboard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ ok: false, error: "Development SEC dashboard is disabled in production." }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const record = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const room = readString(record.room);
  const mode = readString(record.mode);

  const detail =
    mode === "controlled_persist"
      ? await runSecDevControlledPersist(room, {
          accessionNumber: readString(record.accessionNumber),
          cik: readString(record.cik),
          rawItemId: readString(record.rawItemId),
          attachmentLimit: readNumber(record.attachmentLimit, 6),
          resetExistingAnalysis: readBoolean(record.resetExistingAnalysis),
          allowRepeatLlm: readBoolean(record.allowRepeatLlm),
          llmProvider: readString(record.llmProvider),
          llmModel: readString(record.llmModel),
          secPromptVariant: readString(record.secPromptVariant),
        })
      : mode === "accession_samples"
        ? await runSecDevAccessionSamples(room, {
            limit: readNumber(record.limit, 100),
            maxPages: readNumber(record.maxPages, 20),
            delayMs: readNumber(record.delayMs, 700),
            formTypes: readStringArray(record.formTypes),
            dateFrom: readString(record.dateFrom),
            dateTo: readString(record.dateTo),
          })
      : mode === "reset_analysis"
        ? await runSecDevResetAnalysis(room, {
            accessionNumber: readString(record.accessionNumber),
            rawItemId: readString(record.rawItemId),
          })
      : mode === "accession_dry_run"
        ? await runSecDevAccessionDryRun(room, {
            accessionNumber: readString(record.accessionNumber),
            rawItemId: readString(record.rawItemId),
            secPromptVariant: readString(record.secPromptVariant),
          })
        : mode === "route_only"
          ? await runSecDevRouteOnly(room, {
              accessionNumber: readString(record.accessionNumber),
              rawItemId: readString(record.rawItemId),
              llmProvider: readString(record.llmProvider),
              llmModel: readString(record.llmModel),
            })
          : mode === "latest_analysis_dry_run"
            ? await runSecDevLatestAnalysisDryRun(room, {
              limit: readNumber(record.limit, 1),
              countPerForm: readNumber(record.countPerForm, 1),
              attachmentLimit: readNumber(record.attachmentLimit, 6),
              allowLlm: record.allowLlm === true,
              formTypes: readStringArray(record.formTypes),
              dateFrom: readString(record.dateFrom),
              dateTo: readString(record.dateTo),
              secPromptVariant: readString(record.secPromptVariant),
            })
          : await runSecDevLiveDryRun(room, {
              limit: readNumber(record.limit, 1),
              countPerForm: readNumber(record.countPerForm, 1),
              attachmentLimit: readNumber(record.attachmentLimit, 6),
              formTypes: readStringArray(record.formTypes),
              dateFrom: readString(record.dateFrom),
              dateTo: readString(record.dateTo),
            });

  if (!detail) {
    return NextResponse.json({ ok: false, error: "Unknown SEC form room." }, { status: 404 });
  }

  return NextResponse.json({ ok: true, detail });
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readNumber(value: unknown, fallback: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readStringArray(value: unknown) {
  return Array.isArray(value) ? value.map(readString).filter(Boolean) : [];
}

function readBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return /^(?:1|true|yes)$/i.test(value.trim());
  return false;
}
