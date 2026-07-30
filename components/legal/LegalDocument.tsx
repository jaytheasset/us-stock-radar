import type { ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { legalPolicyMeta } from "@/lib/legalPolicy";
import styles from "./LegalDocument.module.css";

export type LegalDocumentSection = {
  content: ReactNode;
  id: string;
  title: string;
};

type LegalDocumentProps = {
  description: string;
  documentTitle: string;
  relatedHref: "/privacy" | "/terms";
  relatedLabel: string;
  sections: LegalDocumentSection[];
};

export function LegalDocument({
  description,
  documentTitle,
  relatedHref,
  relatedLabel,
  sections,
}: LegalDocumentProps) {
  return (
    <article className={styles.page}>
      <header className={styles.hero}>
        <div className={styles.heroCopy}>
          <span className={styles.eyebrow}>Legal</span>
          <h1>{documentTitle}</h1>
          <p>{description}</p>
        </div>

        <dl className={styles.metadata} aria-label="Policy dates">
          <div>
            <dt>Effective</dt>
            <dd>{legalPolicyMeta.effectiveDate}</dd>
          </div>
          <div>
            <dt>Last updated</dt>
            <dd>{legalPolicyMeta.updatedDate}</dd>
          </div>
        </dl>

        <nav className={styles.documentActions} aria-label="Legal document links">
          <Link className={styles.primaryAction} href="/dashboard-v2">
            Return to Markets
          </Link>
          <Link className={styles.secondaryAction} href={relatedHref}>
            {relatedLabel}
            <ArrowUpRight aria-hidden="true" size={15} />
          </Link>
        </nav>
      </header>

      <div className={styles.layout}>
        <aside className={styles.tableOfContents}>
          <div>
            <p>On this page</p>
            <ol>
              {sections.map((section, index) => (
                <li key={section.id}>
                  <a href={`#${section.id}`}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    {section.title}
                  </a>
                </li>
              ))}
            </ol>
          </div>
        </aside>

        <div className={styles.content}>
          {sections.map((section, index) => (
            <section id={section.id} key={section.id}>
              <div className={styles.sectionHeading}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <h2>{section.title}</h2>
              </div>
              <div className={styles.sectionBody}>{section.content}</div>
            </section>
          ))}

          <footer className={styles.footer}>
            <p>
              Current version: {legalPolicyMeta.updatedDate}. Keep a copy for
              your records.
            </p>
            <div>
              <Link href="/dashboard-v2">Markets</Link>
              <Link href="/feed">Live Feed</Link>
              <Link href={relatedHref}>{relatedLabel}</Link>
            </div>
          </footer>
        </div>
      </div>
    </article>
  );
}
