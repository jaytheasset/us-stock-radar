export type SecStoreStatus = "fetched" | "failed" | "skipped" | "parsed" | "analyzed";

export type SecRawSourceRole =
  | "primary_document"
  | "attachment"
  | "ownership_xml"
  | "fee_table"
  | "xbrl_instance"
  | "press_release"
  | "investor_presentation"
  | "agreement"
  | "offer_document"
  | "reason_exhibit"
  | "other";

export type SecRawStorePayload = {
  accessionNumber: string;
  formType: string;
  sourceRole: SecRawSourceRole;
  url: string | null;
  filename: string | null;
  documentType: string | null;
  description: string | null;
  content: string | null;
  contentHash?: string | null;
  status: SecStoreStatus;
  fetchedAt?: string | null;
  error?: string | null;
  metadata?: Record<string, unknown>;
};

export type SecEventStorePayload = {
  accessionNumber: string;
  formType: string;
  eventType: string;
  score: number;
  signal: string;
  title: string;
  summary: string;
  quickTake: string;
  primaryTicker?: string | null;
  tickers?: Array<Record<string, unknown>>;
  analysis?: Record<string, unknown>;
  calendarItems?: Array<Record<string, unknown>>;
  displayPayload?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
};

export type SecAlertCandidatePayload = {
  accessionNumber: string;
  eventType: string;
  score: number;
  signal: string;
  reason: string;
  evidence?: string[];
  metadata?: Record<string, unknown>;
};

export type SecFormPersistenceRequest = {
  rawItems: SecRawStorePayload[];
  event: SecEventStorePayload | null;
  alertCandidate: SecAlertCandidatePayload | null;
};

export type SecRawStore = {
  save(payload: SecRawStorePayload): Promise<{ ok: boolean; id?: string; error?: string }>;
};

export type SecEventStore = {
  saveAll(payload: SecEventStorePayload): Promise<{ ok: boolean; eventId?: string; error?: string }>;
};

export type SecAlertQueue = {
  enqueue(payload: SecAlertCandidatePayload): Promise<{ ok: boolean; id?: string; error?: string }>;
};
