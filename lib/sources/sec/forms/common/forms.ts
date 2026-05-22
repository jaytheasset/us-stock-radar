export const SEC_FORM_PARSER_GROUPS = [
  {
    slug: "8k-6k",
    forms: ["8-K", "8-K/A", "6-K", "6-K/A"],
  },
  {
    slug: "periodic-reports",
    forms: ["10-K", "10-K/A", "10-Q", "10-Q/A", "20-F", "20-F/A"],
  },
  {
    slug: "nt",
    forms: ["NT 10-K", "NT 10-Q", "NT 20-F"],
  },
  {
    slug: "s1-f1",
    forms: ["S-1", "S-1/A", "F-1", "F-1/A"],
  },
  {
    slug: "s3-f3",
    forms: ["S-3", "S-3/A", "F-3", "F-3/A", "S-3ASR", "F-3ASR"],
  },
  {
    slug: "424b",
    forms: ["424B3", "424B5"],
  },
  {
    slug: "s8",
    forms: ["S-8", "S-8/A"],
  },
  {
    slug: "effect",
    forms: ["EFFECT"],
  },
  {
    slug: "ownership",
    forms: ["4", "4/A", "Form 4", "Form 4/A", "144", "144/A", "Form 144", "Form 144/A"],
  },
  {
    slug: "sc13",
    forms: ["SC 13D", "SC 13D/A", "SC 13G", "SC 13G/A"],
  },
  {
    slug: "proxy",
    forms: ["DEF 14A", "DEFA14A", "PRE 14A", "PRER14A", "PREC14A"],
  },
  {
    slug: "425",
    forms: ["425"],
  },
  {
    slug: "s4-f4",
    forms: ["S-4", "S-4/A", "F-4", "F-4/A"],
  },
  {
    slug: "tender",
    forms: ["SC TO-I", "SC TO-T", "SC TO-C", "CB", "SC 13E3", "SC 13E3/A"],
  },
  {
    slug: "form25",
    forms: ["25", "25-NSE", "Form 25", "Form 25-NSE"],
  },
  {
    slug: "other",
    forms: ["Other SEC Filing"],
  },
] as const;

export type SecFormParserGroupSlug = (typeof SEC_FORM_PARSER_GROUPS)[number]["slug"];

export function normalizeSecFormType(value: string | null | undefined) {
  return (value || "").trim().toUpperCase().replace(/\s+/g, " ");
}

export function findSecFormParserGroup(formType: string | null | undefined): SecFormParserGroupSlug | null {
  const normalized = normalizeSecFormType(formType);
  if (!normalized) return null;

  for (const group of SEC_FORM_PARSER_GROUPS) {
    if (group.forms.some((candidate) => normalizeSecFormType(candidate) === normalized)) {
      return group.slug;
    }
  }

  return null;
}
