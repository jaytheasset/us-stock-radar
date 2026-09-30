/** Shared vocabulary for server validation and browser condition editors. No runtime dependencies. */
export type CorporateActionCanonicalVocabularyEntry<TValue extends string = string> = Readonly<{
  value: TValue;
  description: string;
  monitorable: boolean;
  displayLabel: string;
}>;

export const CORPORATE_ACTION_EVENT_KIND_VOCABULARY = [
  {
    value: "reverse_split",
    description: "The event establishes a reverse stock split, regardless of its lifecycle stage.",
    monitorable: true,
    displayLabel: "Reverse stock split",
  },
  {
    value: "forward_split",
    description: "The event establishes an explicit forward stock split, regardless of its lifecycle stage.",
    monitorable: true,
    displayLabel: "Forward stock split",
  },
] as const satisfies readonly CorporateActionCanonicalVocabularyEntry[];

export const CORPORATE_ACTION_STAGE_VOCABULARY = [
  {
    value: "announced",
    description: "a plan or decision is disclosed without a more specific confirmed approval or effect stage",
    monitorable: true,
    displayLabel: "Announced",
  },
  {
    value: "board_approved",
    description: "board approval is explicitly established",
    monitorable: true,
    displayLabel: "Board approved",
  },
  {
    value: "shareholder_approved",
    description: "shareholder approval is explicitly established",
    monitorable: true,
    displayLabel: "Shareholder approved",
  },
  {
    value: "scheduled",
    description: "an approved or confirmed future effective date is established",
    monitorable: true,
    displayLabel: "Scheduled",
  },
  {
    value: "effective",
    description: "the stock split is already effective or the source is the effective action itself",
    monitorable: true,
    displayLabel: "Effective",
  },
  {
    value: "unknown",
    description: "a stock split is certain but the stage cannot safely be normalized",
    monitorable: false,
    displayLabel: "Unknown",
  },
] as const satisfies readonly CorporateActionCanonicalVocabularyEntry[];
