import { ExternalLink } from "lucide-react";
import styles from "./GooglePreferredSourceLink.module.css";

export function GooglePreferredSourceLink({
  href,
  compact = false,
}: {
  href: string;
  compact?: boolean;
}) {
  return (
    <a
      className={`${styles.link}${compact ? ` ${styles.compact}` : ""}`}
      href={href}
      rel="noopener noreferrer"
      target="_blank"
    >
      <span>Prefer Stock Radar on Google</span>
      <ExternalLink aria-hidden="true" size={14} />
    </a>
  );
}
