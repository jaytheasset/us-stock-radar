export const SEC_CURRENT_REPORT_FORMS = ["8-K", "8-K/A", "6-K", "6-K/A"] as const;
export const SEC_PERIODIC_REPORT_FORMS = ["10-K", "10-K/A", "10-Q", "10-Q/A", "20-F", "20-F/A", "40-F", "40-F/A"] as const;
export const SEC_NT_FORMS = ["NT 10-K", "NT 10-K/A", "NT 10-Q", "NT 10-Q/A", "NT 20-F", "NT 20-F/A"] as const;
export const SEC_S1_F1_FORMS = ["S-1", "S-1/A", "F-1", "F-1/A", "S-1MEF", "F-1MEF", "POS AM"] as const;
export const SEC_S3_F3_FORMS = ["S-3", "S-3/A", "S-3ASR", "S-3MEF", "F-3", "F-3/A", "F-3ASR", "F-3MEF"] as const;
export const SEC_424B_FORMS = ["424B", "424B1", "424B2", "424B3", "424B4", "424B5", "424B7", "424B8"] as const;
export const SEC_S8_FORMS = ["S-8", "S-8/A", "S-8 POS"] as const;
export const SEC_EFFECT_FORMS = ["EFFECT"] as const;
export const SEC_OWNERSHIP_FORMS = ["4", "4/A", "144", "144/A"] as const;
export const SEC_SC13_FORMS = ["SC 13D", "SC 13D/A", "SC 13G", "SC 13G/A"] as const;
export const SEC_PROXY_FORMS = [
  "DEF 14A",
  "DEF 14A/A",
  "PRE 14A",
  "PRE 14A/A",
  "DEFA14A",
  "DEFA14A/A",
  "DEFR14A",
  "PRER14A",
  "DEFM14A",
  "PREM14A",
  "DEFC14A",
  "PREC14A",
  "SC 14A",
  "SC 14A/A",
] as const;
export const SEC_425_FORMS = ["425"] as const;
export const SEC_S4_F4_FORMS = ["S-4", "S-4/A", "F-4", "F-4/A"] as const;
export const SEC_TENDER_FORMS = [
  "SC TO-C",
  "SC TO-I",
  "SC TO-I/A",
  "SC TO-T",
  "SC TO-T/A",
  "SC 13E3",
  "SC 13E3/A",
  "CB",
  "CB/A",
  "SC 14D9",
  "SC 14D9/A",
] as const;
export const SEC_FORM25_FORMS = ["25", "25/A", "25-NSE", "25-NSE/A"] as const;

export const SEC_FORM_ROOM_MANIFEST = [
  room("ownership", "ownership", "Ownership", SEC_OWNERSHIP_FORMS, ["FORM 4", "FORM 4/A", "FORM 144", "FORM 144/A"]),
  room("8k-6k", "current_report", "8-K / 6-K", SEC_CURRENT_REPORT_FORMS),
  room("s1-f1", "s1_f1", "S-1 / F-1", SEC_S1_F1_FORMS),
  room("s3-f3", "s3_f3", "S-3 / F-3", SEC_S3_F3_FORMS),
  room("s4-f4", "s4_f4", "S-4 / F-4", SEC_S4_F4_FORMS),
  room("425", "425", "425", SEC_425_FORMS),
  room("424b", "424b", "424B", SEC_424B_FORMS),
  room("tender", "tender", "Tender / CB / 13E3", SEC_TENDER_FORMS, ["TENDER", "13E3", "13E3/A"]),
  room("proxy", "proxy", "Proxy", SEC_PROXY_FORMS, ["PROXY"]),
  room("periodic-reports", "periodic_reports", "Periodic Reports", SEC_PERIODIC_REPORT_FORMS),
  room("s8", "s8", "S-8", SEC_S8_FORMS),
  room("sc13", "sc13", "13D / SC 13D", SEC_SC13_FORMS),
  room("nt", "nt", "NT Reports", SEC_NT_FORMS),
  room("form25", "form25", "Form 25", SEC_FORM25_FORMS, ["FORM 25", "FORM 25-NSE"]),
  room("effect", "effect", "EFFECT", SEC_EFFECT_FORMS),
] as const;

export type SecFormRoomSlug = (typeof SEC_FORM_ROOM_MANIFEST)[number]["slug"];

export const SEC_PRODUCTION_INGEST_SCHEDULE = [
  ingestGroup("current_reports", ["8k-6k"], 5, 0, 5, 8),
  ingestGroup("ownership_changes", ["ownership", "sc13"], 5, 0, 3, 4),
  ingestGroup("transaction_updates", ["425", "s4-f4", "tender", "proxy"], 10, 0, 1, 8),
  ingestGroup("listing_updates", ["form25"], 10, 5, 3, 6),
  ingestGroup("offering_filings", ["s1-f1", "s3-f3", "424b"], 15, 0, 2, 8),
  ingestGroup("periodic_reports", ["periodic-reports", "nt"], 15, 5, 2, 8),
  ingestGroup("capital_and_effectiveness", ["s8", "effect"], 30, 10, 2, 6),
] as const;

export const SEC_FORM_PARSER_GROUPS = [
  ...SEC_FORM_ROOM_MANIFEST.map((entry) => ({ slug: entry.slug, forms: [...entry.forms, ...entry.aliases] })),
  { slug: "other", forms: ["Other SEC Filing"] },
];

export type SecFormParserGroupSlug = (typeof SEC_FORM_ROOM_MANIFEST)[number]["slug"] | "other";

export function normalizeSecFormType(value: string | null | undefined) {
  return (value || "").trim().toUpperCase().replace(/\s+/g, " ");
}

export function findSecFormParserGroup(formType: string | null | undefined): SecFormParserGroupSlug | null {
  const normalized = normalizeSecFormType(formType);
  if (!normalized) return null;

  for (const group of SEC_FORM_PARSER_GROUPS) {
    if (group.forms.some((candidate) => normalizeSecFormType(candidate) === normalized)) {
      return group.slug as SecFormParserGroupSlug;
    }
  }

  return null;
}

function room<
  const TSlug extends string,
  const TWorkerKey extends string,
  const TLabel extends string,
  const TForms extends readonly string[],
  const TAliases extends readonly string[],
>(
  slug: TSlug,
  workerKey: TWorkerKey,
  label: TLabel,
  forms: TForms,
  aliases: TAliases = [] as unknown as TAliases,
) {
  return { slug, folder: slug, workerKey, label, forms, aliases } as const;
}

function ingestGroup<
  const TId extends string,
  const TRooms extends readonly SecFormRoomSlug[],
>(
  id: TId,
  rooms: TRooms,
  cadenceMinutes: number,
  minuteOffset: number,
  countPerForm: number,
  attachmentLimit: number,
) {
  return { id, rooms, cadenceMinutes, minuteOffset, countPerForm, attachmentLimit } as const;
}
