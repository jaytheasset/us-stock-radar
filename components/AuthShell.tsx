"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { StockRadarThemeProvider } from "@/components/shell/StockRadarThemeProvider";
import { StockRadarThemeToggle } from "@/components/shell/StockRadarThemeToggle";
import styles from "@/components/AuthForm.module.css";

export function AuthShell({
  children,
  description,
  eyebrow,
  footer,
  title,
}: {
  children: ReactNode;
  description: string;
  eyebrow: string;
  footer?: ReactNode;
  title: string;
}) {
  return (
    <StockRadarThemeProvider className={styles.authRoot} mode="user-selectable">
      <header className={styles.authHeader}>
        <Link
          aria-label="US Stock Radar Live Feed"
          className={styles.authBrand}
          href="/feed"
        >
          <span aria-hidden="true" className={styles.brandSignal} />
          <span>US Stock Radar</span>
        </Link>
        <div className={styles.headerActions}>
          <Link className={styles.backToProduct} href="/feed">
            Back to Live Feed
          </Link>
          <StockRadarThemeToggle />
        </div>
      </header>

      <main className={styles.authMain}>
        <section
          aria-labelledby="auth-page-title"
          className={styles.authPanel}
        >
          <div className={styles.authHeading}>
            <span className={styles.eyebrow}>{eyebrow}</span>
            <h1 id="auth-page-title">{title}</h1>
            <p>{description}</p>
          </div>
          {children}
          {footer ? <div className={styles.authFooter}>{footer}</div> : null}
        </section>
      </main>
    </StockRadarThemeProvider>
  );
}
