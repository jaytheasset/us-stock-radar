"use client";

import { useState } from "react";
import { PremiumFeatureComparison } from "@/components/premium-v2/PremiumFeatureComparison";
import {
  premiumV2CurrentPlan,
  premiumV2FaqItems,
  premiumV2MarketCoverageGroups,
  premiumV2PlanOrder,
  premiumV2Plans,
  premiumV2RecommendedPlan,
  premiumV2SampleAlerts,
  type PremiumV2PlanKey,
} from "@/lib/mock/premiumV2Data";
import styles from "./StockRadarPremiumV2.module.css";

function getDisplayedPrice(planKey: PremiumV2PlanKey) {
  const plan = premiumV2Plans[planKey];

  return { price: plan.monthlyPrice, suffix: "/ mo" };
}

export function StockRadarPremiumV2() {
  const [selectionMessage, setSelectionMessage] = useState("");

  const previewPlan = (planKey: PremiumV2PlanKey) => {
    const plan = premiumV2Plans[planKey];
    setSelectionMessage(
      `${plan.name} selected for preview. No checkout, payment, or account change was started.`,
    );
  };

  return (
    <div className={styles.root}>
      <div className={styles.workspace}>
        <header className={styles.pageHeader}>
          <div className={styles.titleBlock}>
            <span>Account / Plan</span>
            <h1>Premium</h1>
            <p>Choose the alert coverage and delivery level that fits how you trade.</p>
          </div>
          <div className={styles.headerControls}>
            <div className={styles.currentPlanLine}>
              <span>Current plan</span>
              <strong>{premiumV2Plans[premiumV2CurrentPlan].name}</strong>
            </div>
          </div>
        </header>

        <section aria-labelledby="premium-v2-intro-heading" className={styles.heroSection}>
          <div className={styles.heroCopy}>
            <span className={styles.eyebrow}>Ticker Alerts + Market Alerts</span>
            <h2 id="premium-v2-intro-heading">Follow the stocks you know. Scan the risks you don&apos;t</h2>
            <p>
              Get the news and filings that can change a position, with plan levels that unlock broader risk
              coverage, stronger filters, and more ways to receive an alert.
            </p>
            <div className={styles.actionRow}>
              <button className={styles.primaryButton} onClick={() => previewPlan("free")} type="button">
                Start Free
              </button>
              <button className={styles.secondaryButton} onClick={() => previewPlan("advanced")} type="button">
                Go Advanced
              </button>
            </div>
          </div>

          <aside aria-label="Sample alerts" className={styles.alertPreview}>
            <header>
              <div>
                <span>Market-Moving Events</span>
                <strong>Catch market-moving risks early</strong>
              </div>
              <span>Advanced Scan</span>
            </header>
            <div className={styles.alertList}>
              {premiumV2SampleAlerts.map((alert) => (
                <article className={styles.alertRow} key={alert.title}>
                  <span className={`${styles.alertDot} ${styles[alert.tone]}`} aria-hidden="true" />
                  <div>
                    <span className={styles.alertType}>{alert.type}</span>
                    <strong>{alert.title}</strong>
                  </div>
                  <span className={`${styles.alertSignal} ${styles[`alertSignal-${alert.signalTone}`]}`}>
                    {alert.signal}
                  </span>
                </article>
              ))}
            </div>
            <p className={styles.alertNote}>
              Advanced scans beyond your watchlist for dilution filings, delisting notices, and FDA catalysts.
            </p>
          </aside>
        </section>

        <section aria-labelledby="premium-v2-plans-heading" className={styles.plansSection}>
          <div className={styles.sectionHeading}>
            <div>
              <span>Plan Summary</span>
              <h2 id="premium-v2-plans-heading">Choose a coverage tier</h2>
            </div>
            <p>Start with the alerts you need, then unlock broader coverage and delivery options as your workflow grows.</p>
          </div>

          <div className={styles.planGrid}>
            {premiumV2PlanOrder.map((planKey) => {
              const plan = premiumV2Plans[planKey];
              const displayedPrice = getDisplayedPrice(planKey);
              const isCurrent = planKey === premiumV2CurrentPlan;
              const isRecommended = planKey === premiumV2RecommendedPlan;

              return (
                <article
                  className={`${styles.planCard}${planKey === "pro" ? ` ${styles.planCardPro}` : ""}${planKey === "advanced" ? ` ${styles.planCardAdvanced}` : ""}${planKey === "ultimate" ? ` ${styles.planCardUltimate}` : ""}${isRecommended ? ` ${styles.recommendedCard}` : ""}`}
                  key={planKey}
                >
                  <header className={styles.planCardHeader}>
                    <div className={styles.planIdentity}>
                      <h3>{plan.name}</h3>
                      {isCurrent ? <span className={styles.planState}>Current</span> : null}
                      {isRecommended ? (
                        <span className={styles.recommendedState}>{plan.badge ?? "Recommended"}</span>
                      ) : null}
                    </div>
                    <div className={styles.price}>
                      <strong>{displayedPrice.price}</strong>
                      <span>{displayedPrice.suffix}</span>
                    </div>
                  </header>
                  <p className={styles.planDescription}>{plan.description}</p>
                  <ul className={styles.benefitList}>
                    {plan.benefits.map((benefit) => <li key={benefit}>{benefit}</li>)}
                  </ul>
                  {isCurrent ? (
                    <div className={styles.currentPlanAction}>Active plan</div>
                  ) : (
                    <button
                      className={isRecommended ? styles.primaryButton : styles.secondaryButton}
                      onClick={() => previewPlan(planKey)}
                      type="button"
                    >
                      {plan.cta}
                    </button>
                  )}
                </article>
              );
            })}
          </div>

          <p aria-live="polite" className={styles.selectionStatus} data-testid="premium-v2-upgrade-status">
            {selectionMessage}
          </p>
        </section>

        <section aria-labelledby="premium-v2-categories-heading" className={styles.categoriesSection}>
          <div className={styles.sectionHeading}>
            <div>
              <span>Alert Coverage</span>
              <h2 id="premium-v2-categories-heading">Core Events vs Risk &amp; Catalyst Events</h2>
            </div>
          </div>
          <div className={styles.coverageGroups}>
            {premiumV2MarketCoverageGroups.map((group) => (
              <article
                className={`${styles.coverageGroup} ${styles[`coverageGroup-${group.planKey}`]}`}
                data-plan-tier={group.planKey}
                key={group.title}
              >
                <header>
                  <div>
                    <span className={styles.coverageTier}>
                      {premiumV2Plans[group.planKey].name} lane
                    </span>
                    <h3>{group.title}</h3>
                    <p>{group.description}</p>
                  </div>
                  <span className={styles.planState}>{group.badge}</span>
                </header>
                <div className={styles.categoryList}>
                  {group.items.map((category) => (
                    <span className={styles[`category-${category.tone}`]} key={category.label}>
                      <span>{category.label}</span>
                      <strong>{group.badge}</strong>
                    </span>
                  ))}
                </div>
              </article>
            ))}
          </div>
          <p className={`${styles.alertNote} ${styles.coverageNote}`}>
            Market-wide alerts can use News, Filings, or both as sources. Selecting event types narrows
            scope and does not bypass the minimum alert score.
          </p>
        </section>

        <PremiumFeatureComparison />

        <section aria-labelledby="premium-v2-faq-heading" className={styles.faqSection}>
          <div className={styles.sectionHeading}>
            <div>
              <span>Supporting Information</span>
              <h2 id="premium-v2-faq-heading">Frequently asked questions</h2>
            </div>
            <p>Short answers for the alert model. Detailed limits are in the comparison table.</p>
          </div>
          <div className={styles.faqGrid}>
            {premiumV2FaqItems.map((item) => (
              <details key={item.question}>
                <summary>{item.question}</summary>
                <p>{item.answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section aria-label="Premium call to action" className={styles.finalCta}>
          <div>
            <span className={styles.eyebrow}>Alert Coverage</span>
            <h2>Choose the alert lane that matches your workflow.</h2>
            <p>Your ticker alerts cover what you're watching. Advanced finds high-impact risks across the market.</p>
          </div>
          <div className={styles.actionRow}>
            <button className={styles.secondaryButton} onClick={() => previewPlan("free")} type="button">Start Free</button>
            <button className={styles.primaryButton} onClick={() => previewPlan("advanced")} type="button">Go Advanced</button>
          </div>
        </section>
      </div>
    </div>
  );
}
