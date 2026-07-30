import type { Metadata } from "next";
import Link from "next/link";
import {
  LegalDocument,
  type LegalDocumentSection,
} from "@/components/legal/LegalDocument";
import { StockRadarAppShell } from "@/components/shell/StockRadarAppShell";
import { legalPolicyMeta } from "@/lib/legalPolicy";

export const metadata: Metadata = {
  title: "Privacy Policy | Stock Radar",
  description: "How Stock Radar collects, uses, shares, and retains data.",
};

const sections: LegalDocumentSection[] = [
  {
    id: "scope",
    title: "Scope",
    content: (
      <>
        <p>
          This Privacy Policy explains how Stock Radar collects, uses,
          discloses, and retains information when you use the websites,
          accounts, market tools, alerts, community features, and optional
          integrations that make up the Service. It does not control
          third-party sites or services that publish their own privacy terms.
        </p>
        <p>
          Stock Radar is operated by {legalPolicyMeta.operatorName},{" "}
          {legalPolicyMeta.operatorDescription}, with a business address at{" "}
          {legalPolicyMeta.businessAddress}. Its business registration number
          is {legalPolicyMeta.businessRegistrationNumber}.
        </p>
      </>
    ),
  },
  {
    id: "information-collected",
    title: "Information we collect",
    content: (
      <>
        <p>The categories collected depend on the features you use:</p>
        <ul>
          <li>
            <strong>Account and identity data:</strong> email address, account
            and OAuth identifiers, authentication state, and confirmation
            status.
          </li>
          <li>
            <strong>Profile and plan data:</strong> public profile identifier,
            display information, membership plan, trial or entitlement status,
            message and presence settings, and account preferences.
          </li>
          <li>
            <strong>Saved market preferences:</strong> watchlist tickers, alert
            tickers, categories, thresholds, schedules, delivery choices, and
            bookmarks.
          </li>
          <li>
            <strong>Delivery endpoints:</strong> Telegram account or chat
            identifiers and Web Push subscription endpoints and keys when you
            choose those channels, plus delivery status and attempt records.
          </li>
          <li>
            <strong>Community activity:</strong> posts, comments, room chat,
            direct messages, reactions, follows, memberships, invitations,
            reports, moderation records, and presence information when presence
            sharing is enabled.
          </li>
          <li>
            <strong>Social verification:</strong> submitted social profile URLs,
            proof text or tokens, review status, expiration, and reviewer notes.
          </li>
          <li>
            <strong>Device and usage data:</strong> IP-derived request data,
            browser and device details, timestamps, security and diagnostic
            logs, cookies, and localStorage settings such as theme or read
            position.
          </li>
          <li>
            <strong>Optional brokerage data:</strong> connection status,
            provider user identifiers and encrypted provider secrets, broker
            metadata, account type, proof candidates, consent records, selected
            proof fields, publication status, revocation, and verification
            timestamps when you choose to connect through SnapTrade.
          </li>
        </ul>
        <p>
          Stock Radar does not need your brokerage password. The current
          brokerage feature is not designed to store full account numbers or
          move money.
        </p>
      </>
    ),
  },
  {
    id: "sources",
    title: "Sources of information",
    content: (
      <p>
        We receive information directly from you; automatically from your
        browser, device, and use of the Service; from other users who interact
        with or report content; from authentication and delivery providers; from
        plan and entitlement records; and, when you authorize it, from social or
        brokerage connection providers. Market and company content also comes
        from public agencies, exchanges, publishers, and market-data providers
        and is generally not personal information about Service users.
      </p>
    ),
  },
  {
    id: "purposes",
    title: "How we use information",
    content: (
      <>
        <p>We use relevant information to:</p>
        <ul>
          <li>create, authenticate, secure, and administer accounts;</li>
          <li>
            provide watchlists, alerts, delivery, community, messaging,
            verification, and SnapTrade brokerage evidence;
          </li>
          <li>
            apply plan limits, trials, ad or ad-free behavior, and product
            settings;
          </li>
          <li>
            operate, diagnose, measure, protect, and improve the Service and its
            data quality;
          </li>
          <li>
            detect abuse, review reports, enforce rules, and preserve service
            integrity; and
          </li>
          <li>
            comply with applicable legal obligations and respond to valid
            requests.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "public-private",
    title: "Public and private information",
    content: (
      <>
        <p>
          Community posts, comments, room chat, chosen display information,
          reactions, and published verification or brokerage-proof fields may
          be visible to other users or the public as indicated in the Service.
          Content can be copied by others after publication.
        </p>
        <p>
          Email addresses, authentication identifiers, watchlists, alert
          settings, delivery endpoints, direct messages, reports, moderation
          notes, private social-verification materials, brokerage provider
          secrets, and unpublished proof details are not intended to be public.
          Presence is shared only according to the available setting, although
          aggregate or recent activity indicators may still be used to operate
          rooms.
        </p>
      </>
    ),
  },
  {
    id: "service-providers",
    title: "Service providers and disclosures",
    content: (
      <>
        <p>
          We disclose information only as relevant to operate a feature,
          maintain security, comply with law, or complete a transaction you
          request. Providers reflected in the current service architecture
          include:
        </p>
        <ul>
          <li>
            <strong>Supabase</strong> for database, authentication, and backend
            services, and <strong>Vercel</strong> for application hosting,
            delivery, and operational logs;
          </li>
          <li>
            <strong>Google</strong> for optional Google OAuth and advertising
            through AdSense on ad-supported access. AdSense may process cookies,
            device information, and IP-derived request data;
          </li>
          <li>
            <strong>FMP</strong> for market, company, and event data used in
            Stock Radar&apos;s market features;
          </li>
          <li>
            <strong>Telegram</strong> and browser push services when you choose
            those alert channels;
          </li>
          <li>
            <strong>SnapTrade</strong> and the connected broker when you
            voluntarily initiate a brokerage connection; and
          </li>
          <li>
            market-data, company-reference, news, regulatory, and other content
            providers needed for the market features you request.
          </li>
        </ul>
        <p>
          Providers do not all receive every category. The information sent
          depends on the feature and the provider&apos;s role. We may also
          disclose relevant information in response to valid legal process, to
          protect users or the Service, during a business reorganization subject
          to appropriate protections, or with your direction or consent.
        </p>
        <p>
          Stock Radar does not currently use Google Analytics. We will update
          this Policy before enabling a new analytics or advertising provider.
        </p>
      </>
    ),
  },
  {
    id: "snaptrade",
    title: "SnapTrade connection",
    content: (
      <>
        <p>
          Eligible Pro, Advanced, and Ultimate users may choose to connect a
          brokerage through SnapTrade. You must review and accept SnapTrade&apos;s
          end-user terms before opening its connection portal. SnapTrade and the
          connected institution process data under their own terms and consent
          flows. The connection is read-only: Stock Radar does not place orders,
          execute trades, hold assets, or move money.
        </p>
        <p>
          Provider secrets are stored in protected form and are not public.
          Account numbers, total balances, quantities, and dollar amounts are
          private by default, and paper accounts are labeled as such. A public
          proof requires an explicit user action and may show only selected
          holdings or execution fields in a server-generated card. Public proof
          and data-repackaging capabilities remain subject to SnapTrade&apos;s
          required written approval and applicable market-data rights. You can
          disconnect or revoke proofs through available controls, while limited
          records may remain for security, consent, moderation, or legal
          purposes.
        </p>
      </>
    ),
  },
  {
    id: "advertising",
    title: "Advertising and similar technologies",
    content: (
      <>
        <p>
          Ad-supported access may load advertising services such as Google
          AdSense. Advertising providers may process device, cookie, IP address,
          page, ad interaction, and usage information to deliver, measure, limit,
          or personalize ads, subject to applicable consent requirements,
          provider terms, and available browser or account settings.
        </p>
        <p>
          Stock Radar does not sell personal information for money. However,
          some privacy laws define &ldquo;sale&rdquo; or &ldquo;sharing&rdquo;
          broadly enough to cover certain advertising disclosures. Where such
          laws apply, relevant choices and rights will be provided as required;
          we do not characterize advertising as involving zero data sharing.
        </p>
        <p>
          Cookies and localStorage also support authentication, security, theme,
          preferences, read position, and other product functions. Blocking
          storage may affect those features.
        </p>
      </>
    ),
  },
  {
    id: "retention",
    title: "Retention",
    content: (
      <p>
        We retain account and preference data while an account is active and as
        needed to provide requested features. Delivery and diagnostic records
        are kept for operational troubleshooting and security; community,
        report, and moderation records may be kept to preserve conversations,
        enforce rules, prevent repeat abuse, or resolve disputes; verification
        and brokerage consent or proof records may be kept to document what was
        verified, published, revoked, or authorized. Retention may continue as
        necessary for backups, fraud prevention, legal obligations, or claims.
        When information is no longer reasonably needed for these purposes, it
        should be deleted or de-identified.
      </p>
    ),
  },
  {
    id: "security",
    title: "Security",
    content: (
      <p>
        We use administrative, technical, and access controls designed to
        protect information according to its sensitivity. Current safeguards
        include authenticated service boundaries, database access policies,
        protected server credentials, encryption of stored brokerage provider
        secrets, and transport encryption where supported. No system is
        completely secure, and we cannot guarantee that unauthorized access,
        loss, or misuse will never occur.
      </p>
    ),
  },
  {
    id: "choices-rights",
    title: "Choices and privacy rights",
    content: (
      <>
        <p>
          Available controls let you update some account and message settings,
          edit watchlists and alerts, disable delivery channels, change presence
          sharing, manage social-verification submissions, disconnect an
          available brokerage integration, revoke proofs, and delete your own
          content where the product offers that action.
        </p>
        <p>
          Depending on where you live and whether a law applies to Stock Radar,
          you may have rights to request access, correction, deletion,
          portability, restriction, or information about disclosures, and to
          object to or opt out of certain processing. California residents may
          have rights to know, delete, correct, opt out of sale or sharing, limit
          certain uses of sensitive information, and receive
          non-discriminatory treatment if the CCPA applies.
        </p>
        <p>
          Requests are subject to identity verification and applicable
          exceptions. Some information may be retained for security, consent
          evidence, moderation, legal compliance, transaction records, or the
          rights of others. Use the contact route in Section 15 to submit a
          request; we will handle it under applicable law rather than promising
          a deletion function that the product does not currently provide.
        </p>
      </>
    ),
  },
  {
    id: "children",
    title: "Children",
    content: (
      <p>
        The Service is for adults age 18 and older. It is not directed to
        children, and we do not knowingly offer accounts to anyone under 18. If
        you believe a person under 18 has provided personal information, use the
        contact route below.
      </p>
    ),
  },
  {
    id: "international",
    title: "International processing",
    content: (
      <p>
        Stock Radar and its providers may process information in countries other
        than the one where you live. Privacy protections and government access
        rules may differ across those locations. Where applicable law requires
        a transfer mechanism or additional safeguard, it will be applied by the
        responsible operator or provider as appropriate.
      </p>
    ),
  },
  {
    id: "changes",
    title: "Changes to this Policy",
    content: (
      <p>
        We may update this Policy as the Service, providers, or legal
        requirements change. The updated date will identify the current version.
        Material changes may also be presented through the Service or an
        account-related notice when reasonably appropriate.
      </p>
    ),
  },
  {
    id: "contact",
    title: "Contact and requests",
    content: (
      <>
        <p>{legalPolicyMeta.contactStatement}</p>
        <p>
          <strong>Privacy Officer:</strong> {legalPolicyMeta.privacyOfficerName}{" "}
          ({legalPolicyMeta.privacyOfficerTitle})
          <br />
          <strong>Privacy:</strong> {legalPolicyMeta.privacyEmail}
          <br />
          <strong>Support:</strong> {legalPolicyMeta.supportEmail}
          <br />
          <strong>Legal:</strong> {legalPolicyMeta.legalEmail}
        </p>
        <p>
          For a report about specific community content, use its in-product
          report control when available. For account-related requests, sign in
          before using the available account or support route so the request can
          be verified. See the <Link href="/terms">Terms of Service</Link> for
          rules governing the Service.
        </p>
      </>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <StockRadarAppShell activeNavigationItem={null} themeMode="user-selectable">
      <LegalDocument
        description="This Policy describes the data Stock Radar handles, why it is used, when providers receive it, and the choices available to you."
        documentTitle="Privacy Policy"
        relatedHref="/terms"
        relatedLabel="Read the Terms of Service"
        sections={sections}
      />
    </StockRadarAppShell>
  );
}
