import type { SecFormFetchPlan } from "../common/fetchPlan";

export const secEffectFetchPlan = {
  room: "effect",
  forms: ["EFFECT"],
  defaultAttachmentLimit: 3,
  notes: [
    "EFFECT is usually deterministic from the primary notice and referenced registration number.",
    "The parser should request parent filing linkage from integration when the source notice lacks enough context.",
  ],
  rules: [
    {
      id: "structured-effect-source",
      reason: "Structured XML/source can preserve registration number and effective timestamp.",
      filenamePatterns: [/\.xml(?:$|[?#])|\.txt(?:$|[?#])/i],
      maxDocuments: 1,
      preserveRawText: true,
    },
  ],
} satisfies SecFormFetchPlan;
