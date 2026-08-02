"use client";

import Link from "next/link";
import { useState } from "react";
import { AdvancedTrialCta } from "@/components/AdvancedTrialCta";
import { PremiumFeatureComparison } from "@/components/premium-v2/PremiumFeatureComparison";
import { PremiumMarketMovingEvents } from "@/components/premium-v2/PremiumMarketMovingEvents";
import {
  premiumV2FaqItems,
  premiumV2MarketCoverageGroups,
  premiumV2PlanOrder,
  premiumV2Plans,
  premiumV2RecommendedPlan,
  type PremiumV2PlanKey,
} from "@/lib/mock/premiumV2Data";
import styles from "./StockRadarPremiumV2.module.css";

export type PremiumV2AccountState = {
  authenticated: boolean;
  basePlan: PremiumV2PlanKey;
  currentPlan: PremiumV2PlanKey;
  planSource: "base" | "trial";
  trial: {
    active: boolean;
    daysRemaining?: number;
    plan?: "pro" | "advanced";
    used: boolean;
  };
};

type StockRadarPremiumV2Props = {
  accountState: PremiumV2AccountState;
};

export function StockRadarPremiumV2({ accountState }: StockRadarPremiumV2Props) {
  const [selectionMessage, setSelectionMessage] = useState("");

  const previewPlan = (planKey: PremiumV2PlanKey) => {
    const plan = premiumV2Plans[planKey];
    setSelectionMessage(
      `${plan.name} selected for preview. No checkout, payment, or account change was started.`,
    );
  };

  const renderPlanAwareSecondaryAction = () => {
    if (!accountState.authenticated) {
      return (
        <button
          className={styles.secondaryButton}
          onClick={() => previewPlan("free")}
          type="button"
        >
          Start Free
        </button>
      );
    }

    if (accountState.currentPlan === "free") {
      return (
        <Link className={styles.secondaryButton} href="/alerts">
          Manage alerts
        </Link>
      );
    }

    return (
      <Link className={styles.secondaryButton} href="/account">
        Current: {premiumV2Plans[accountState.currentPlan].name}
      </Link>
    );
  };

  const renderAdvancedAction = ({
    className,
    includedClassName = className,
    includedLabel = "Manage alerts",
  }: {
    className: string;
    includedClassName?: string;
    includedLabel?: string;
  }) => {
    if (!accountState.authenticated) {
      return (
        <AdvancedTrialCta
          className={className}
          guestLabel="Start 14-day Advanced Trial"
          guestMode
        />
      );
    }

    if (
      accountState.currentPlan === "advanced" ||
      accountState.currentPlan === "ultimate" ||
      accountState.basePlan === "advanced" ||
      accountState.basePlan === "ultimate"
    ) {
      return (
        <Link className={includedClassName} href="/alerts">
          {includedLabel}
        </Link>
      );
    }

    if (accountState.trial.used) {
      return (
        <div className={styles.planActionGroup}>
          <button
            className={className}
            onClick={() => previewPlan("advanced")}
            type="button"
          >
            Upgrade to Advanced
          </button>
          <small className={styles.trialNote}>Your free trial has ended.</small>
        </div>
      );
    }

    return (
      <AdvancedTrialCta className={className}>
        Start 14-day Advanced Trial
      </AdvancedTrialCta>
    );
  };

  const renderPlanAction = (
    planKey: PremiumV2PlanKey,
    isCurrent: boolean,
    isRecommended: boolean,
  ) => {
    if (isCurrent) {
      return (
        <div className={styles.planActionGroup}>
          <Link className={styles.currentPlanAction} href="/alerts">
            Manage alerts
          </Link>
          {accountState.planSource === "trial" ? (
            <small className={styles.trialNote}>
              {accountState.trial.plan === "pro" ? "Legacy Pro" : "Advanced"} trial ends in{" "}
              {accountState.trial.daysRemaining ?? 14} days
            </small>
          ) : null}
        </div>
      );
    }

    if (planKey === "advanced") {
      return renderAdvancedAction({
        className: isRecommended ? styles.primaryButton : styles.secondaryButton,
        includedClassName: styles.currentPlanAction,
        includedLabel: "Included in current plan",
      });
    }

    return (
      <button
        className={isRecommended ? styles.primaryButton : styles.secondaryButton}
        onClick={() => previewPlan(planKey)}
        type="button"
      >
        {premiumV2Plans[planKey].cta}
      </button>
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
              {renderPlanAwareSecondaryAction()}
              {renderAdvancedAction({ className: styles.primaryButton })}
            </div>
          </div>

          <PremiumMarketMovingEvents />
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
              const isCurrent =
                accountState.authenticated && planKey === accountState.currentPlan;
              const isRecommended = planKey === premiumV2RecommendedPlan;

              return (
                <article
                  className={`${styles.planCard}${planKey === "ultimate" ? ` ${styles.planCardUltimate}` : ""}${isCurrent ? ` ${styles.currentCard}` : ""}${isRecommended ? ` ${styles.recommendedCard}` : ""}`}
                  data-current-plan={isCurrent ? "true" : undefined}
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
                      <strong>{plan.monthlyPrice}</strong>
                      <span>/ mo</span>
                    </div>
                  </header>
                  <p className={styles.planDescription}>{plan.description}</p>
                  <ul className={styles.benefitList}>
                    {plan.benefits.map((benefit) => <li key={benefit}>{benefit}</li>)}
                  </ul>
                  {renderPlanAction(planKey, isCurrent, isRecommended)}
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
                    <span className={styles.coverageTier}>{group.badge}</span>
                    <h3>{group.title}</h3>
                    <p>{group.description}</p>
                  </div>
                </header>
                <div className={styles.categoryList}>
                  {group.items.map((category) => (
                    <span key={category.label}>{category.label}</span>
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
            {renderPlanAwareSecondaryAction()}
            {renderAdvancedAction({ className: styles.primaryButton })}
          </div>
        </section>
      </div>
    </div>
  );
}
