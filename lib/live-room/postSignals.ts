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
