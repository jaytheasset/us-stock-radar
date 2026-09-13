import "server-only";

import { createUserAlertDelivery } from "@/lib/alerts/delivery/createUserAlertDelivery";
import { evaluateAlertDeliveryForEvent } from "@/lib/alerts/delivery/evaluateAlertDelivery";
import { normalizeAlertEvent } from "@/lib/alerts/delivery/normalizeAlertEvent";
import type { CreateAlertDeliveryResult, RunAlertDeliveryOptions, RunAlertDeliveryResult } from "@/lib/alerts/delivery/types";

export async function runAlertDeliveryForEvent(options: RunAlertDeliveryOptions): Promise<RunAlertDeliveryResult> {
  const requestedWrite = options.write === true;
  const dryRun = options.dryRun ?? !requestedWrite;
  const write = requestedWrite && !dryRun;
  const normalized = await normalizeAlertEvent(options.eventId);

  if (!normalized.ok) {
    return emptyResult({
      dryRun,
      write,
      error: normalized.error,
    });
  }

  const deliveryLevel = readDeliveryLevel(normalized.event.metadata?.delivery_level);
  if (deliveryLevel !== "alert") {
    return {
      ok: true,
      dryRun,
      write,
      event: normalized.event,
      candidates: [],
      skipped: [
        {
          reason: "EVENT_NOT_ALERT_DELIVERY_LEVEL",
          detail: `delivery_level=${deliveryLevel || "unknown"}`,
        },
      ],
      writes: [],
      stats: {
        candidateCount: 0,
        skippedCount: 1,
        writtenCount: 0,
        duplicateCount: 0,
      },
    };
  }

  const evaluation = await evaluateAlertDeliveryForEvent(normalized.event);
  const writes: CreateAlertDeliveryResult[] = [];

  for (const candidate of evaluation.candidates) {
    if (!write) continue;

    writes.push(
      await createUserAlertDelivery({
        userId: candidate.userId,
        tickerMatch: candidate.tickerMatch,
        event: normalized.event,
        alertLane: candidate.alertLane,
        deliveryStatus: "queued",
        deliveredChannels: candidate.eligibleChannels.map(
          (channel) => channel.channel,
        ),
        scheduledFor: candidate.scheduledFor,
      }),
    );
  }

  const failedWrites = writes.filter((result) => !result.ok);

  return {
    ok: failedWrites.length === 0,
    dryRun,
    write,
    event: normalized.event,
    candidates: evaluation.candidates,
    skipped: evaluation.skipped,
    writes,
    stats: {
      candidateCount: evaluation.candidates.length,
      skippedCount: evaluation.skipped.length,
      writtenCount: writes.filter((result) => result.ok && !result.skipped).length,
      duplicateCount: writes.filter((result) => result.reason === "DUPLICATE_DELIVERY").length,
    },
    error:
      failedWrites.length > 0
        ? failedWrites
            .map((result) => result.error)
            .filter(Boolean)
            .join("; ")
        : undefined,
  };
}

function emptyResult({
  dryRun,
  write,
  error,
}: {
  dryRun: boolean;
  write: boolean;
  error: string;
}): RunAlertDeliveryResult {
  return {
    ok: false,
    dryRun,
    write,
    candidates: [],
    skipped: [],
    writes: [],
    stats: {
      candidateCount: 0,
      skippedCount: 0,
      writtenCount: 0,
      duplicateCount: 0,
    },
    error,
  };
}

function readDeliveryLevel(value: unknown) {
  if (typeof value !== "string") return "";
  const normalized = value.trim().toLowerCase();
  return normalized === "archive" || normalized === "feed" || normalized === "alert" ? normalized : "";
}
