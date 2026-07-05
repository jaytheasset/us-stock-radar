import { themeGroups } from "@/lib/taxonomyRegistry";

export const MARKET_TAXONOMY_THEME_GROUP_VALUES = themeGroups.map((theme) => theme.slug);

function nullableStringSchema(description: string) {
  return {
    type: ["string", "null"],
    description,
  };
}

function nullableTaxonomyEnumSchema(values: readonly string[], description: string) {
  return {
    type: ["string", "null"],
    enum: [...values, null],
    description,
  };
}

export function marketTaxonomyAnalysisOutputSchemaProperties() {
  return {
    sector: nullableStringSchema("Use a top-level sector name, or null when unsupported."),
    industry_group: nullableStringSchema("Use a narrower industry group name, or null when unsupported."),
    theme_group: nullableTaxonomyEnumSchema(
      MARKET_TAXONOMY_THEME_GROUP_VALUES,
      "Use one theme group slug from the site taxonomy, or null when unsupported.",
    ),
    sub_theme: nullableStringSchema("Use a narrower sub-theme name or slug, or null when unsupported."),
  };
}
