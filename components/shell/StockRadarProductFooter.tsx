import Link from "next/link";
import styles from "./StockRadarProductFooter.module.css";

export function StockRadarProductFooter() {
  return (
    <footer
      aria-label="Market information disclaimer"
      className={styles.footer}
    >
      <p>
        Information only. Not investment advice. Market data may be delayed,
        incomplete, or inaccurate. Investing involves risk, including loss of
        principal.{" "}
        <Link href="/terms#market-information">Full disclaimer</Link>
      </p>
    </footer>
  );
}
