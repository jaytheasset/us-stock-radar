"use client";

import { useState } from "react";
import { PremiumBillingControl } from "@/components/premium-v2/PremiumBillingControl";
import { PremiumFeatureComparison } from "@/components/premium-v2/PremiumFeatureComparison";
import {
  premiumV2AlertModel,
  premiumV2Benefits,
  premiumV2Categories,
  premiumV2CategoryLegend,
  premiumV2CurrentPlan,
  premiumV2FaqItems,
  premiumV2LiveAlerts,
  premiumV2PlanOrder,
  premiumV2Plans,
  premiumV2RecommendedPlan,
  type PremiumV2BillingCycle,
  type PremiumV2PlanKey,
} from "@/lib/mock/premiumV2Data";
import styles from "./StockRadarPremiumV2.module.css";

function getDisplayedPrice(planKey: PremiumV2PlanKey, billingCycle: PremiumV2BillingCycle) {
  const plan = premiumV2Plans[planKey];

  if (billingCycle === "monthly") {
    return { price: plan.monthlyPrice, suffix: "/ mo" };
  }

  if (plan.annualPrice) {
    return { price: plan.annualPrice, suffix: "/ yr" };
  }

  return { price: "Unconfirmed", suffix: "annual" };
}

export function StockRadarPremiumV2() {
  const [billingCycle, setBillingCycle] = useState<PremiumV2BillingCycle>("monthly");
  const [selectionMessage, setSelectionMessage] = useState("");

  const selectBillingCycle = (cycle: PremiumV2BillingCycle) => {
    setBillingCycle(cycle);
    setSelectionMessage("");
  };

  const previewPlan = (planKey: PremiumV2PlanKey) => {
    const plan = premiumV2Plans[planKey];
    setSelectionMessage(
      `${plan.name} ${billingCycle} selected for preview. No checkout, payment, or account change was started.`,
    );
  };

  return (
    <div className={styles.root}>
      <div className={styles.workspace}>
        <header className={styles.pageHeader}>
          <div className={styles.titleBlock}>
            <span>Account / Plan</span>
            <h1>Premium</h1>
            <p>Compare alert coverage, limits, and delivery lanes before choosing a plan.</p>
          </div>
          <div className={styles.headerControls}>
            <div className={styles.currentPlanLine}>
              <span>Current plan</span>
              <strong>{premiumV2Plans[premiumV2CurrentPlan].name}</strong>
            </div>
            <PremiumBillingControl onChange={selectBillingCycle} value={billingCycle} />
          </div>
        </header>

        {billingCycle === "annual" ? (
          <p className={styles.annualNotice} role="status">
            Annual pricing and savings are not confirmed in the current product source. No discount has been applied.
          </p>
        ) : null}

        <section aria-labelledby="premium-v2-intro-heading" className={styles.heroSection}>
          <div className={styles.heroCopy}>
            <span className={styles.eyebrow}>Premium Alerts</span>
            <h2 id="premium-v2-intro-heading">Choose the market events you never want to miss.</h2>
            <p>
              Get news and filing alerts for your watchlist, plus Market Discovery alerts outside your
              watchlist based on the categories included in your plan.
            </p>
            <div className={styles.actionRow}>
              <button className={styles.primaryButton} onClick={() => previewPlan("free")} type="button">
                Start Free
              </button>
              <button className={styles.secondaryButton} onClick={() => previewPlan("pro")} type="button">
                Upgrade to Pro
              </button>
            </div>
          </div>

          <aside aria-label="Example live alerts" className={styles.alertPreview}>
            <header>
              <div>
                <span>Signal Preview</span>
                <strong>Live alerts</strong>
              </div>
              <span>Mock feed</span>
            </header>
            <div className={styles.alertList}>
              {premiumV2LiveAlerts.map((alert) => (
                <article className={styles.alertRow} key={alert.title}>
                  <span className={`${styles.alertDot} ${styles[alert.tone]}`} aria-hidden="true" />
                  <div>
                    <span className={styles.alertType}>{alert.type}</span>
                    <strong>{alert.title}</strong>
                    <small>{alert.source} · {alert.age}</small>
                  </div>
                  <span className={styles.alertSeverity}>{alert.severity}</span>
                </article>
              ))}
            </div>
          </aside>
        </section>

        <section aria-labelledby="premium-v2-plans-heading" className={styles.plansSection}>
          <div className={styles.sectionHeading}>
            <div>
              <span>Plan Summary</span>
              <h2 id="premium-v2-plans-heading">Choose a coverage tier</h2>
            </div>
            <p>Monthly prices and limits match the current product source. Annual prices are not confirmed.</p>
          </div>

          <div className={styles.planGrid}>
            {premiumV2PlanOrder.map((planKey) => {
              const plan = premiumV2Plans[planKey];
              const displayedPrice = getDisplayedPrice(planKey, billingCycle);
              const isCurrent = planKey === premiumV2CurrentPlan;
              const isRecommended = planKey === premiumV2RecommendedPlan;

              return (
                <article
                  className={`${styles.planCard}${isRecommended ? ` ${styles.recommendedCard}` : ""}`}
                  key={planKey}
                >
                  <header className={styles.planCardHeader}>
                    <div className={styles.planIdentity}>
                      <h3>{plan.name}</h3>
                      {isCurrent ? <span className={styles.planState}>Current</span> : null}
                      {isRecommended ? <span className={styles.recommendedState}>Most popular</span> : null}
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
                    <button className={isRecommended ? styles.primaryButton : styles.secondaryButton} onClick={() => previewPlan(planKey)} type="button">
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

        <section aria-label="Premium alert model" className={styles.modelSection}>
          <div className={styles.benefitGrid}>
            {premiumV2Benefits.map((benefit) => (
              <article key={benefit.title}>
                <h3>{benefit.title}</h3>
                <p>{benefit.description}</p>
              </article>
            ))}
          </div>
          <aside className={styles.alertModel}>
            <span className={styles.eyebrow}>Alert Model</span>
            <h2>Two alert lanes, one subscription.</h2>
            {premiumV2AlertModel.map((item) => (
              <article key={item.title}>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
                <p>{item.detail}</p>
              </article>
            ))}
          </aside>
        </section>

        <section aria-labelledby="premium-v2-categories-heading" className={styles.categoriesSection}>
          <div className={styles.sectionHeading}>
            <div>
              <span>Discovery Coverage</span>
              <h2 id="premium-v2-categories-heading">Market Discovery categories</h2>
            </div>
            <p>Choose event categories outside your watchlist. Your plan controls how many can be active.</p>
          </div>
          <div className={styles.categoryLegend} aria-label="Category limits by plan">
            {premiumV2CategoryLegend.map((item) => (
              <span key={item.label}><i aria-hidden="true" />{item.label} <strong>{item.count}</strong></span>
            ))}
          </div>
          <div className={styles.categoryList}>
            {premiumV2Categories.map((category) => (
              <span className={styles[`category-${category.tone}`]} key={category.label}>{category.label}</span>
            ))}
          </div>
        </section>

        <PremiumFeatureComparison />

        <section aria-labelledby="premium-v2-faq-heading" className={styles.faqSection}>
          <div className={styles.sectionHeading}>
            <div>
              <span>Supporting Information</span>
              <h2 id="premium-v2-faq-heading">Frequently asked questions</h2>
            </div>
            <p>Policy and payment details are intentionally not asserted by this mock.</p>
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
            <h2>Ready to stop missing market-moving alerts?</h2>
            <p>Start free, or preview Pro for real-time watchlist and discovery alerts.</p>
          </div>
          <div className={styles.actionRow}>
            <button className={styles.secondaryButton} onClick={() => previewPlan("free")} type="button">Start Free</button>
            <button className={styles.primaryButton} onClick={() => previewPlan("pro")} type="button">Upgrade to Pro</button>
          </div>
        </section>
      </div>
    </div>
  );
}
