import { Badge, type BadgeTone } from "@/components/ui/Badge";
import type { NewsV2Category } from "@/lib/newsV2";

const categoryTone: Record<NewsV2Category, BadgeTone> = {
  Macro: "neutral",
  Sector: "transaction",
  Theme: "insider",
  Company: "earnings",
};

export type NewsV2EventBadgeProps = {
  category: NewsV2Category;
  size?: "micro" | "small" | "large";
};

export function NewsV2EventBadge({ category, size = "small" }: NewsV2EventBadgeProps) {
  return (
    <Badge size={size} tone={categoryTone[category]}>
      {category.toUpperCase()}
    </Badge>
  );
}
