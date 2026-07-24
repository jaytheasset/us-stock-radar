import { ExternalLink } from "lucide-react";
import styles from "./GooglePreferredSourceLink.module.css";

export function GooglePreferredSourceLink({
  href,
  compact = false,
  header = false,
  summary = false,
}: {
  href: string;
  compact?: boolean;
  header?: boolean;
  summary?: boolean;
}) {
  return (
    <a
      className={`${styles.link}${compact ? ` ${styles.compact}` : ""}${
        header ? ` ${styles.header}` : ""
      }${
        summary ? ` ${styles.summary}` : ""
      }`}
      href={href}
      rel="noopener noreferrer"
      target="_blank"
    >
      <GoogleIcon />
      {summary ? (
        <span className={styles.summaryMessage}>
          Add Stock Radar as a preferred source on Google
        </span>
      ) : header ? (
        <>
          <span className={styles.headerDesktopMessage}>
            Add Stock Radar as a preferred source
          </span>
          <span className={styles.headerMobileMessage}>
            Add Stock Radar on Google
          </span>
        </>
      ) : (
        <span>Prefer Stock Radar on Google</span>
      )}
      <ExternalLink aria-hidden="true" size={14} />
    </a>
  );
}

function GoogleIcon() {
  return (
    <svg
      aria-hidden="true"
      className={styles.googleIcon}
      viewBox="0 0 18 18"
    >
      <path
        d="M17.64 9.205c0-.638-.057-1.252-.164-1.841H9v3.481h4.844c-.209 1.125-.843 2.078-1.797 2.716v2.258h2.908c1.703-1.567 2.685-3.874 2.685-6.614Z"
        fill="#4285F4"
      />
      <path
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.909-2.258c-.806.54-1.835.859-3.047.859-2.344 0-4.329-1.585-5.037-3.71H.999v2.332C2.48 15.983 5.482 18 9 18Z"
        fill="#34A853"
      />
      <path
        d="M3.963 10.711A5.44 5.44 0 0 1 3.68 9c0-.594.103-1.171.283-1.711V4.957H.999A9.003 9.003 0 0 0 0 9c0 1.458.391 2.83.999 4.043l2.964-2.332Z"
        fill="#FBBC05"
      />
      <path
        d="M9 3.579c1.321 0 2.508.454 3.442 1.346l2.581-2.581C13.464.892 11.426 0 9 0 5.482 0 2.48 2.017.999 4.957l2.964 2.332C4.671 5.164 6.656 3.579 9 3.579Z"
        fill="#EA4335"
      />
    </svg>
  );
}
