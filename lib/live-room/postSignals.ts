export const LIVE_ROOM_POST_SIGNAL_GROUPS = [
  {
    description: "Results and management outlook.",
    label: "Earnings & guidance",
    options: [
      { label: "Earnings beat", value: "earnings_beat" },
      { label: "Earnings miss", value: "earnings_miss" },
      { label: "Guidance raised", value: "guidance_raised" },
      { label: "Guidance cut", value: "guidance_cut" },
    ],
  },
  {
    description: "Capital structure, ownership, and transactions.",
    label: "Capital & ownership",
    options: [
      { label: "Short squeeze", value: "short_squeeze" },
      { label: "Dilution", value: "dilution" },
      { label: "Secondary offering", value: "secondary_offering" },
      { label: "M&A", value: "mergers_and_acquisitions" },
      { label: "Buyback", value: "buyback" },
      { label: "Insider activity", value: "insider_activity" },
      { label: "Stock split", value: "stock_split" },
      { label: "Reverse split", value: "reverse_split" },
    ],
  },
  {
    description: "Business, regulatory, and risk developments.",
    label: "Catalysts & risks",
    options: [
      { label: "Regulatory / FDA", value: "regulatory_fda" },
      {
        label: "Contract / partnership",
        value: "contract_partnership",
      },
      { label: "Positive catalyst", value: "positive_catalyst" },
      { label: "Risk alert", value: "risk_alert" },
    ],
  },
  {
    description: "Price-action setups.",
    label: "Technical",
    options: [
      { label: "Technical breakout", value: "technical_breakout" },
      { label: "Technical breakdown", value: "technical_breakdown" },
    ],
  },
] as const;

export const LIVE_ROOM_POST_SIGNAL_VALUES =
  LIVE_ROOM_POST_SIGNAL_GROUPS.flatMap((group) =>
    group.options.map((option) => option.value),
  );

export type LiveRoomPostSignal =
  (typeof LIVE_ROOM_POST_SIGNAL_VALUES)[number];

export const LIVE_ROOM_POST_DIRECTIONS = [
  { label: "Bullish", value: "bullish" },
  { label: "Bearish", value: "bearish" },
  { label: "Volatile", value: "volatile" },
  { label: "Neutral", value: "neutral" },
] as const;

export type LiveRoomPostDirection =
  (typeof LIVE_ROOM_POST_DIRECTIONS)[number]["value"];

export const LIVE_ROOM_POST_DIRECTION_TAGS = {
  bearish: "direction_bearish",
  bullish: "direction_bullish",
  neutral: "direction_neutral",
  volatile: "direction_volatile",
} as const satisfies Record<
  LiveRoomPostDirection,
  `direction_${LiveRoomPostDirection}`
>;

export type LiveRoomPostDirectionTag =
  (typeof LIVE_ROOM_POST_DIRECTION_TAGS)[LiveRoomPostDirection];

export type LiveRoomPostMetadataTag =
  | LiveRoomPostDirectionTag
  | LiveRoomPostSignal;

const LIVE_ROOM_POST_SIGNAL_LABELS = new Map<
  LiveRoomPostSignal,
  string
>(
  LIVE_ROOM_POST_SIGNAL_GROUPS.flatMap((group) =>
    group.options.map((option) => [option.value, option.label] as const),
  ),
);

export function isLiveRoomPostSignal(
  value: unknown,
): value is LiveRoomPostSignal {
  return (
    typeof value === "string" &&
    LIVE_ROOM_POST_SIGNAL_LABELS.has(value as LiveRoomPostSignal)
  );
}

export function getLiveRoomPostSignalLabel(
  value: LiveRoomPostSignal,
) {
  return LIVE_ROOM_POST_SIGNAL_LABELS.get(value) || value;
}

export function isLiveRoomPostDirection(
  value: unknown,
): value is LiveRoomPostDirection {
  return LIVE_ROOM_POST_DIRECTIONS.some(
    (direction) => direction.value === value,
  );
}

export function encodeLiveRoomPostMetadataTags(
  signalLabels: readonly LiveRoomPostSignal[],
  direction: LiveRoomPostDirection | null,
): LiveRoomPostMetadataTag[] {
  return direction
    ? [...signalLabels, LIVE_ROOM_POST_DIRECTION_TAGS[direction]]
    : [...signalLabels];
}

export function readLiveRoomPostDirection(
  values: readonly unknown[],
): LiveRoomPostDirection | null {
  for (const direction of LIVE_ROOM_POST_DIRECTIONS) {
    if (values.includes(LIVE_ROOM_POST_DIRECTION_TAGS[direction.value])) {
      return direction.value;
    }
  }
  return null;
}
