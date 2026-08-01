"use client";

import Link from "next/link";

type AdvancedTrialCtaProps = {
  guestMode?: boolean;
  children?: string;
  guestLabel?: string;
  className?: string;
};

/**
 * The Advanced trial requires a card-backed checkout. Until that checkout is
 * connected, this component must not imply that clicking can activate access.
 */
export function AdvancedTrialCta({
  guestMode = false,
  children = "Start 14-day Advanced Trial",
  guestLabel = "Create account for Advanced trial",
  className = "",
}: AdvancedTrialCtaProps) {
  if (guestMode) {
    return (
      <Link className={className || undefined} href="/signup">
        {guestLabel}
      </Link>
    );
  }

  return (
    <span className="advanced-trial-cta-wrap">
      <button
        className={className || undefined}
        disabled
        title="Card checkout is required and is not connected yet."
        type="button"
      >
        {children}
      </button>
      <small>Card required · Renews as monthly Advanced after 14 days · Checkout required</small>
    </span>
  );
}
