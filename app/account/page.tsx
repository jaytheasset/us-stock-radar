import type { Metadata } from "next";
import {
  ArrowRight,
  BadgeCheck,
  Bell,
  Bookmark,
  CreditCard,
  KeyRound,
  MailCheck,
  MessageCircle,
  Landmark,
  Star,
  Users,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AccountLogoutButton } from "@/components/account/AccountLogoutButton";
import styles from "@/components/account/AccountPage.module.css";
import { StockRadarAppShell } from "@/components/shell/StockRadarAppShell";
import { MemberPlanBadge } from "@/components/ui/MemberPlanBadge";
import { getAuthAccessTokenFromCookies } from "@/lib/auth/sessionCookies";
import { getSupabaseAuthUser } from "@/lib/auth/supabaseAuth";
import { getOptionalCurrentUserId } from "@/lib/currentUser";
import { getEffectiveUserPlan } from "@/lib/subscription/effectivePlan";
import { getPlanDisplayName } from "@/lib/subscriptionPolicy";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Account",
  description: "View your Stock Radar account, plan, and market tools.",
  robots: {
    index: false,
    follow: false,
  },
};

export default async function AccountPage() {
  const userId = await getOptionalCurrentUserId();
  if (!userId) {
    redirect("/login?next=%2Faccount");
  }

  const accessToken = await getAuthAccessTokenFromCookies();
  const [authUser, plan] = await Promise.all([
    getSupabaseAuthUser(accessToken),
    getEffectiveUserPlan(userId),
  ]);

  if (!authUser?.id || authUser.id !== userId) {
    redirect("/login?next=%2Faccount");
  }

  const emailConfirmed = Boolean(
    authUser.email_confirmed_at || authUser.confirmed_at,
  );

  return (
    <StockRadarAppShell activeNavigationItem={null} themeMode="user-selectable">
      <section className={styles.page}>
        <header className={styles.heading}>
          <div>
            <span className={styles.eyebrow}>Account</span>
            <h1>Your Stock Radar account</h1>
            <p>
              Review your sign-in status, current plan, and shortcuts to your market tools.
            </p>
          </div>
          <MemberPlanBadge
            className={styles.accountPlanBadge}
            plan={plan.effectivePlan}
            suffix={plan.planSource === "trial" ? " trial" : ""}
          />
        </header>

        <div className={styles.grid}>
          <article className={styles.card}>
            <div className={styles.cardHeader}>
              <h2>Account details</h2>
              <span className={styles.statusBadge}>
                {emailConfirmed ? "Email confirmed" : "Confirmation pending"}
              </span>
            </div>
            <dl className={styles.details}>
              <div className={styles.detailRow}>
                <dt>Email</dt>
                <dd>{authUser.email || "Not available"}</dd>
              </div>
              <div className={styles.detailRow}>
                <dt>Current access</dt>
                <dd>{getPlanDisplayName(plan.effectivePlan)}</dd>
              </div>
              <div className={styles.detailRow}>
                <dt>Base plan</dt>
                <dd>{getPlanDisplayName(plan.basePlan)}</dd>
              </div>
              <div className={styles.detailRow}>
                <dt>Trial</dt>
                <dd>
                  {plan.trial.active
                    ? `${plan.trial.daysRemaining || 1} day${plan.trial.daysRemaining === 1 ? "" : "s"} remaining`
                    : plan.trial.used
                      ? "Already used"
                      : "Available after card-backed checkout launches"}
                </dd>
              </div>
            </dl>
            <div className={styles.confirmationNote}>
              <MailCheck aria-hidden="true" size={17} />
              <span>
                {emailConfirmed
                  ? "Your email address is verified."
                  : "Open the confirmation email before signing in on a new device."}
              </span>
            </div>
            <p className={styles.trialNote}>
              Plan changes and the Advanced 14-day trial continue through Premium. Trial access is not activated until card-backed checkout is connected.
            </p>
          </article>

          <aside className={styles.card}>
            <div className={styles.cardHeader}>
              <h2>Account actions</h2>
            </div>
            <div className={styles.actionList}>
              <AccountLink href="/premium" icon={<CreditCard size={16} />}>
                View plans
              </AccountLink>
              <AccountLink href="/alerts" icon={<Bell size={16} />}>
                Alert settings
              </AccountLink>
              <AccountLink href="/watchlist" icon={<Star size={16} />}>
                Watchlist
              </AccountLink>
              <AccountLink href="/saved" icon={<Bookmark size={16} />}>
                Bookmarks
              </AccountLink>
              <AccountLink href="/account/creator" icon={<BadgeCheck size={16} />}>
                Social account verification
              </AccountLink>
              <AccountLink href="/account/brokerage" icon={<Landmark size={16} />}>
                Brokerage verification
              </AccountLink>
              <AccountLink
                href="/community"
                icon={<Users size={16} />}
              >
                Community &amp; Messages
              </AccountLink>
              <AccountLink
                href="/account/messages"
                icon={<MessageCircle size={16} />}
              >
                Message privacy
              </AccountLink>
              <AccountLink
                href="/account/update-password"
                icon={<KeyRound size={16} />}
              >
                Change password
              </AccountLink>
              <AccountLogoutButton />
            </div>
          </aside>
        </div>
      </section>
    </StockRadarAppShell>
  );
}

function AccountLink({
  href,
  icon,
  children,
}: {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Link className={styles.actionLink} href={href}>
      <span>{icon} {children}</span>
      <ArrowRight aria-hidden="true" size={15} />
    </Link>
  );
}
