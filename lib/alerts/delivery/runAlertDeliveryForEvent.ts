import "server-only";

import { createUserAlertDelivery } from "@/lib/alerts/delivery/createUserAlertDelivery";
import { runDeliveryAdapters } from "@/lib/alerts/delivery/deliveryAdapters";
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

  const evaluation = await evaluateAlertDeliveryForEvent(normalized.event);
  const writes: CreateAlertDeliveryResult[] = [];

  for (const candidate of evaluation.candidates) {
    if (!write) continue;

    if (candidate.deliveryStatus === "queued") {
      writes.push(
        await createUserAlertDelivery({
          userId: candidate.userId,
          event: normalized.event,
          alertLane: candidate.alertLane,
          deliveryStatus: "queued",
          deliveredChannels: [],
          scheduledFor: candidate.scheduledFor,
        }),
      );
      continue;
    }

    const adapterResult = await runDeliveryAdapters({
      event: normalized.event,
      candidate,
      dryRun: false,
    });

    if (!adapterResult.deliveredChannels.length) {
      writes.push({
        ok: true,
        skipped: true,
        reason: adapterResult.errors[0]?.error || "NO_CHANNELS_DELIVERED",
      });
      continue;
    }

    writes.push(
      await createUserAlertDelivery({
        userId: candidate.userId,
        event: normalized.event,
        alertLane: candidate.alertLane,
        deliveryStatus: "sent",
        deliveredChannels: adapterResult.deliveredChannels,
        scheduledFor: candidate.scheduledFor,
        sentAt: new Date().toISOString(),
        attemptedAt: new Date().toISOString(),
        lastError: adapterResult.errors.map((error) => `${error.channel}: ${error.error}`).join("; ") || undefined,
      }),
    );
  }

  return {
    ok: true,
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
