import Link from "next/link";
import { AuthStatus } from "@/components/AuthStatus";
import { ProTrialCta } from "@/components/ProTrialCta";
import { getOptionalCurrentUserId } from "@/lib/currentUser";
import { getEffectiveUserPlan, type EffectiveUserPlan } from "@/lib/subscription/effectivePlan";
import {
  ALERT_CATEGORIES,
  PLAN_LIMITS,
  type AlertCategoryKey,
  type PlanKey,
  formatAlertSpeed,
  formatChannels,
  formatLimit,
  getPlanDisplayName,
  getPlanLimits,
} from "@/lib/subscriptionPolicy";

export const dynamic = "force-dynamic";

const navItems = [
  { label: "Live Feed", href: "/feed" },
  { label: "Watchlist", href: "/watchlist" },
  { label: "News", href: "/news" },
  { label: "Filings", href: "/filings" },
  { label: "Calendar", href: "/calendar" },
  { label: "Alerts", href: "/alerts" },
  { label: "Premium", href: "/premium" },
];

const planOrder: PlanKey[] = ["free", "ad_free", "pro", "advanced", "ultimate"];

const planPresentation: Record<
  PlanKey,
  { price: string; note: string; cta: string; popular: boolean; extraLimit?: string }
> = {
  free: {
    price: "$0",
    note: "Start tracking the market.",
    cta: "Start Free",
    popular: false,
    extraLimit: "Ads included",
  },
  ad_free: {
    price: "$4.99",
    note: "Cleaner experience for casual users.",
    cta: "Choose Ad-Free",
    popular: false,
    extraLimit: "Ads removed",
  },
  pro: {
    price: "$19",
    note: "Real-time alerts for your watchlist and selected market categories.",
    cta: "Upgrade to Pro",
    popular: true,
  },
  advanced: {
    price: "$49",
    note: "All 17 categories with advanced filters.",
    cta: "Go Advanced",
    popular: false,
  },
  ultimate: {
    price: "$199+",
    note: "Full scanner access for professionals.",
    cta: "Start Ultimate",
    popular: false,
  },
};

function planHasChannel(plan: PlanKey, channel: string) {
  return (PLAN_LIMITS[plan].channels as readonly string[]).includes(channel);
}

function formatCategoryLimit(plan: PlanKey) {
  const limits = getPlanLimits(plan);
  if (limits.customRules) return `${ALERT_CATEGORIES.length} categories + custom rules`;
  if (limits.discoveryCategoryLimit === ALERT_CATEGORIES.length) return `All ${ALERT_CATEGORIES.length} Market Discovery categories`;
  return `${limits.discoveryCategoryLimit} of ${ALERT_CATEGORIES.length} Market Discovery categories`;
}

const plans = planOrder.map((plan) => {
  const limits = getPlanLimits(plan);
  const presentation = planPresentation[plan];
  const watchlistText = limits.watchlistLimit === null ? "Unlimited watchlist" : `${limits.watchlistLimit} watchlist tickers`;
  return {
    code: plan,
    name: getPlanDisplayName(plan),
    price: presentation.price,
    note: presentation.note,
    cta: presentation.cta,
    popular: presentation.popular,
    limits: [
      watchlistText,
      formatCategoryLimit(plan),
      formatAlertSpeed(plan),
      `${formatChannels(limits.channels)} alerts`,
      presentation.extraLimit ?? (limits.customRules ? "Custom Rules" : limits.advancedFilters ? "Advanced filters" : "Standard filters"),
    ],
  };
});

const comparisonRows = [
  ["Watchlist tickers", ...planOrder.map((plan) => formatLimit(PLAN_LIMITS[plan].watchlistLimit))],
  ["Market Discovery categories", ...planOrder.map((plan) => (PLAN_LIMITS[plan].customRules ? "17 + Custom" : String(PLAN_LIMITS[plan].discoveryCategoryLimit)))],
  ["Alert delay", ...planOrder.map((plan) => (PLAN_LIMITS[plan].alertDelayMinutes === 0 ? "No delay" : `${PLAN_LIMITS[plan].alertDelayMinutes} min`))],
  ["Watchlist news alerts", ...planOrder.map((plan) => (PLAN_LIMITS[plan].realTime ? "Real-time" : "Delayed"))],
  ["Watchlist filing alerts", ...planOrder.map((plan) => (PLAN_LIMITS[plan].realTime ? "Real-time" : "Delayed"))],
  [
    "Discovery news + filings",
    ...planOrder.map((plan) => {
      if (plan === "ultimate") return "Full scanner";
      if (plan === "advanced") return "All categories";
      return `${PLAN_LIMITS[plan].discoveryCategoryLimit} categor${PLAN_LIMITS[plan].discoveryCategoryLimit === 1 ? "y" : "ies"}, ${PLAN_LIMITS[plan].realTime ? "real-time" : "delayed"}`;
    }),
  ],
  ["Telegram", ...planOrder.map((plan) => (planHasChannel(plan, "telegram") ? "Yes" : "-"))],
  ["Email", ...planOrder.map((plan) => (planHasChannel(plan, "email") ? "Yes" : "-"))],
  ["Webhook/API", ...planOrder.map((plan) => (PLAN_LIMITS[plan].webhookApi ? "Yes" : "-"))],
  ["Custom Rules", ...planOrder.map((plan) => (PLAN_LIMITS[plan].customRules ? "Yes" : "-"))],
];

const categoryVisuals: Record<AlertCategoryKey, { tone: string; strength: string }> = {
  listing_risk: { tone: "risk", strength: "high" },
  dilution_risk: { tone: "risk", strength: "high" },
  earnings: { tone: "performance", strength: "high" },
  sales_performance: { tone: "performance", strength: "medium" },
  product_update: { tone: "performance", strength: "medium" },
  leadership_governance: { tone: "governance", strength: "low" },
  insider_ownership: { tone: "governance", strength: "medium" },
  shareholder_vote: { tone: "governance", strength: "low" },
  strategic_transaction: { tone: "transaction", strength: "high" },
  financial_risk: { tone: "risk", strength: "medium" },
  legal_risk: { tone: "risk", strength: "medium" },
  dividends: { tone: "performance", strength: "low" },
  capital_return: { tone: "performance", strength: "medium" },
  ipo_listing: { tone: "transaction", strength: "high" },
  fda_clinical: { tone: "policy", strength: "high" },
  policy_regulation: { tone: "policy", strength: "medium" },
  macro_market: { tone: "policy", strength: "medium" },
  other: { tone: "neutral", strength: "low" },
};

const discoveryCategories = ALERT_CATEGORIES.map((category) => ({
  ...category,
  ...categoryVisuals[category.code],
}));

const categoryLegend = planOrder.map((plan) => ({
  label: getPlanDisplayName(plan),
  count: PLAN_LIMITS[plan].customRules ? `${PLAN_LIMITS[plan].discoveryCategoryLimit} + Custom` : String(PLAN_LIMITS[plan].discoveryCategoryLimit),
  tone: plan === "ad_free" ? "adfree" : plan,
}));

const alertModelRows = [
  {
    label: "Watchlist alerts",
    free: "Track every matching news and filing event for your saved tickers, within your plan limit.",
    paid: "Pro and higher plans remove the 5-minute delay for watchlist news and filing alerts.",
  },
  {
    label: "Market Discovery alerts",
    free: "Monitor selected event categories outside your watchlist.",
    paid: "Your plan controls how many Market Discovery categories and filters can be active.",
  },
  {
    label: "Public Telegram channel",
    free: "A broad public stream can drive users back to the site.",
    paid: "Personalized direct alerts stay separate from the public channel.",
  },
];

const premiumFeatures = [
  {
    title: "Real-time watchlist alerts",
    description: "Pro and higher plans remove the 5-minute delay for watchlist news and filing alerts.",
  },
  {
    title: "Market Discovery scanner",
    description: "Track selected event categories outside your watchlist without turning every source into noise.",
  },
  {
    title: "Advanced alert filters",
    description: "Use plan-level filters for event type, signal, market cap, source, and category delivery.",
  },
  {
    title: "Telegram, email, and API lanes",
    description: "Higher tiers add delivery channels for traders who need alerts outside the website.",
  },
];

const faqItems = [
  {
    question: "Can I cancel anytime?",
    answer:
      "Yes. You can cancel your subscription anytime. Your plan will remain active until the end of your current billing period, and you will not be charged again after cancellation.",
  },
  {
    question: "What happens if I upgrade?",
    answer:
      "Your new plan limits and features become available immediately. This includes additional watchlist tickers, more Market Discovery categories, upgraded alert channels, and access to higher-tier filters where available.",
  },
  {
    question: "Do alerts become real-time immediately after I upgrade?",
    answer:
      "Yes. Pro, Advanced, and Ultimate plans remove the 5-minute alert delay. Free and Ad-Free plans include delayed alerts. Once you upgrade to Pro or higher, eligible watchlist and Market Discovery alerts are delivered in real time.",
  },
  {
    question: "What payment methods do you accept?",
    answer:
      "We accept major credit cards and supported payment methods through our payment provider. Available payment options may vary depending on your country and billing setup.",
  },
  {
    question: "What counts as a Market Discovery category, and can I change it?",
    answer: [
      "A Market Discovery category is an event type you want to monitor outside your watchlist. Categories include listing risk, dilution risk, earnings, FDA/clinical events, insider ownership, legal risk, macro market events, and more.",
      "You can change your selected categories from your alert settings. Plan limits apply: Free includes 1 category, Ad-Free includes 2, Pro includes 6, Advanced includes all 17, and Ultimate includes all 17 plus custom rules.",
    ],
  },
  {
    question: "Are watchlist alerts separate from Market Discovery alerts?",
    answer: [
      "Yes. Watchlist alerts are separate from Market Discovery alerts.",
      "Watchlist alerts cover the tickers you add directly to your watchlist. Market Discovery alerts monitor events outside your watchlist based on the categories and filters included in your plan.",
      "Your Market Discovery category limit does not restrict alerts for your own watchlist tickers.",
    ],
  },
  {
    question: "Does Ad-Free include real-time alerts?",
    answer:
      "No. Ad-Free removes ads and gives you a cleaner experience, but alerts still include a 5-minute delay. Real-time alerts start with the Pro plan.",
  },
  {
    question: "What is Ultimate for?",
    answer:
      "Ultimate is built for professional traders, advanced users, and automation workflows. It includes all Market Discovery categories, Custom Rules, fastest alert routing, and API/Webhook access.",
  },
];

const liveAlerts = [
  {
    type: "DILUTION RISK",
    title: "XYZ Corp files $75M offering",
    source: "8-K filing",
    age: "2m ago",
    severity: "Critical",
    tone: "critical",
  },
  {
    type: "FDA / CLINICAL",
    title: "ABC receives FDA approval",
    source: "Press Release",
    age: "5m ago",
    severity: "High",
    tone: "high",
  },
  {
    type: "LISTING RISK",
    title: "DEF receives Nasdaq deficiency notice",
    source: "8-K filing",
    age: "6m ago",
    severity: "High",
    tone: "high",
  },
  {
    type: "EARNINGS",
    title: "GHI reports Q1 earnings beat",
    source: "Press Release",
    age: "10m ago",
    severity: "Medium",
    tone: "medium",
  },
];

function renderPlanAction(plan: PlanKey, fallbackCta: string, planState: EffectiveUserPlan | null) {
  const actionClass = "premium-plan-action";

  if (planState?.effectivePlan === plan) {
    if (planState.planSource === "trial" && plan === "pro") {
      return (
        <span className="pro-trial-cta-wrap">
          <Link className={actionClass} href="/alerts">
            Manage alerts
          </Link>
          <small>Ends in {planState.trial.daysRemaining ?? 14} days</small>
        </span>
      );
    }

    return (
      <Link className={actionClass} href="/alerts">
        Current plan
      </Link>
    );
  }

  if (plan !== "pro") {
    return (
      <Link className={actionClass} href="/alerts">
        {fallbackCta}
      </Link>
    );
  }

  if (!planState) {
    return (
      <ProTrialCta className={actionClass} guestMode>
        Start 14-day Pro Trial
      </ProTrialCta>
    );
  }

  if (planState.basePlan === "pro" || planState.basePlan === "advanced" || planState.basePlan === "ultimate") {
    return (
      <Link className={actionClass} href="/alerts">
        Current plan
      </Link>
    );
  }

  if (planState.trial.used) {
    return (
      <span className="pro-trial-cta-wrap">
        <Link className={actionClass} href="/alerts">
          Upgrade to Pro
        </Link>
        <small>Your Pro trial has ended.</small>
      </span>
    );
  }

  return (
    <ProTrialCta className={actionClass}>
      Start 14-day Pro Trial
    </ProTrialCta>
  );
}

export default async function PremiumPage() {
  const userId = await getOptionalCurrentUserId();
  const planState = userId ? await getEffectiveUserPlan(userId) : null;

  return (
    <main className="premium-page">
      <header className="feed-nav">
        <Link className="brand-lockup" href="/feed" aria-label="US Stock Radar feed">
          <span className="brand-mark">SR</span>
          <span>STOCK RADAR</span>
        </Link>
        <nav className="feed-nav-links" aria-label="Primary">
          {navItems.map((item) => (
            <Link className={item.label === "Premium" ? "active" : ""} href={item.href} key={item.label}>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="feed-search" role="search">
          <span aria-hidden="true">/</span>
          <input aria-label="Search premium" placeholder="Search stocks, companies, events..." />
        </div>
        <AuthStatus />
      </header>

      <section className="premium-shell">
        <section className="premium-hero">
          <div>
            <span className="premium-overline">Premium Alerts</span>
            <h1>Choose the market events you never want to miss.</h1>
            <p>
              Get news and filing alerts for your watchlist, plus Market Discovery alerts outside your watchlist based
              on the categories included in your plan.
            </p>
            <div className="premium-hero-actions">
              <Link href="/watchlist">Start Free</Link>
              <Link href="#plans">Upgrade to Pro</Link>
            </div>
          </div>
          <aside className="premium-live-alerts" aria-label="Live alert preview">
            <div className="premium-live-alerts-head">
              <span>Live Alerts</span>
              <Link href="/feed">View all alerts</Link>
            </div>
            <div className="premium-live-alert-list">
              {liveAlerts.map((alert) => (
                <article className={`premium-live-alert ${alert.tone}`} key={`${alert.type}-${alert.title}`}>
                  <div className="premium-live-alert-icon" aria-hidden="true" />
                  <div>
                    <strong>{alert.type}</strong>
                    <p>{alert.title}</p>
                    <small>
                      {alert.source} <span aria-hidden="true">-</span> {alert.age}
                    </small>
                  </div>
                  <span>{alert.severity}</span>
                </article>
              ))}
            </div>
          </aside>
        </section>

        <section className="premium-plan-grid" id="plans" aria-label="Pricing plans">
          {plans.map((plan) => (
            <article className={`premium-plan-card${plan.popular ? " is-popular" : ""}`} key={plan.name}>
              {plan.popular ? <span className="premium-popular">Most popular</span> : null}
              {plan.code === "pro" && planState?.trial.active ? <span className="premium-trial-badge">Pro Trial Active</span> : null}
              <div>
                <span>{plan.name}</span>
                <strong>{plan.price}</strong>
                <small>/ mo</small>
              </div>
              <p>{plan.note}</p>
              <ul>
                {plan.limits.map((limit) => (
                  <li key={limit}>{limit}</li>
                ))}
              </ul>
              {renderPlanAction(plan.code, plan.cta, planState)}
            </article>
          ))}
        </section>

        <section className="premium-two-column">
          <div className="premium-feature-list compact">
            {premiumFeatures.map((feature) => (
              <div key={feature.title}>
                <strong>{feature.title}</strong>
                <p>{feature.description}</p>
              </div>
            ))}
          </div>
          <aside className="premium-alert-model">
            <div className="premium-section-heading">
              <span>Alert Model</span>
              <h2>Two alert lanes, one subscription.</h2>
            </div>
            <div>
              {alertModelRows.map((row) => (
                <section key={row.label}>
                  <strong>{row.label}</strong>
                  <p>{row.free}</p>
                  <p>{row.paid}</p>
                </section>
              ))}
            </div>
          </aside>
        </section>

        <section className="premium-category-section">
          <div className="premium-category-heading">
            <h2>Market Discovery Categories</h2>
            <p>
              Choose from these event categories outside your watchlist. Your plan controls how many can be active.
            </p>
            <div className="premium-category-legend" aria-label="Plan category limits">
              {categoryLegend.map((item) => (
                <span className={item.tone} key={item.label}>
                  <b aria-hidden="true" />
                  {item.label} <small>({item.count})</small>
                </span>
              ))}
            </div>
          </div>
          <div className="premium-category-grid" aria-label="Discovery categories">
            {discoveryCategories.map((category) => (
              <span className={`tone-${category.tone} strength-${category.strength}`} key={category.code}>
                {category.label}
              </span>
            ))}
          </div>
        </section>

        <section className="premium-section-heading comparison-heading">
          <span>Feature Comparison</span>
          <h2>Plan limits by tier</h2>
        </section>
        <section className="premium-comparison-table" aria-label="Feature comparison">
          <div className="premium-comparison-head">
            <span>Feature</span>
            <span>Free</span>
            <span>Ad-Free</span>
            <span>Pro</span>
            <span>Advanced</span>
            <span>Ultimate</span>
          </div>
          {comparisonRows.map((row) => (
            <div className="premium-comparison-row" key={row[0]}>
              {row.map((cell, index) =>
                index === 0 ? <strong key={cell}>{cell}</strong> : <span key={`${row[0]}-${cell}-${index}`}>{cell}</span>,
              )}
            </div>
          ))}
        </section>

        <section className="premium-faq-section" aria-label="Frequently asked questions">
          <h2>Frequently Asked Questions</h2>
          <div className="premium-faq-grid">
            {faqItems.map((item) => (
              <details key={item.question}>
                <summary>{item.question}</summary>
                <div className="premium-faq-answer">
                  {Array.isArray(item.answer)
                    ? item.answer.map((answer) => <p key={answer}>{answer}</p>)
                    : <p>{item.answer}</p>}
                </div>
              </details>
            ))}
          </div>
        </section>

        <section className="premium-final-cta">
          <div>
            <h2>Ready to stop missing market-moving alerts?</h2>
            <p>Start free, or upgrade to Pro for real-time watchlist and discovery alerts.</p>
          </div>
          <div className="premium-hero-actions">
            <Link href="/watchlist">Start Free</Link>
            <Link href="#plans">Upgrade to Pro</Link>
          </div>
        </section>
      </section>
    </main>
  );
}
