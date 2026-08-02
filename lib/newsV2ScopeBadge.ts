import type { NewsV2Item } from "./newsV2.ts";
import { themeGroups, themeSubThemes } from "./taxonomyRegistry.ts";

export function getNewsV2ScopeBadgeLabel(
  item: Pick<
    NewsV2Item,
    "category" | "sector" | "theme" | "themeGroupSlug" | "subThemeSlug"
  >,
) {
  if (item.category === "Company") return undefined;

  if (item.category === "Theme") {
    const rawTheme = item.theme?.trim();
    const normalizedTheme = normalizeTaxonomyValue(rawTheme);
    const normalizedGroupSlug = normalizeTaxonomyValue(item.themeGroupSlug);
    const themeGroup =
      themeGroups.find(
        (group) =>
          normalizeTaxonomyValue(group.slug) === normalizedGroupSlug ||
          normalizeTaxonomyValue(group.slug) === normalizedTheme ||
          normalizeTaxonomyValue(group.name) === normalizedTheme,
      ) ||
      themeGroups.find(
        (group) =>
          group.slug === themeSubThemes.find(
            (subTheme) =>
              subTheme.slug === item.subThemeSlug ||
              normalizeTaxonomyValue(subTheme.slug) === normalizedTheme ||
              normalizeTaxonomyValue(subTheme.name) === normalizedTheme,
          )?.themeGroupSlug,
      );
    return themeGroup?.name || rawTheme || undefined;
  }

  if (item.category === "Sector") {
    return item.sector?.trim() || undefined;
  }

  return item.category === "Macro" ? "MACRO" : undefined;
}

function normalizeTaxonomyValue(value?: string | null) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
