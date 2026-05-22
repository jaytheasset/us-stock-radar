import type { SecFormParserGroupSlug } from "./forms";

export type SecFormParserConfidence = "high" | "medium" | "low";

export type SecFormParserAttachment = {
  type?: string | null;
  description?: string | null;
  filename?: string | null;
  url?: string | null;
  text?: string | null;
};

export type SecFormParserInput = {
  rawItemId?: string | null;
  accessionNumber?: string | null;
  cik?: string | null;
  ticker?: string | null;
  companyName?: string | null;
  formType: string;
  filedAt?: string | null;
  title?: string | null;
  sourceUrl?: string | null;
  primaryDocumentText?: string | null;
  attachments?: SecFormParserAttachment[];
  metadata?: Record<string, unknown> | null;
  rawPayload?: Record<string, unknown> | null;
};

export type SecFormParserEvidenceField<T = string> = {
  value: T;
  evidence: string;
  confidence: SecFormParserConfidence;
};

export type SecFormParserCalendarItem = {
  calendarEventType: string;
  calendarTitle?: string | null;
  eventDate?: string | null;
  eventTime?: string | null;
  eventTimezone?: string | null;
  datePrecision?: "exact" | "estimated" | "range" | "unknown";
  evidence?: string | null;
  confidence?: SecFormParserConfidence;
};

export type SecFormParserOutput<TFacts extends Record<string, unknown> = Record<string, unknown>> = {
  parserVersion: string;
  parserGroup: SecFormParserGroupSlug;
  formType: string;
  accessionNumber?: string | null;
  isSupported: boolean;
  summary?: string | null;
  facts: TFacts;
  signals?: string[];
  calendarItems?: SecFormParserCalendarItem[];
  warnings?: string[];
  raw?: Record<string, unknown>;
};

export type SecFormParser<TFacts extends Record<string, unknown> = Record<string, unknown>> = (
  input: SecFormParserInput,
) => SecFormParserOutput<TFacts>;
