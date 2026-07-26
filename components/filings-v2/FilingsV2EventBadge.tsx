import type { BadgeTone } from "@/components/ui/Badge";
import { Badge } from "@/components/ui/Badge";
import {
  filingsV2EventLabels,
  type FilingsV2EventType,
} from "@/lib/filingsV2Model";

const eventTones: Record<FilingsV2EventType, BadgeTone> = {
  capital_return: "transaction",
  dilution: "legal",
  earnings: "earnings",
  fda: "product",
  governance: "neutral",
  insider: "insider",
  legal: "legal",
  listing: "neutral",
  ma: "transaction",
  offering: "transaction",
  operating: "product",
};

export function FilingsV2EventBadge({
  className,
  event,
  size = "small",
}: {
  className?: string;
  event: FilingsV2EventType;
  size?: "micro" | "small" | "large";
}) {
  return (
    <Badge
      className={className}
      data-event-emphasis={event === "dilution" ? "dilution" : undefined}
      size={size}
      tone={eventTones[event]}
    >
      {filingsV2EventLabels[event]}
    </Badge>
  );
}
