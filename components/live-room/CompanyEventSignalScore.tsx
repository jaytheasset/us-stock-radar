import {
  getDirectionalScoreTone,
  normalizeDirectionalScoreSignal,
} from "@/lib/directionalScore";
import type { CompanyEventSignal } from "@/lib/live-room/types";
import styles from "./LiveRoom.module.css";

export function CompanyEventSignalScore({
  score,
  signal,
}: {
  score: number | null;
  signal: CompanyEventSignal;
}) {
  const direction = normalizeDirectionalScoreSignal(signal);
  const directionLabel =
    direction.charAt(0).toUpperCase() + direction.slice(1);

  return (
    <span className={styles.eventSignalScore}>
      <span
        className={styles.eventSignalDirection}
        data-signal={direction}
      >
        {directionLabel}
      </span>
      <span aria-hidden="true">·</span>
      <span className={styles.eventScore}>
        Score{" "}
        <b data-score-tone={getDirectionalScoreTone(score, signal)}>
          {score === null ? "—" : score}
        </b>
      </span>
    </span>
  );
}
