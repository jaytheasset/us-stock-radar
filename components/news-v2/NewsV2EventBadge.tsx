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
  className?: string;
  label?: string;
  size?: "micro" | "small" | "large";
};

export function NewsV2EventBadge({
  category,
  className,
  label,
  size = "small",
}: NewsV2EventBadgeProps) {
  const badgeLabel = label?.trim() || category.toUpperCase();

  return (
    <Badge
      aria-label={badgeLabel}
      className={className}
      size={size}
      title={badgeLabel}
      tone={categoryTone[category]}
    >
      <span>{badgeLabel}</span>
    </Badge>
  );
}
