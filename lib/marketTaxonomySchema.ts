import { sectorMappings, themeGroups, themeSubThemes } from "@/lib/taxonomyRegistry";

function uniqueSorted(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

export const MARKET_TAXONOMY_SECTOR_VALUES = uniqueSorted(sectorMappings.map((item) => item.sector));

export const MARKET_TAXONOMY_INDUSTRY_GROUP_VALUES = uniqueSorted(sectorMappings.map((item) => item.subCategory));

export const MARKET_TAXONOMY_THEME_GROUP_VALUES = themeGroups.map((theme) => theme.slug);

export const MARKET_TAXONOMY_SUB_THEME_VALUES = themeSubThemes.map((theme) => theme.slug);

function nullableTaxonomyEnumSchema(values: readonly string[], description: string) {
  return {
    type: ["string", "null"],
    enum: [...values, null],
    description,
  };
}

export function marketTaxonomyAnalysisOutputSchemaProperties() {
  return {
    sector: nullableTaxonomyEnumSchema(
      MARKET_TAXONOMY_SECTOR_VALUES,
      "Use one top-level sector name from the site taxonomy, or null when unsupported.",
    ),
    industry_group: nullableTaxonomyEnumSchema(
      MARKET_TAXONOMY_INDUSTRY_GROUP_VALUES,
      "Use one industry group name from the site taxonomy, or null when unsupported.",
    ),
    theme_group: nullableTaxonomyEnumSchema(
      MARKET_TAXONOMY_THEME_GROUP_VALUES,
      "Use one theme group slug from the site taxonomy, or null when unsupported.",
    ),
    sub_theme: nullableTaxonomyEnumSchema(
      MARKET_TAXONOMY_SUB_THEME_VALUES,
      "Use one sub-theme slug from the site taxonomy, or null when unsupported.",
    ),
  };
}
