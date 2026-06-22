import { sec424bAdapter } from "@/lib/sources/sec/forms/424b/adapter";
import { sec425FormAdapter } from "@/lib/sources/sec/forms/425/adapter";
import { currentReportFormAdapter } from "@/lib/sources/sec/forms/8k-6k/adapter";
import { effectFormAdapter } from "@/lib/sources/sec/forms/effect/adapter";
import { form25FormAdapter } from "@/lib/sources/sec/forms/form25/adapter";
import { secNtFormAdapter } from "@/lib/sources/sec/forms/nt/adapter";
import { ownershipFormAdapter, type OwnershipParserOutput } from "@/lib/sources/sec/forms/ownership/adapter";
import { secPeriodicReportsAdapter } from "@/lib/sources/sec/forms/periodic-reports/adapter";
import { proxyFormAdapter } from "@/lib/sources/sec/forms/proxy/adapter";
import { s1F1Adapter } from "@/lib/sources/sec/forms/s1-f1/adapter";
import { s3F3FormAdapter, type SecS3FilingFacts } from "@/lib/sources/sec/forms/s3-f3/adapter";
import { secS4F4Adapter } from "@/lib/sources/sec/forms/s4-f4/adapter";
import { secS8FormAdapter } from "@/lib/sources/sec/forms/s8/adapter";
import { sc13Adapter } from "@/lib/sources/sec/forms/sc13/adapter";
import { secTenderFormAdapter } from "@/lib/sources/sec/forms/tender/adapter";
import type {
  SecFormAdapterAnalysisMode,
  SecFormAdapterDefinition,
  SecFormAdapterParseResult,
  SecFormAdapterRawItem,
} from "@/lib/sources/sec/forms/common/secFormAdapter";
import { buildCommonFormParserInput, safelyRunFormParser } from "@/lib/sources/sec/forms/common/formAdapterRuntime";

export type SecFormWorkerKey =
  | "current_report"
  | "periodic_reports"
  | "nt"
  | "s1_f1"
  | "s3_f3"
  | "424b"
  | "s8"
  | "effect"
  | "ownership"
  | "sc13"
  | "proxy"
  | "425"
  | "s4_f4"
  | "tender"
  | "form25";

export type SecFormWorkerAnalysisMode = SecFormAdapterAnalysisMode;

export type RawItemRow = SecFormAdapterRawItem;

export type SecFormWorkerDefinition = SecFormAdapterDefinition<SecFormWorkerKey, RawItemRow, SecFormWorkerParserResult>;

export type SecFormWorkerParserResult<TKey extends SecFormWorkerKey = SecFormWorkerKey> = SecFormAdapterParseResult<TKey> & {
  hardParsers: Record<string, unknown>;
  s3Parsed: SecS3FilingFacts | null;
  ownershipParsed: OwnershipParserOutput | null;
};

type RuntimeParser = (input: ReturnType<typeof buildCommonFormParserInput>, rawItem: RawItemRow, formType: string | null) => unknown;
type SecFormWorkerSelectionMetadata = {
  primary_adapter?: SecFormWorkerKey;
  secondary_form_context?: string[];
  selector_reason?: string;
  selector_signal?: string;
};

function createRuntimeWorker<TKey extends SecFormWorkerKey>({
  key,
  parserGroup,
  forms,
  analysisMode,
  parse,
}: {
  key: TKey;
  parserGroup: string;
  forms: readonly string[];
  analysisMode: SecFormAdapterAnalysisMode;
  parse: RuntimeParser;
}): SecFormAdapterDefinition<TKey, RawItemRow, SecFormWorkerParserResult<TKey>> {
  return {
    key,
    parserGroup,
    forms,
    analysisMode,
    matches: (canonicalFormType) => forms.includes(canonicalFormType),
    parse: (rawItem, formType): SecFormWorkerParserResult<TKey> => {
      const parsed = safelyRunFormParser(parserGroup, formType, () =>
        parse(buildCommonFormParserInput(rawItem, formType), rawItem, formType),
      );
      return {
        worker: {
          key,
          parserGroup,
          analysisMode,
        },
        hardParsers: {
          [parserGroup]: parsed,
        },
        parserOutputs: {
          [parserGroup]: parsed,
        },
        s3Parsed: null,
        ownershipParsed: null,
      };
    },
  };
}

const sec424bFormAdapter = createRuntimeWorker({
  key: "424b",
  parserGroup: String(sec424bAdapter.parserGroup),
  forms: sec424bAdapter.supportedForms,
  analysisMode: sec424bAdapter.analysisMode,
  parse: (input) => sec424bAdapter.parse(input as never),
});

const sec425RuntimeFormAdapter = createRuntimeWorker({
  key: "425",
  parserGroup: String(sec425FormAdapter.parserGroup),
  forms: sec425FormAdapter.supportedForms,
  analysisMode: sec425FormAdapter.analysisMode,
  parse: (input) => sec425FormAdapter.parse(input as never),
});

const effectRuntimeFormAdapter = createRuntimeWorker({
  key: "effect",
  parserGroup: String(effectFormAdapter.parserGroup),
  forms: effectFormAdapter.supportedForms,
  analysisMode: effectFormAdapter.analysisMode,
  parse: (input) => effectFormAdapter.parse(input as never),
});

const ntFormAdapter = createRuntimeWorker({
  key: "nt",
  parserGroup: String(secNtFormAdapter.parserGroup),
  forms: secNtFormAdapter.supportedForms,
  analysisMode: secNtFormAdapter.analysisMode,
  parse: (input) => secNtFormAdapter.parse(input as never),
});

const periodicReportsFormAdapter = createRuntimeWorker({
  key: "periodic_reports",
  parserGroup: String(secPeriodicReportsAdapter.parserGroup),
  forms: secPeriodicReportsAdapter.supportedForms,
  analysisMode: secPeriodicReportsAdapter.analysisMode,
  parse: (input) => secPeriodicReportsAdapter.parse(input as never),
});

const s1F1FormAdapter = createRuntimeWorker({
  key: "s1_f1",
  parserGroup: String(s1F1Adapter.parserGroup),
  forms: s1F1Adapter.supportedForms,
  analysisMode: s1F1Adapter.analysisMode,
  parse: (input) => s1F1Adapter.parse(input as never),
});

const s4F4FormAdapter = createRuntimeWorker({
  key: "s4_f4",
  parserGroup: String(secS4F4Adapter.parserGroup),
  forms: secS4F4Adapter.supportedForms,
  analysisMode: secS4F4Adapter.analysisMode,
  parse: (input) => secS4F4Adapter.parse(input as never),
});

const s8FormAdapter = createRuntimeWorker({
  key: "s8",
  parserGroup: String(secS8FormAdapter.parserGroup),
  forms: secS8FormAdapter.supportedForms,
  analysisMode: secS8FormAdapter.analysisMode,
  parse: (input) => secS8FormAdapter.parse(input as never),
});

const tenderFormAdapter = createRuntimeWorker({
  key: "tender",
  parserGroup: String(secTenderFormAdapter.parserGroup),
  forms: secTenderFormAdapter.supportedForms,
  analysisMode: secTenderFormAdapter.analysisMode,
  parse: (input) => (secTenderFormAdapter.parse as (input: unknown, context?: unknown) => unknown)(input, {}),
});

const proxyRuntimeFormAdapter = createRuntimeWorker({
  key: "proxy",
  parserGroup: String(proxyFormAdapter.parserGroup),
  forms: proxyFormAdapter.supportedForms,
  analysisMode: proxyFormAdapter.analysisMode,
  parse: (input) => proxyFormAdapter.parse(input as never),
});

const sc13RuntimeFormAdapter = createRuntimeWorker({
  key: "sc13",
  parserGroup: String(sc13Adapter.parserGroup),
  forms: sc13Adapter.supportedForms,
  analysisMode: sc13Adapter.analysisMode,
  parse: (input) => sc13Adapter.parse(input as never),
});

export const SEC_FORM_WORKERS = [
  currentReportFormAdapter,
  periodicReportsFormAdapter,
  ntFormAdapter,
  s1F1FormAdapter,
  s3F3FormAdapter,
  sec424bFormAdapter,
  s8FormAdapter,
  effectRuntimeFormAdapter,
  ownershipFormAdapter,
  sc13RuntimeFormAdapter,
  proxyRuntimeFormAdapter,
  sec425RuntimeFormAdapter,
  s4F4FormAdapter,
  tenderFormAdapter,
  form25FormAdapter,
] as const;

export const SEC_FORM_ADAPTERS = SEC_FORM_WORKERS;

export function getSecFormWorker(formType: unknown) {
  const form = canonicalSecFormType(formType);
  if (!form) return null;
  return SEC_FORM_WORKERS.find((worker) => worker.matches(form)) || null;
}

export function getSecFormAdapter(formType: unknown) {
  return getSecFormWorker(formType);
}

export function runSecFormWorkerParser(rawItem: RawItemRow, formType: string | null): SecFormWorkerParserResult {
  const selection = selectSecFormWorker(rawItem, formType);
  const worker = selection.worker;
  if (!worker) {
    return {
      worker: null,
      hardParsers: {},
      s3Parsed: null,
      ownershipParsed: null,
    };
  }

  const result = worker.parse(rawItem, formType) as SecFormWorkerParserResult;
  if (!selection.metadata || !result.worker) return result;

  return {
    ...result,
    worker: {
      ...result.worker,
      ...selection.metadata,
    } as typeof result.worker,
  };
}

export function runSecFormAdapterParser(rawItem: RawItemRow, formType: string | null): SecFormWorkerParserResult {
  return runSecFormWorkerParser(rawItem, formType);
}

export function listSecFormAdapters() {
  return SEC_FORM_ADAPTERS.map((adapter) => ({
    key: adapter.key,
    parserGroup: adapter.parserGroup,
    forms: [...adapter.forms],
    analysisMode: adapter.analysisMode,
  }));
}

export function isOwnershipFormTypeForIntegration(value: unknown) {
  const form = canonicalSecFormType(value);
  return Boolean(form && ownershipFormAdapter.matches(form));
}

export function isS3F3FormTypeForIntegration(value: unknown) {
  const form = canonicalSecFormType(value);
  return Boolean(form && s3F3FormAdapter.matches(form));
}

export function isTenderFormTypeForIntegration(value: unknown) {
  const form = canonicalSecFormType(value);
  return Boolean(form && tenderFormAdapter.matches(form));
}

export function canonicalSecFormType(value: unknown) {
  return stringValue(value)
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^FORM\s+/, "")
    .replace(/^SCHEDULE\s+/, "SC ")
    .replace(/^SC\s+13E-3/, "SC 13E3");
}

function selectSecFormWorker(rawItem: RawItemRow, formType: unknown): {
  worker: (typeof SEC_FORM_WORKERS)[number] | null;
  metadata: SecFormWorkerSelectionMetadata | null;
} {
  const form = canonicalSecFormType(formType);
  if (!form) return { worker: null, metadata: null };

  const strongTenderSignal = findStrongTenderSignal(rawItem);
  if (isSc13CanonicalFormType(form) && strongTenderSignal) {
    return {
      worker: tenderFormAdapter,
      metadata: {
        primary_adapter: "tender",
        secondary_form_context: ["sc13"],
        selector_reason:
          "Strong Schedule TO/13E-3 filing signal found in filing package while SEC feed form type is SC13.",
        selector_signal: strongTenderSignal,
      },
    };
  }

  return {
    worker: SEC_FORM_WORKERS.find((worker) => worker.matches(form)) || null,
    metadata: null,
  };
}

function isSc13CanonicalFormType(form: string) {
  return form === "SC 13D" || form === "SC 13D/A" || form === "SC 13G" || form === "SC 13G/A";
}

function findStrongTenderSignal(rawItem: RawItemRow) {
  const rawPayload = toRecord(rawItem.raw_payload) || {};
  const metadata = toRecord(rawItem.metadata) || {};
  const documentSignal = findStrongTenderDocumentSignal(rawPayload, metadata);
  if (documentSignal) return documentSignal;

  const coverSignal =
    findStrongTenderCoverSignal(stringValue(rawItem.body_text)) ||
    findStrongTenderCoverSignal(stringValue(rawItem.analysis_text));
  return coverSignal;
}

function findStrongTenderDocumentSignal(rawPayload: Record<string, unknown>, metadata: Record<string, unknown>) {
  const candidates = [
    rawPayload.form_type,
    rawPayload.formType,
    rawPayload.primary_document_type,
    rawPayload.primaryDocumentType,
    metadata.form_type,
    metadata.formType,
    metadata.primary_document_type,
    metadata.primaryDocumentType,
  ];

  for (const candidate of candidates) {
    const form = canonicalSecFormType(candidate);
    if (form && tenderFormAdapter.matches(form)) return `form_type:${form}`;
  }

  for (const document of recordArray(rawPayload.documents)) {
    const type = canonicalSecFormType(document.type);
    if (type && tenderFormAdapter.matches(type)) return `document_type:${type}`;

    const label = [document.type, document.description, document.document, document.filename, document.name]
      .map(stringValue)
      .filter(Boolean)
      .join(" ");
    const labelSignal = findStrongTenderLabelSignal(label);
    if (labelSignal) return `document_label:${labelSignal}`;
  }

  for (const attachment of recordArray(rawPayload.attachment_texts)) {
    const type = canonicalSecFormType(attachment.type);
    if (type && tenderFormAdapter.matches(type)) return `attachment_type:${type}`;

    const label = [attachment.type, attachment.description, attachment.document, attachment.filename, attachment.name]
      .map(stringValue)
      .filter(Boolean)
      .join(" ");
    const labelSignal = findStrongTenderLabelSignal(label);
    if (labelSignal) return `attachment_label:${labelSignal}`;
  }

  return "";
}

function findStrongTenderLabelSignal(label: string) {
  const text = normalizeSelectorText(label);
  if (!text) return "";
  const match = text.match(/\b(?:SC\s+TO(?:-[ITC])?(?:\/A)?|SCHEDULE\s+TO(?:-[ITC])?|SC\s+13E3(?:\/A)?|SCHEDULE\s+13E-?3)\b/i);
  return match?.[0] || "";
}

function findStrongTenderCoverSignal(value: string) {
  const cover = value.slice(0, 20_000);
  if (!normalizeSelectorText(cover)) return "";
  const lines = cover
    .split(/\r?\n/)
    .slice(0, 100)
    .map((line) => normalizeSelectorText(line))
    .filter(Boolean);
  const strongHeader = lines.find((line) =>
    /^(?:#+\s*)?(?:<TYPE>\s*)?(?:FORM\s+)?(?:SCHEDULE\s+TO(?:-[ITC])?|SC\s+TO(?:-[ITC])?(?:\/A)?|SCHEDULE\s+13E-?3|SC\s+13E3(?:\/A)?)\b/i.test(
      line,
    ),
  );
  if (strongHeader) return `cover:${strongHeader.slice(0, 80)}`;
  const tenderCheckbox = lines.find((line) =>
    /^(?:[☒☐xX]|\[[xX ]\])?\s*(?:ISSUER\s+TENDER\s+OFFER|THIRD[-\s]+PARTY\s+TENDER\s+OFFER|GOING[-\s]+PRIVATE\s+TRANSACTION)\b/i.test(
      line,
    ),
  );
  if (tenderCheckbox) {
    return "cover:tender_checkbox";
  }
  return "";
}

function normalizeSelectorText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function recordArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, unknown> => Boolean(toRecord(item)));
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
