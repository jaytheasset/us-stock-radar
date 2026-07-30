import type { Metadata } from "next";
import Link from "next/link";
import {
  LegalDocument,
  type LegalDocumentSection,
} from "@/components/legal/LegalDocument";
import { StockRadarAppShell } from "@/components/shell/StockRadarAppShell";
import { legalPolicyMeta } from "@/lib/legalPolicy";

export const metadata: Metadata = {
  title: "Terms of Service | Stock Radar",
  description: "Terms governing use of the Stock Radar service.",
};

const sections: LegalDocumentSection[] = [
  {
    id: "acceptance-eligibility",
    title: "Acceptance and eligibility",
    content: (
      <>
        <p>
          These Terms of Service (&ldquo;Terms&rdquo;) govern your access to and
          use of Stock Radar, including its websites, market tools, alerts,
          community areas, and related features (the &ldquo;Service&rdquo;). By
          creating an account or using the Service, you agree to these Terms. If
          you do not agree, do not use the Service.
        </p>
        <p>
          You must be at least 18 years old and legally able to enter into these
          Terms. If you use the Service for an organization, you represent that
          you have authority to bind it, and &ldquo;you&rdquo; includes that
          organization.
        </p>
      </>
    ),
  },
  {
    id: "service-accounts",
    title: "Service and account responsibilities",
    content: (
      <>
        <p>
          Stock Radar organizes market data, news, regulatory filings, event
          analysis, watchlists, alerts, calendars, and community discussion.
          Features, sources, coverage, and availability may change as the
          Service develops.
        </p>
        <p>
          You are responsible for accurate account information, safeguarding
          your sign-in methods, and activity under your account. Notify Stock
          Radar through the contact route below if you believe your
          account has been compromised. Do not share access in a way that
          bypasses plan limits or security controls.
        </p>
      </>
    ),
  },
  {
    id: "market-information",
    title: "Market information and investment decisions",
    content: (
      <>
        <p>
          Market prices, charts, filings, news, alerts, rankings, AI-assisted
          summaries, and other information may be delayed, incomplete, or
          inaccurate. Sources can revise or remove information, and delivery
          times can vary. Labels such as bullish, bearish, impact, score, signal,
          or proof are organizational aids, not guarantees.
        </p>
        <p>
          Stock Radar does not provide investment, legal, tax, or accounting
          advice and is not a broker-dealer, investment adviser, exchange, or
          fiduciary. Nothing in the Service is an offer, solicitation,
          recommendation, or guarantee of performance. You are solely
          responsible for verifying information, assessing risk, and making
          investment decisions. Investing can result in loss of principal.
        </p>
      </>
    ),
  },
  {
    id: "community-content",
    title: "Community content and conduct",
    content: (
      <>
        <p>
          The Service may let users create posts, comments, chats, direct
          messages, profiles, reports, and other content (&ldquo;User
          Content&rdquo;). You retain rights you have in User Content and grant
          Stock Radar a non-exclusive, worldwide, royalty-free license to host,
          reproduce, display, and process it only as reasonably needed to
          operate, secure, moderate, and improve the Service.
        </p>
        <p>You may not post or transmit content that:</p>
        <ul>
          <li>is unlawful, fraudulent, deceptive, defamatory, or abusive;</li>
          <li>
            manipulates markets, impersonates others, or misrepresents a
            position, credential, affiliation, or source;
          </li>
          <li>
            infringes intellectual property, privacy, publicity, or other
            rights;
          </li>
          <li>
            contains malware, spam, unauthorized promotions, private account
            credentials, or another person&apos;s sensitive information; or
          </li>
          <li>
            interferes with moderation, security, rate limits, or normal use of
            the Service.
          </li>
        </ul>
        <p>
          Users can report supported content. Stock Radar may review reports,
          limit distribution, remove content, preserve relevant records, or
          restrict accounts, but cannot promise to review every item or resolve
          it within a particular time.
        </p>
      </>
    ),
  },
  {
    id: "verification",
    title: "Social verification",
    content: (
      <>
        <p>
          A social verification badge or record indicates only that the
          submitted URL or proof was reviewed under the process available at
          that time. It does not guarantee a person&apos;s identity, continuing
          control of an external account, professional status, investing skill,
          honesty, or accuracy of any content.
        </p>
        <p>
          Verification may expire, be revoked, or require additional review.
          You must not use verification to imply endorsement by Stock Radar or
          by a third-party platform.
        </p>
      </>
    ),
  },
  {
    id: "brokerage",
    title: "Optional brokerage connection and evidence",
    content: (
      <>
        <p>
          Eligible Pro, Advanced, and Ultimate users may choose to connect a
          brokerage through SnapTrade. The connection is read-only. Stock Radar
          does not place orders, execute trades, hold assets, or move money.
          SnapTrade and any connected broker apply their own terms, consent
          flows, availability rules, and data limitations.
        </p>
        <p>
          Subject to available controls and the applicable data-use permissions,
          a user may publish only selected holdings or execution records in a
          server-generated proof card. Any public-proof or data-repackaging
          feature remains subject to SnapTrade&apos;s required written approval
          and the applicable market-data rights. A proof does not verify
          investing performance, account completeness, a user&apos;s statements, or
          future results.
        </p>
        <p>
          Proof details are private by default. Account numbers,
          total balances, quantities, and dollar amounts are hidden by
          default, and paper accounts would be labeled as such. Publishing or
          attaching a proof would require an explicit user action. Never treat
          a proof as investment advice or a reason to copy another user&apos;s
          trade.
        </p>
      </>
    ),
  },
  {
    id: "plans",
    title: "Plans, trials, and advertising",
    content: (
      <>
        <p>
          Stock Radar may offer free, ad-free, and paid plans with different
          limits, alert timing, channels, filters, or features. Current plan
          details shown in the Service control access. Free access may display
          advertising; ad-free and paid access generally suppresses Stock Radar
          ad placements, although third-party content and links may still appear.
        </p>
        <p>
          Stock Radar&apos;s intended launch payment model is to use Paddle as the
          merchant of record, subject to completing the provider&apos;s onboarding
          and launch configuration. Paddle is not yet a live payment provider
          for the Service. The Advanced plan is intended to include a 14-day
          free trial that requires a payment card and converts to paid billing
          unless canceled before the trial ends. You may cancel during the
          trial. After paid conversion, fees are not ordinarily refunded on a
          pro-rata basis except where required by law, for duplicate charges,
          or for a material service failure.
        </p>
        <p>
          Prices, billing interval, taxes, trial conversion, cancellation
          timing, and the final checkout terms will be disclosed before a
          purchase is confirmed. Where payments are offered, the checkout terms
          form part of these Terms and apply alongside any mandatory consumer
          protection law.
        </p>
      </>
    ),
  },
  {
    id: "third-parties",
    title: "Third-party services and links",
    content: (
      <p>
        The Service relies on or links to data sources, publishers, identity
        providers, alert channels, hosting services, advertising providers,
        brokerage connectivity, and other third parties. Their content, terms,
        privacy practices, outages, and changes are outside Stock Radar&apos;s
        control. A link, badge, integration, or source label does not mean Stock
        Radar endorses or guarantees that third party.
      </p>
    ),
  },
  {
    id: "intellectual-property",
    title: "Intellectual property",
    content: (
      <>
        <p>
          The Service, excluding User Content and third-party material, is owned
          by Stock Radar or its licensors and is protected by applicable
          intellectual property laws. Subject to these Terms, you receive a
          limited, personal, non-exclusive, non-transferable, revocable right to
          use the Service for its intended purpose.
        </p>
        <p>
          You may not copy, scrape, bulk download, resell, sublicense, reverse
          engineer, or create a competing dataset or service from protected
          portions of the Service except where applicable law expressly permits
          it. You may not remove source notices or use Stock Radar&apos;s marks
          without permission.
        </p>
      </>
    ),
  },
  {
    id: "suspension-termination",
    title: "Suspension and termination",
    content: (
      <>
        <p>
          You may stop using the Service at any time. Stock Radar may suspend,
          restrict, or terminate access when reasonably necessary to address a
          Terms violation, security risk, abuse, legal requirement, unpaid
          charge, third-party service restriction, or material operational harm.
          Where practical, Stock Radar may give notice or an opportunity to
          address the issue.
        </p>
        <p>
          Provisions that by their nature should survive termination—including
          ownership, disclaimers, limitations, and obligations concerning prior
          conduct—will survive.
        </p>
      </>
    ),
  },
  {
    id: "disclaimers",
    title: "Disclaimers and limits",
    content: (
      <>
        <p>
          The Service is provided on an &ldquo;as is&rdquo; and &ldquo;as
          available&rdquo; basis. To the extent permitted by law, Stock Radar
          disclaims implied warranties of merchantability, fitness for a
          particular purpose, non-infringement, and uninterrupted or error-free
          operation. Stock Radar does not warrant that any alert will arrive
          before a market move or that any information or User Content is
          complete or correct.
        </p>
        <p>
          To the extent permitted by law, Stock Radar will not be liable for
          indirect, incidental, special, consequential, or punitive losses, or
          for trading losses, lost profits, lost data, or missed opportunities
          arising from use of or inability to use the Service. These Terms do
          not exclude or limit liability that cannot lawfully be excluded or
          limited, including liability arising from fraud or willful misconduct
          where applicable.
        </p>
      </>
    ),
  },
  {
    id: "changes",
    title: "Changes to the Service or Terms",
    content: (
      <p>
        Stock Radar may update the Service and these Terms. Material changes
        will be reflected by a revised date and, when reasonably appropriate,
        an in-product notice or other notice tied to your account. Continued use
        after revised Terms take effect means you accept them; if you do not,
        stop using the Service.
      </p>
    ),
  },
  {
    id: "governing-law",
    title: "Governing law and venue",
    content: (
      <p>
        These Terms are governed by the laws of the Republic of Korea. The
        Seoul Central District Court has exclusive jurisdiction over disputes
        arising from or relating to these Terms or the Service, except where
        mandatory law requires a different governing law or forum.
      </p>
    ),
  },
  {
    id: "contact",
    title: "Contact",
    content: (
      <>
        <p>{legalPolicyMeta.contactStatement}</p>
        <p>
          <strong>Operator:</strong> {legalPolicyMeta.operatorName},{" "}
          {legalPolicyMeta.operatorDescription}.<br />
          <strong>Business registration number:</strong>{" "}
          {legalPolicyMeta.businessRegistrationNumber}.<br />
          <strong>Business address:</strong> {legalPolicyMeta.businessAddress}.
        </p>
        <p>
          <strong>Support:</strong> {legalPolicyMeta.supportEmail}
          <br />
          <strong>Legal:</strong> {legalPolicyMeta.legalEmail}
          <br />
          <strong>Privacy:</strong> {legalPolicyMeta.privacyEmail}
        </p>
        <p>
          Privacy questions are addressed in the{" "}
          <Link href="/privacy">Privacy Policy</Link>. Content-specific concerns
          should use the report control attached to that content when available.
        </p>
      </>
    ),
  },
];

export default function TermsPage() {
  return (
    <StockRadarAppShell activeNavigationItem={null} themeMode="user-selectable">
      <LegalDocument
        description="These Terms explain the rules for using Stock Radar, including market tools, community features, optional verification, and plan access."
        documentTitle="Terms of Service"
        relatedHref="/privacy"
        relatedLabel="Read the Privacy Policy"
        sections={sections}
      />
    </StockRadarAppShell>
  );
}
