export const directionalScoreThreshold = 75;

export type DirectionalScoreSignal =
  | "bullish"
  | "bearish"
  | "volatile"
  | "neutral";

export type DirectionalScoreTone = "default" | DirectionalScoreSignal;

export function normalizeDirectionalScoreSignal(
  signal: unknown,
): DirectionalScoreSignal {
  if (typeof signal !== "string") return "neutral";

  const normalized = signal.trim().toLowerCase();
  if (
    normalized === "bullish" ||
    normalized === "bearish" ||
    normalized === "volatile" ||
    normalized === "neutral"
  ) {
    return normalized;
  }

  return "neutral";
}

export function getDirectionalScoreTone(
  score: number | null | undefined,
  signal: unknown,
): DirectionalScoreTone {
  if (
    typeof score !== "number" ||
    !Number.isFinite(score) ||
    score < directionalScoreThreshold
  ) {
    return "default";
  }

  return normalizeDirectionalScoreSignal(signal);
}
