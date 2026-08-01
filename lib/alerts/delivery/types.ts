import type { AlertCategory, AlertChannel, Plan } from "@/lib/subscriptionPolicy";

export type AlertLane = "watchlist" | "market_discovery";
export type NormalizedAlertSourceType = "news" | "filing" | "calendar" | "other";
export type NormalizedAlertSeverity = "low" | "medium" | "high" | "critical";
export type AlertDeliveryStatus = "queued" | "sent" | "failed" | "suppressed";

export type NormalizedAlertEvent = {
  id: string;
  title: string;
  quickTake?: string;
  tickers: string[];
  primaryTicker?: string;
  category: AlertCategory;
  sourceType: NormalizedAlertSourceType;
  sourceLabel?: string;
  severity?: NormalizedAlertSeverity;
  score?: number;
  signal?: "bullish" | "bearish" | "volatile" | "neutral";
  impact?: "high" | "medium" | "low";
  marketScope: "company" | "sector" | "theme" | "macro";
  publishedAt?: string;
  metadata?: Record<string, unknown>;
};

export type DeliveryCandidateChannel = {
  channel: AlertChannel;
  destination?: string;
  connected: boolean;
};

export type AlertDeliveryCandidate = {
  userId: string;
  plan: Plan;
  alertLane: AlertLane;
  matchedTickers: string[];
  scheduledFor: string;
  deliveryStatus: AlertDeliveryStatus;
  eligibleChannels: DeliveryCandidateChannel[];
  delayMinutes: number;
};

export type AlertDeliverySkip = {
  userId?: string;
  reason: string;
  detail?: string;
};

export type AlertDeliveryEvaluation = {
  event: NormalizedAlertEvent;
  candidates: AlertDeliveryCandidate[];
  skipped: AlertDeliverySkip[];
};

export type CreateAlertDeliveryInput = {
  userId: string;
  event: NormalizedAlertEvent;
  alertLane: AlertLane;
  deliveryStatus: AlertDeliveryStatus;
  deliveredChannels: AlertChannel[];
  scheduledFor: string;
  sentAt?: string;
  attemptedAt?: string;
  lastError?: string;
};

export type CreateAlertDeliveryResult = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  row?: Record<string, unknown>;
  status?: number;
  error?: string;
};

export type DeliveryAdapterResult = {
  deliveredChannels: AlertChannel[];
  attemptedChannels: AlertChannel[];
  errors: Array<{
    channel: AlertChannel;
    error: string;
  }>;
};

export type RunAlertDeliveryOptions = {
  eventId: string;
  dryRun?: boolean;
  write?: boolean;
};

export type RunAlertDeliveryResult = {
  ok: boolean;
  dryRun: boolean;
  write: boolean;
  event?: NormalizedAlertEvent;
  candidates: AlertDeliveryCandidate[];
  skipped: AlertDeliverySkip[];
  writes: CreateAlertDeliveryResult[];
  stats: {
    candidateCount: number;
    skippedCount: number;
    writtenCount: number;
    duplicateCount: number;
  };
  error?: string;
};

export type QueuedAlertDeliveryRow = {
  id: string;
  user_id: string;
  alert_event_id: string | null;
  ticker: string | null;
  title: string;
  category: AlertCategory | null;
  source_type: NormalizedAlertSourceType | null;
  source_label: string | null;
  alert_lane: AlertLane;
  severity: NormalizedAlertSeverity | null;
  delivered_channels: AlertChannel[];
  scheduled_for: string | null;
  delivery_status: AlertDeliveryStatus;
  created_at?: string | null;
};

export type ProcessQueuedDeliveryOptions = {
  dryRun?: boolean;
  write?: boolean;
  limit?: number;
};

export type ProcessQueuedDeliveryItemResult = {
  id: string;
  userId: string;
  title: string;
  ticker?: string | null;
  action: "would_send" | "sent" | "suppressed" | "failed" | "in_progress";
  channels: AlertChannel[];
  duplicatesPrevented: number;
  error?: string;
};

export type ProcessQueuedDeliveryResult = {
  ok: boolean;
  dryRun: boolean;
  write: boolean;
  scanned: number;
  processed: number;
  wouldProcess: number;
  sent: number;
  failed: number;
  suppressed: number;
  duplicatesPrevented: number;
  inProgress: number;
  items: ProcessQueuedDeliveryItemResult[];
  error?: string;
};

export type CalendarAlertDeliveryResult = {
  ok: boolean;
  write: boolean;
  scanned: number;
  delivered: number;
  duplicates: number;
  disabled: number;
  suppressed: number;
  failed?: number;
  error?: string;
};

export type PublicTelegramBroadcastStatus =
  | "pending"
  | "attempting"
  | "sent"
  | "failed"
  | "suppressed"
  | "uncertain";

export type PublicTelegramBroadcastRow = {
  id: string;
  event_id: string;
  status: PublicTelegramBroadcastStatus;
  scheduled_for: string;
  next_retry_at: string | null;
};

export type PublicTelegramBroadcastItemResult = {
  eventId: string;
  action:
    | "would_send"
    | "sent"
    | "failed"
    | "suppressed"
    | "in_progress"
    | "disabled";
  duplicatePrevented: boolean;
  error?: string;
};

export type PublicTelegramBroadcastResult = {
  ok: boolean;
  dryRun: boolean;
  write: boolean;
  scanned: number;
  processed: number;
  wouldProcess: number;
  sent: number;
  failed: number;
  suppressed: number;
  disabled: number;
  duplicatesPrevented: number;
  inProgress: number;
  items: PublicTelegramBroadcastItemResult[];
  error?: string;
};

export type RunAlertDeliveryBatchOptions = {
  dryRun?: boolean;
  write?: boolean;
  force?: boolean;
  limit?: number;
  lookbackHours?: number;
};

export type AlertDeliveryBatchEventResult = {
  eventId: string;
  title?: string;
  status: "processed" | "failed" | "skipped" | "already_processed";
  candidatesFound: number;
  deliveriesCreated: number;
  duplicatesSkipped: number;
  suppressedCount: number;
  failedCount: number;
  error?: string;
};

export type RunAlertDeliveryBatchResult = {
  ok: boolean;
  dryRun: boolean;
  write: boolean;
  force: boolean;
  scanned: number;
  processed: number;
  wouldProcess: number;
  skippedAlreadyProcessed: number;
  deliveriesCreated: number;
  duplicatesSkipped: number;
  failed: number;
  events: AlertDeliveryBatchEventResult[];
  error?: string;
};

export type RunAlertDeliverySchedulerOptions = {
  dryRun?: boolean;
  write?: boolean;
  recordRunLog?: boolean;
  runId?: string;
  force?: boolean;
  limit?: number;
  lookbackHours?: number;
  queuedLimit?: number;
  publicTelegramLimit?: number;
  skipBatch?: boolean;
  skipQueued?: boolean;
  skipPublicTelegram?: boolean;
  skipCalendar?: boolean;
  calendarLimit?: number;
  lockTtlSeconds?: number;
  useLock?: boolean;
};

export type RunAlertDeliverySchedulerResult = {
  ok: boolean;
  runId?: string;
  dryRun: boolean;
  write: boolean;
  locked: boolean;
  lockSkipped?: boolean;
  batch?: RunAlertDeliveryBatchResult | null;
  queued?: ProcessQueuedDeliveryResult | null;
  publicTelegram?: PublicTelegramBroadcastResult | null;
  calendar?: CalendarAlertDeliveryResult | null;
  error?: string;
};
