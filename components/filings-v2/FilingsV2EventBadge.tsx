import type { BadgeTone } from "@/components/ui/Badge";
import { Badge } from "@/components/ui/Badge";
import {
  filingsV2EventLabels,
  type FilingsV2EventType,
} from "@/lib/filingsV2Model";

const eventTones: Record<FilingsV2EventType, BadgeTone> = {
  capital_return: "transaction",
  dilution: "neutral",
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
  event,
  size = "small",
}: {
  event: FilingsV2EventType;
  size?: "micro" | "small" | "large";
}) {
  return (
    <Badge size={size} tone={eventTones[event]}>
      {filingsV2EventLabels[event]}
    </Badge>
  );
}
