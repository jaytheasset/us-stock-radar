import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { PriceChartCard } from "@/app/events/[id]/PriceChartCard";
import { SectorThemeContextPanel } from "@/app/events/[id]/SectorThemeContextPanel";
import { SecFilingHtmlViewer } from "@/app/filings/SecFilingHtmlViewer";
import type {
  ContextRange,
  DetailTone,
  PriceChartSeries,
  PricePoint,
  SectorThemeContext,
  TopMover,
} from "@/app/events/[id]/detailTypes";
import { getDirectionalScoreTone } from "@/lib/directionalScore";
import { getEventTypeBadge } from "@/lib/eventTypeRegistry";
import { getLiveEventDetail, type LiveFeedItem } from "@/lib/liveFeed";
import { readMarketGroupSnapshotCache, type MarketGroupSnapshotPayload } from "@/lib/marketDataCache";
import { fetchEventAnalysis, fetchEventById, supabaseSelect } from "@/lib/supabase";
import { sectorMappings } from "@/lib/taxonomyRegistry";

type FilingArchiveDetailPageProps = {
  params: Promise<{ id: string }>;
};

type ArchiveFilingEvent = {
  id: string;
  ticker: string;
  exchange: string;
  company: string;
  title: string;
  source: string;
  sourceUrl: string;
  primaryDocumentUrl: string;
  publishedAt: string;
  formType: string;
  accessionNumber: string;
  cik: string;
  score: number;
  signal: DetailTone;
  eventType: string;
  price: string;
  changeAmount: string;
  change: string;
  priceSeries: PriceChartSeries | null;
  briefSummary: string;
  archiveReason: string;
  keyEvidence: string[];
  originalHtml: string;
  sourceAvailabilityNote: string;
  documents: FilingDocumentInventoryItem[];
  attachmentSnippets: FilingAttachmentSnippet[];
  marketContext: SectorThemeContext | null;
  displayPayloadType: string;
  proxyProposals: ArchiveProxyProposalItem[];
};

type ArchiveProxyProposalItem = {
  id: string;
  title: string;
  category: string;
  recommendation: string;
  isShareholderProposal: boolean;
};

type FilingDocumentInventoryItem = {
  label: string;
  type: string;
  description: string;
  url: string;
  size: string;
  textStatus: string;
  isPrimary: boolean;
};

type FilingAttachmentSnippet = {
  label: string;
  url: string;
  text: string;
};

type TickerProfile = {
  symbol: string;
  name: string;
  exchange: string;
  fmpSector: string;
  fmpIndustry: string;
  marketCap: number;
};

type ContextSnapshotMap = Record<ContextRange, MarketGroupSnapshotPayload[]>;

const ARCHIVE_SUMMARY_SUFFIX =
  "Limited market impact detected. The original source is included below for reference.";

export const dynamic = "force-dynamic";

export default async function FilingArchiveDetailPage({ params }: FilingArchiveDetailPageProps) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  if (!(await shouldUseCompactArchiveRoute(id))) {
    redirect(`/filings/${id}`);
  }

  const archiveEvent = await loadArchiveFilingEvent(id);
  if (!archiveEvent) notFound();
  const sourceLink = archiveEvent.sourceUrl || archiveEvent.primaryDocumentUrl;

  return (
    <main className="feed-page stock-detail-page archive-detail-page filing-archive-detail-page">
      <header className="feed-nav">
        <Link className="brand-lockup" href="/" aria-label="US Stock Radar home">
          <span className="brand-mark">SR</span>
          <span>STOCK RADAR</span>
        </Link>
        <nav className="feed-nav-links" aria-label="Primary">
          {[
            { label: "Live Feed", href: "/feed" },
            { label: "Watchlist", href: "/watchlist" },
            { label: "News", href: "/news" },
            { label: "Filings", href: "/filings" },
            { label: "Alerts", href: "#" },
            { label: "Premium", href: "#" },
          ].map((item) => (
            <Link className={item.label === "Filings" ? "active" : ""} href={item.href} key={item.label}>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="feed-search" role="search">
          <span aria-hidden="true">/</span>
          <input aria-label="Search" placeholder="Search tickers, companies, or keywords" />
        </div>
        <div className="feed-actions">
          <button className="icon-button" type="button" aria-label="Notifications">
            <span aria-hidden="true">!</span>
            <span className="notification-dot">3</span>
          </button>
          <button className="avatar-button" type="button" aria-label="User menu">
            N
          </button>
        </div>
      </header>

      <div className="stock-detail-shell">
        <article className="stock-detail-main">
          <div className="stock-detail-kicker-row">
            <div className="stock-detail-breadcrumb">
              <Link href="/filings">Filings</Link>
              <span>/</span>
              <span>Archive</span>
            </div>
            <div className="stock-detail-source-line">
              <span>SEC Filing</span>
              <span>Filed {archiveEvent.publishedAt}</span>
            </div>
          </div>

          <section className="stock-detail-hero archive-detail-hero">
            <div className="stock-detail-title-block">
              <h1>{archiveEvent.title}</h1>
              <div className="stock-detail-meta">
                <span className="ticker-chip">
                  {archiveEvent.exchange}:{archiveEvent.ticker}
                </span>
                <span>{archiveEvent.company}</span>
                <span className="filing-form-pill">{archiveEvent.formType}</span>
                <span className="delivery-badge archive">Archive</span>
                <span className={`source-badge impact-badge ${archiveEvent.signal}`}>
                  Impact{" "}
                  <span data-score-tone={getDirectionalScoreTone(archiveEvent.score, archiveEvent.signal)}>
                    {archiveEvent.score}
                  </span>
                </span>
              </div>
            </div>
          </section>

          {archiveEvent.priceSeries ? (
            <section className="stock-detail-top-grid">
              <PriceChartCard
                change={archiveEvent.change}
                changeAmount={archiveEvent.changeAmount}
                price={archiveEvent.price}
                series={archiveEvent.priceSeries}
                ticker={archiveEvent.ticker}
                tone={archiveEvent.signal}
              />

              <section className="stock-detail-card archive-notice-panel">
                <div>
                  <h2>Brief Summary</h2>
                  <p>{archiveEvent.briefSummary}</p>
                </div>
              </section>
            </section>
          ) : (
            <section className="stock-detail-card archive-notice-panel">
              <div>
                <h2>Brief Summary</h2>
                <p>{archiveEvent.briefSummary}</p>
              </div>
            </section>
          )}

          {archiveEvent.marketContext ? (
            <SectorThemeContextPanel context={archiveEvent.marketContext} ticker={archiveEvent.ticker} />
          ) : null}

          {archiveEvent.proxyProposals.length ? <ArchiveProxyProposalAgenda proposals={archiveEvent.proxyProposals} /> : null}

          <section className="stock-detail-card full-text-card archive-original-section">
            <div className="card-heading-row">
              <div>
                <h2>Original Filing Text / Source Text</h2>
                <p>{archiveEvent.sourceAvailabilityNote}</p>
              </div>
              {sourceLink ? (
                <a href={sourceLink} target="_blank" rel="noreferrer">
                  View SEC Filing <ExternalLink size={14} aria-hidden="true" />
                </a>
              ) : null}
            </div>
            {archiveEvent.originalHtml ? (
              <SecFilingHtmlViewer
                html={archiveEvent.originalHtml}
                sourceUrl={archiveEvent.primaryDocumentUrl || archiveEvent.sourceUrl}
                title={`${archiveEvent.formType} original SEC filing`}
              />
            ) : (
              <SecFilingHtmlViewer html="" />
            )}
          </section>

          {archiveEvent.attachmentSnippets.length ? (
            <section className="stock-detail-card full-text-card archive-original-section">
              <div className="card-heading-row">
                <div>
                  <h2>Selected Attachment Snippets</h2>
                  <p>Available attachment text preserved from the SEC raw item.</p>
                </div>
              </div>
              <div className="full-text-content filing-text-content">
                {archiveEvent.attachmentSnippets.map((snippet) => (
                  <section key={`${snippet.label}-${snippet.url}`}>
                    <h3>{snippet.label}</h3>
                    <p>{snippet.text}</p>
                    {snippet.url ? (
                      <p>
                        <a href={snippet.url} target="_blank" rel="noreferrer">
                          Open attachment
                        </a>
                      </p>
                    ) : null}
                  </section>
                ))}
              </div>
            </section>
          ) : null}

          {archiveEvent.documents.length ? (
            <section className="stock-detail-card full-text-card filing-original-card">
              <div className="card-heading-row">
                <div>
                  <h2>Attachment / Source Inventory</h2>
                  <p>Documents captured from the SEC filing detail page.</p>
                </div>
              </div>
              <div className="full-text-content filing-text-content filing-template-table">
                <table>
                  <thead>
                    <tr>
                      <th>Document</th>
                      <th>Type</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {archiveEvent.documents.map((document) => (
                      <tr key={`${document.label}-${document.url}`}>
                        <td>
                          {document.url ? (
                            <a href={document.url} target="_blank" rel="noreferrer">
                              {document.label}
                            </a>
                          ) : (
                            document.label
                          )}
                          {document.isPrimary ? " (primary)" : ""}
                          {document.description ? <small>{document.description}</small> : null}
                        </td>
                        <td>{document.type || "SEC document"}</td>
                        <td>{document.textStatus}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </article>

        <aside className="stock-detail-rail">
          <section className="stock-detail-card detail-score-card">
            <h2>Filing Snapshot</h2>
            <div className="detail-score-main">
              <strong data-score-tone={getDirectionalScoreTone(archiveEvent.score, archiveEvent.signal)}>
                {archiveEvent.score}
              </strong>
              <span>Impact</span>
            </div>
            <MetricRow label="Source Group" value="filings" />
            <MetricRow label="Source Type" value="SEC Filing" />
            <MetricRow label="Event Type" value={archiveEvent.eventType} />
            <MetricRow label="Form Type" value={archiveEvent.formType} />
          </section>

          <section className="stock-detail-card source-confidence-card">
            <h2>Source & Evidence</h2>
            <div className="source-confidence-top">
              <strong>{archiveEvent.source}</strong>
              <span>Official Filing</span>
            </div>
            <MetricRow label="Issuer" value={archiveEvent.company} />
            <MetricRow label="Filed" value={archiveEvent.publishedAt} />
            {archiveEvent.accessionNumber ? <MetricRow label="Accession" value={archiveEvent.accessionNumber} /> : null}
            {archiveEvent.cik ? <MetricRow label="CIK" value={archiveEvent.cik} /> : null}
            <MetricRow label="Display Payload" value={archiveEvent.displayPayloadType || "none"} />
            {sourceLink ? (
              <a className="source-original-link" href={sourceLink} target="_blank" rel="noreferrer">
                <span>View Original Filing</span>
                <ExternalLink size={14} aria-hidden="true" />
              </a>
            ) : (
              <MetricRow label="Source Link" value="Unavailable" />
            )}
            {archiveEvent.primaryDocumentUrl && archiveEvent.primaryDocumentUrl !== archiveEvent.sourceUrl ? (
              <a className="source-original-link" href={archiveEvent.primaryDocumentUrl} target="_blank" rel="noreferrer">
                <span>View Primary Document</span>
                <ExternalLink size={14} aria-hidden="true" />
              </a>
            ) : null}
          </section>

          {archiveEvent.archiveReason ? (
            <section className="stock-detail-card summary-card">
              <h2>Archive Reason</h2>
              <p>{archiveEvent.archiveReason}</p>
            </section>
          ) : null}

          {archiveEvent.keyEvidence.length ? (
            <section className="stock-detail-card summary-card">
              <h2>Key Evidence</h2>
              <ul>
                {archiveEvent.keyEvidence.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          ) : null}
        </aside>
      </div>
    </main>
  );
}

async function shouldUseCompactArchiveRoute(eventId: string) {
  const result = await fetchEventById(eventId);
  const eventRow = toRecord(result.data);
  if (!eventRow) return true;

  const deliveryLevel = readString(eventRow, "delivery_level");
  if (deliveryLevel && deliveryLevel !== "archive") return false;

  const metadata = toRecord(eventRow.metadata);
  const archiveRoute = readString(metadata, "archive_route");
  if (archiveRoute === "common_filing_detail") return false;
  if (archiveRoute === "compact_archive") return true;

  const runtimeSource = readString(metadata, "analysis_runtime_source");
  if (runtimeSource === "llm") return false;
  if (runtimeSource === "parser_deterministic") return true;

  return !readString(metadata, "openai_response_id");
}

async function loadArchiveFilingEvent(id: string): Promise<ArchiveFilingEvent | null> {
  const [eventResult, analysisResult, liveResult] = await Promise.all([
    fetchEventById(id),
    fetchEventAnalysis(id),
    getLiveEventDetail(id),
  ]);
  const eventRow = toRecord(eventResult.data);

  if (!eventRow || readString(eventRow, "source_group") !== "filings" || readString(eventRow, "delivery_level") !== "archive") {
    return null;
  }

  const rawItem = await loadRawItem(readString(eventRow, "raw_item_id"));
  const analysis = toRecord(analysisResult.data);
  return mapArchiveFilingEvent(eventRow, analysis, rawItem, liveResult.item);
}

async function loadRawItem(rawItemId: string) {
  if (!isUuid(rawItemId)) return null;

  const result = await supabaseSelect("raw_items", {
    select: "*",
    id: `eq.${rawItemId}`,
    limit: "1",
  });

  return toRows(result.data)[0] || null;
}

async function mapArchiveFilingEvent(
  eventRow: Record<string, unknown>,
  analysis: Record<string, unknown> | null,
  rawItem: Record<string, unknown> | null,
  liveItem: LiveFeedItem | null,
): Promise<ArchiveFilingEvent> {
  const metadata = toRecord(eventRow.metadata);
  const rawPayload = toRecord(rawItem?.raw_payload);
  const displayPayload = toRecord(metadata?.display_payload);
  const displayPayloadData = toRecord(displayPayload?.data);
  const ticker = (readString(eventRow, "ticker") || readString(rawPayload, "ticker") || "N/A").trim().toUpperCase();
  const formType = readString(metadata, "form_type") || readString(rawPayload, "form_type") || "SEC";
  const sourceUrl =
    readString(eventRow, "source_url") ||
    readString(rawItem, "source_url") ||
    readString(rawPayload, "detail_url") ||
    readString(rawPayload, "primary_document_url");
  const primaryDocumentUrl = readPrimaryDocumentUrl(rawPayload, metadata, sourceUrl);
  const originalHtml = await readOriginalHtml(rawItem, rawPayload, primaryDocumentUrl);
  const score = liveItem?.score || readNumber(eventRow, "score");
  const signal = liveItem?.signal || readSignal(eventRow);
  const price = liveItem?.price || "$0.00";
  const changeAmount = liveItem?.changeAmount || "$0.00";
  const change = liveItem?.change || "+0.00%";
  const lastClose = parseSignedNumber(price) || 1;
  const signedChangeAmount = parseSignedNumber(changeAmount);
  const previousClose = Number.isFinite(signedChangeAmount) ? Math.max(0.01, lastClose - signedChangeAmount) : lastClose;
  const tickerProfile = await loadTickerProfile(ticker);
  const marketContext = await buildArchiveMarketContext(eventRow, liveItem, tickerProfile);

  return {
    id: readString(eventRow, "id"),
    ticker,
    exchange: readString(eventRow, "market") || readString(rawPayload, "exchange") || tickerProfile?.exchange || "US",
    company:
      readString(metadata, "issuer") ||
      readString(metadata, "company_name") ||
      readString(rawPayload, "company_name") ||
      (ticker !== "N/A" ? ticker : "SEC issuer"),
    title: readString(eventRow, "title") || "Archived SEC filing",
    source: readString(eventRow, "source_name") || "SEC EDGAR",
    sourceUrl,
    primaryDocumentUrl,
    publishedAt: formatSecFilingDateTime(
      readString(eventRow, "published_at") || readString(eventRow, "detected_at"),
      rawPayload,
    ),
    formType,
    accessionNumber: readString(metadata, "accession_number") || readString(rawPayload, "accession_number"),
    cik: readString(metadata, "cik") || readString(rawPayload, "cik"),
    score,
    signal,
    eventType: getEventTypeBadge(readString(eventRow, "event_type") || "other").label,
    price,
    changeAmount,
    change,
    priceSeries: isRealTicker(ticker)
      ? buildPriceSeries({
          lastClose,
          previousClose,
          trend: liveItem?.trend.length ? liveItem.trend : [40, 41, 42, 43, 44, 45],
          volumeBase: 1_000_000,
        })
      : null,
    briefSummary: buildArchiveBriefSummary({
      filingSummary: readString(displayPayloadData, "filing_summary"),
      fallback:
        readString(metadata, "archive_summary") ||
        readString(eventRow, "quick_take") ||
        readString(eventRow, "summary"),
    }),
    archiveReason: readString(eventRow, "reason") || readString(metadata, "score_reason"),
    keyEvidence: stringArray(analysis?.key_evidence),
    originalHtml,
    sourceAvailabilityNote: originalHtml
      ? "SEC filing source text preserved from the raw item store."
      : "Full source text is unavailable; use the original SEC filing link for source review.",
    documents: mapDocumentInventory(rawPayload),
    attachmentSnippets: mapAttachmentSnippets(rawPayload),
    marketContext,
    displayPayloadType: readString(displayPayload, "display_type"),
    proxyProposals: buildArchiveProxyProposals(displayPayloadData),
  };
}

function ArchiveProxyProposalAgenda({ proposals }: { proposals: ArchiveProxyProposalItem[] }) {
  return (
    <section className="stock-detail-card proxy-agenda-card">
      <div className="card-heading-row">
        <h2>Proposal Agenda</h2>
        <span>{proposals.length} proposals</span>
      </div>
      <div className="proxy-agenda-table">
        <div className="proxy-agenda-row proxy-agenda-header">
          <span>No.</span>
          <span>Proposal</span>
          <span>Type</span>
          <span>Board recommends</span>
        </div>
        {proposals.map((proposal) => (
          <div className="proxy-agenda-row" key={`${proposal.id}-${proposal.title}`}>
            <span>{proposal.id}</span>
            <strong>{proposal.title}</strong>
            <span>
              {proposal.category || "Not disclosed"}
              {proposal.isShareholderProposal ? " · shareholder" : ""}
            </span>
            <span>{proposal.recommendation || "Not disclosed"}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function buildArchiveProxyProposals(data: Record<string, unknown> | null): ArchiveProxyProposalItem[] {
  return recordArray(data?.proposals)
    .map((proposal, index) => {
      const title = formatArchiveProxyProposalTitle(readString(proposal, "title"));
      if (!title) return null;
      return {
        id: readString(proposal, "id") || `Proposal ${index + 1}`,
        title,
        category: formatArchiveProxyProposalCategory(readString(proposal, "category")) || "Not disclosed",
        recommendation: formatArchiveProxyBoardRecommendation(readString(proposal, "recommendation")) || "Not disclosed",
        isShareholderProposal: Boolean(proposal.is_shareholder_proposal),
      };
    })
    .filter((proposal): proposal is ArchiveProxyProposalItem => Boolean(proposal));
}

function formatArchiveProxyProposalTitle(value: string) {
  const title = value.replace(/\s+/g, " ").trim();
  if (!title) return "";
  if (isMostlyUppercaseArchiveProxyTitle(title)) return toArchiveProxyProposalTitleCase(title);
  return normalizeArchiveProxyProposalKnownTerms(title);
}

const ARCHIVE_PROXY_PROPOSAL_SMALL_TITLE_WORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "by",
  "for",
  "from",
  "in",
  "into",
  "of",
  "on",
  "or",
  "per",
  "the",
  "to",
  "via",
  "with",
]);

const ARCHIVE_PROXY_PROPOSAL_ACRONYMS = new Set([
  "ADR",
  "ADS",
  "CEO",
  "CFO",
  "COO",
  "ESG",
  "GAAP",
  "IPO",
  "LLC",
  "LLP",
  "LP",
  "NASDAQ",
  "NOL",
  "NYSE",
  "PLC",
  "PSU",
  "RSU",
  "SEC",
  "SPAC",
]);

function isMostlyUppercaseArchiveProxyTitle(value: string) {
  const letters = value.replace(/[^A-Za-z]/g, "");
  return Boolean(letters) && letters === letters.toUpperCase();
}

function toArchiveProxyProposalTitleCase(value: string) {
  let wordIndex = 0;
  const formatted = value.toLowerCase().replace(/[a-z0-9]+(?:['\u2019][a-z0-9]+)?(?:-[a-z0-9]+(?:['\u2019][a-z0-9]+)?)*/g, (word) => {
    const result = formatArchiveProxyProposalTitleWord(word, wordIndex);
    wordIndex += 1;
    return result;
  });
  return normalizeArchiveProxyProposalKnownTerms(formatted);
}

function formatArchiveProxyProposalTitleWord(word: string, wordIndex: number) {
  if (/^say-on-pay$/i.test(word)) return "Say-on-Pay";
  return word
    .split("-")
    .map((part, partIndex) => formatArchiveProxyProposalTitlePart(part, wordIndex === 0 && partIndex === 0))
    .join("-");
}

function formatArchiveProxyProposalTitlePart(part: string, isFirst: boolean): string {
  const possessive = part.match(/^([a-z0-9]+)(['\u2019])s$/i);
  if (possessive) {
    const mark = possessive[2] === "\u2019" ? "\u2019" : "'";
    return `${formatArchiveProxyProposalTitlePart(possessive[1], isFirst)}${mark}s`;
  }
  if (/^\d+$/.test(part)) return part;
  const acronym = part.toUpperCase();
  if (ARCHIVE_PROXY_PROPOSAL_ACRONYMS.has(acronym)) return acronym;
  if (!isFirst && ARCHIVE_PROXY_PROPOSAL_SMALL_TITLE_WORDS.has(part)) return part;
  return part.charAt(0).toUpperCase() + part.slice(1);
}

function normalizeArchiveProxyProposalKnownTerms(value: string) {
  return value
    .replace(/\bSay-On-Pay\b/gi, "Say-on-Pay")
    .replace(/\bLlc\b/g, "LLC")
    .replace(/\bLlp\b/g, "LLP")
    .replace(/\bLp\b/g, "LP")
    .replace(/\bPlc\b/g, "PLC")
    .replace(/([A-Za-z])\u2019S\b/g, "$1\u2019s")
    .replace(/([A-Za-z])'S\b/g, "$1's");
}

function formatArchiveProxyProposalCategory(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim().toLowerCase();
  if (!normalized) return "";
  if (/say[-\s]?on[-\s]?pay|executive compensation|compensation/.test(normalized)) return "Executive pay vote";
  if (/auditor|accounting firm|ratification/.test(normalized)) return "Auditor approval";
  if (/director/.test(normalized)) return "Director election";
  return value.replace(/\s+/g, " ").trim();
}

function formatArchiveProxyBoardRecommendation(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (/^for$/i.test(normalized)) return "Support";
  if (/^against$/i.test(normalized)) return "Oppose";
  if (/^withhold$/i.test(normalized)) return "Withhold";
  if (/^abstain$/i.test(normalized)) return "Abstain";
  return normalized;
}

async function loadTickerProfile(ticker: string): Promise<TickerProfile | null> {
  if (!isRealTicker(ticker)) return null;

  const result = await supabaseSelect("tickers", {
    select: "symbol,name,exchange,fmp_sector,fmp_industry,market_cap,is_active",
    symbol: `eq.${ticker}`,
    limit: "1",
  });
  const row = toRows(result.data)[0] || null;
  if (!row) return null;

  return {
    symbol: readString(row, "symbol"),
    name: readString(row, "name"),
    exchange: readString(row, "exchange"),
    fmpSector: readString(row, "fmp_sector"),
    fmpIndustry: readString(row, "fmp_industry"),
    marketCap: readNumber(row, "market_cap"),
  };
}

async function buildArchiveMarketContext(
  eventRow: Record<string, unknown>,
  liveItem: LiveFeedItem | null,
  tickerProfile: TickerProfile | null,
): Promise<SectorThemeContext | null> {
  const metadata = toRecord(eventRow.metadata);
  const ticker = (readString(eventRow, "ticker") || tickerProfile?.symbol || "").trim().toUpperCase();
  if (!isRealTicker(ticker) || !tickerProfile) return null;

  const storedMarketContext = toRecord(metadata?.market_context);
  const storedContextSymbol = (
    readString(storedMarketContext, "symbol") ||
    readString(storedMarketContext, "ticker") ||
    ticker
  ).toUpperCase();
  if (storedContextSymbol && storedContextSymbol !== ticker) return null;

  const mappedIndustry = findSectorMapping(tickerProfile?.fmpIndustry || "");
  const sector = cleanContextValue(
    readString(eventRow, "sector") ||
      readString(metadata, "sector") ||
      readString(metadata, "sector_name") ||
      mappedIndustry?.sector ||
      tickerProfile?.fmpSector ||
      "",
  );
  const industry = cleanContextValue(
      readString(eventRow, "industry_group") ||
      readString(metadata, "industry_group") ||
      readString(metadata, "industry") ||
      readString(metadata, "industry_name") ||
      mappedIndustry?.subCategory ||
      tickerProfile?.fmpIndustry ||
      "",
  );
  const themeGroup = cleanContextValue(readString(eventRow, "theme_group") || readString(metadata, "theme_group") || readString(metadata, "theme"));
  const subTheme = cleanContextValue(readString(eventRow, "sub_theme") || readString(metadata, "sub_theme"));

  if (!sector && !industry && !themeGroup && !subTheme) return null;

  const snapshots = await readArchiveContextSnapshots();
  const score = liveItem?.score || readNumber(eventRow, "score");
  const signal = liveItem?.signal || readSignal(eventRow);
  const fallbackTrend = liveItem?.trend.length ? liveItem.trend : buildContextTrend(signal, 0, "1D");
  const moverMode = resolveArchiveMoverMode({ industry, snapshots, subTheme, themeGroup });
  const moverGroupName = resolveArchiveMoverGroupName({ industry, moverMode, sector, subTheme, themeGroup });
  const marketCap = tickerProfile?.marketCap ? formatMarketCap(tickerProfile.marketCap) : "";

  return {
    contextTitle: ticker || subTheme || themeGroup || industry || sector || "Market",
    industry: industry || sector || "Market",
    marketCap: themeGroup || subTheme ? undefined : marketCap || undefined,
    moverGroupName,
    moverMode,
    periods: {
      "1D": buildArchiveContextPeriod({
        fallbackTrend,
        industry,
        primaryChange: liveItem?.change || "+0.00%",
        range: "1D",
        score,
        sector,
        signal,
        snapshots: snapshots["1D"],
        subTheme,
        themeGroup,
        ticker,
      }),
      "5D": buildArchiveContextPeriod({
        fallbackTrend,
        industry,
        primaryChange: liveItem?.change || "+0.00%",
        range: "5D",
        score,
        sector,
        signal,
        snapshots: snapshots["5D"],
        subTheme,
        themeGroup,
        ticker,
      }),
      "30D": buildArchiveContextPeriod({
        fallbackTrend,
        industry,
        primaryChange: liveItem?.change || "+0.00%",
        range: "30D",
        score,
        sector,
        signal,
        snapshots: snapshots["30D"],
        subTheme,
        themeGroup,
        ticker,
      }),
    },
    sector: sector || "Market",
    ...(themeGroup ? { themeGroup } : {}),
    ...(subTheme ? { subTheme } : {}),
  };
}

async function readArchiveContextSnapshots(): Promise<ContextSnapshotMap> {
  const [oneDay, fiveDay, oneMonth] = await Promise.all([
    readMarketGroupSnapshotCache("1D"),
    readMarketGroupSnapshotCache("5D"),
    readMarketGroupSnapshotCache("1M"),
  ]);

  return {
    "1D": oneDay.snapshots,
    "5D": fiveDay.snapshots,
    "30D": oneMonth.snapshots,
  };
}

function buildArchiveContextPeriod({
  fallbackTrend,
  industry,
  primaryChange,
  range,
  score,
  sector,
  signal,
  snapshots,
  subTheme,
  themeGroup,
  ticker,
}: {
  fallbackTrend: number[];
  industry: string;
  primaryChange: string;
  range: ContextRange;
  score: number;
  sector: string;
  signal: DetailTone;
  snapshots: MarketGroupSnapshotPayload[];
  subTheme: string;
  themeGroup: string;
  ticker: string;
}): SectorThemeContext["periods"][ContextRange] {
  const sectorSnapshot = findGroupSnapshot(snapshots, "sector", sector);
  const industrySnapshot = findGroupSnapshot(snapshots, "industry_group", industry);
  const themeSnapshot = findGroupSnapshot(snapshots, "theme", themeGroup);
  const subThemeSnapshot = findGroupSnapshot(snapshots, "sub_theme", subTheme);
  const selectedSnapshot = subThemeSnapshot || themeSnapshot || industrySnapshot || sectorSnapshot;
  const topMovers = buildSnapshotTopMovers(selectedSnapshot, signal);

  return {
    industryChange: formatSnapshotChange(industrySnapshot?.changePercent),
    sectorChange: formatSnapshotChange(sectorSnapshot?.changePercent),
    subThemeChange: formatSnapshotChange(subThemeSnapshot?.changePercent),
    themeChange: formatSnapshotChange(themeSnapshot?.changePercent),
    themeScore: score,
    themeSignal: signal,
    topMovers: topMovers.length
      ? topMovers
      : buildFallbackTopMovers({
          fallbackTrend,
          primaryChange,
          range,
          signal,
          ticker,
        }),
  };
}

function resolveArchiveMoverMode({
  industry,
  snapshots,
  subTheme,
  themeGroup,
}: {
  industry: string;
  snapshots: ContextSnapshotMap;
  subTheme: string;
  themeGroup: string;
}): SectorThemeContext["moverMode"] {
  if (subTheme && hasSnapshotTopMovers(snapshots, "sub_theme", subTheme)) return "top_movers";
  if (themeGroup && hasSnapshotTopMovers(snapshots, "theme", themeGroup)) return "top_movers";
  if (industry && hasSnapshotTopMovers(snapshots, "industry_group", industry)) return "top_movers";
  return "market_top_movers";
}

function resolveArchiveMoverGroupName({
  industry,
  moverMode,
  sector,
  subTheme,
  themeGroup,
}: {
  industry: string;
  moverMode: SectorThemeContext["moverMode"];
  sector: string;
  subTheme: string;
  themeGroup: string;
}) {
  if (moverMode === "market_top_movers") return "Market";
  return subTheme || themeGroup || industry || sector || "Market";
}

function hasSnapshotTopMovers(
  snapshots: ContextSnapshotMap,
  scope: MarketGroupSnapshotPayload["scope"],
  label: string,
) {
  return Object.values(snapshots).some((items) => Boolean(findGroupSnapshot(items, scope, label)?.topMovers.length));
}

function findGroupSnapshot(
  snapshots: MarketGroupSnapshotPayload[],
  scope: MarketGroupSnapshotPayload["scope"],
  label: string,
) {
  if (!label) return undefined;
  const normalizedLabel = normalizeGroupLabel(label);

  return snapshots.find(
    (snapshot) =>
      snapshot.scope === scope &&
      (normalizeGroupLabel(snapshot.groupName) === normalizedLabel ||
        normalizeGroupLabel(snapshot.groupKey) === normalizedLabel),
  );
}

function buildSnapshotTopMovers(snapshot: MarketGroupSnapshotPayload | undefined, tone: DetailTone): TopMover[] {
  if (!snapshot?.topMovers.length) return [];

  return snapshot.topMovers
    .map((mover, index) => ({
      change: formatSignedPercent(mover.changePercent),
      symbol: mover.symbol.toUpperCase(),
      trend: snapshot.trendPoints.length
        ? offsetTrend(snapshot.trendPoints, index)
        : buildContextTrend(tone, index, "1D"),
    }))
    .filter((mover) => isArchiveSectorMoverSymbol(mover.symbol))
    .slice(0, 6);
}

function buildFallbackTopMovers({
  fallbackTrend,
  primaryChange,
  range,
  signal,
  ticker,
}: {
  fallbackTrend: number[];
  primaryChange: string;
  range: ContextRange;
  signal: DetailTone;
  ticker: string;
}): TopMover[] {
  return [
    { change: primaryChange, symbol: ticker, trend: fallbackTrend.length ? fallbackTrend : buildContextTrend(signal, 0, range) },
  ].filter((mover) => isArchiveSectorMoverSymbol(mover.symbol));
}

function isArchiveSectorMoverSymbol(symbol: string) {
  return isRealTicker(symbol) && !["SPY", "QQQ", "DIA", "IWM"].includes(symbol.toUpperCase());
}

function findSectorMapping(fmpIndustry: string) {
  const normalizedIndustry = normalizeGroupLabel(fmpIndustry);
  if (!normalizedIndustry) return undefined;

  return sectorMappings.find((mapping) =>
    mapping.fmpIndustries.some((industry) => normalizeGroupLabel(industry) === normalizedIndustry),
  );
}

function cleanContextValue(value?: string | null) {
  const cleaned = (value || "").trim();
  if (!cleaned || cleaned === "N/A" || cleaned === "NA") return "";
  return cleaned;
}

function normalizeGroupLabel(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function formatSnapshotChange(value: number | undefined) {
  return value === undefined ? "" : formatSignedPercent(value);
}

function formatSignedPercent(value: number) {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${Math.abs(value).toFixed(2)}%`;
}

function buildContextTrend(tone: DetailTone, offset: number, range: ContextRange): number[] {
  const bullish = [34, 35, 38, 37, 40, 42, 43, 45, 47, 50];
  const bearish = [50, 48, 47, 45, 44, 41, 40, 38, 37, 35];
  const volatile = [40, 44, 39, 46, 42, 48, 43, 50, 45, 49];
  const neutral = [40, 41, 40, 42, 41, 42, 43, 42, 43, 44];
  const base = tone === "bearish" ? bearish : tone === "volatile" ? volatile : tone === "neutral" ? neutral : bullish;
  const multiplier = range === "30D" ? 1.7 : range === "5D" ? 1.25 : 1;

  return base.map((value, index) => Math.round(value * multiplier + offset * 2 + (index % 3)));
}

function offsetTrend(values: number[], offset: number) {
  return values.map((value, index) => Number((value + offset * 0.35 + (index % 2) * 0.1).toFixed(2)));
}

async function readOriginalHtml(
  rawItem: Record<string, unknown> | null,
  rawPayload: Record<string, unknown> | null,
  primaryDocumentUrl: string,
) {
  const html =
    readString(rawPayload, "full_text_html") ||
    readString(rawPayload, "filing_html") ||
    readString(rawPayload, "primary_document_html");
  if (html) return html;

  const fetchedHtml = await fetchSecPrimaryDocumentHtml(primaryDocumentUrl);
  if (fetchedHtml) return fetchedHtml;

  return bodyTextToHtml(
    readString(rawItem, "analysis_text") ||
      readString(rawItem, "body_text") ||
      readString(rawPayload, "analysis_text") ||
      readString(rawPayload, "body_text"),
  );
}

async function fetchSecPrimaryDocumentHtml(url: string) {
  if (!isSecPrimaryDocumentUrl(url)) return "";

  try {
    const response = await fetch(url, {
      cache: "force-cache",
      next: { revalidate: 60 * 60 * 24 },
      headers: {
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
        "User-Agent": process.env.SEC_USER_AGENT || process.env.SEC_EDGAR_USER_AGENT || "StockRadar/1.0 contact@stockradar.local",
      },
    });
    if (!response.ok) return "";

    const text = await response.text();
    if (!isRenderableSecPrimaryDocument(text)) return "";
    return text.length > 2_000_000 ? text.slice(0, 2_000_000) : text;
  } catch {
    return "";
  }
}

function isRenderableSecPrimaryDocument(value: string) {
  return /<html[\s>]/i.test(value) || /<body[\s>]/i.test(value) || /<table[\s>]/i.test(value);
}

function readPrimaryDocumentUrl(
  rawPayload: Record<string, unknown> | null,
  metadata: Record<string, unknown> | null,
  fallbackUrl: string,
) {
  const explicit = readString(rawPayload, "primary_document_url") || readString(metadata, "primary_document_url");
  if (isSecPrimaryDocumentUrl(explicit)) return explicit;

  const documentUrl = recordArray(rawPayload?.documents)
    .filter((document) => Boolean(document.isPrimary))
    .map((document) => readString(document, "url"))
    .find(isSecPrimaryDocumentUrl);
  if (documentUrl) return documentUrl;

  return isSecPrimaryDocumentUrl(fallbackUrl) ? fallbackUrl : explicit || fallbackUrl;
}

function isSecPrimaryDocumentUrl(url: string) {
  return /^https:\/\/www\.sec\.gov\/Archives\//i.test(url) && !/-index\.html?$/i.test(url);
}

function mapDocumentInventory(rawPayload: Record<string, unknown> | null): FilingDocumentInventoryItem[] {
  return recordArray(rawPayload?.documents).slice(0, 25).map((document, index) => {
    const label =
      readString(document, "document") ||
      readString(document, "filename") ||
      readString(document, "description") ||
      `Document ${index + 1}`;
    const textCharCount = readNumber(document, "textCharCount");
    const fetchStatus = readString(document, "fetchStatus");
    const fetchError = readString(document, "fetchError");

    return {
      label,
      type: readString(document, "type"),
      description: readString(document, "description"),
      url: readString(document, "url"),
      size: readString(document, "size"),
      textStatus: fetchError || (textCharCount ? `${textCharCount.toLocaleString("en-US")} chars captured` : fetchStatus || "Inventory only"),
      isPrimary: Boolean(document.isPrimary),
    };
  });
}

function mapAttachmentSnippets(rawPayload: Record<string, unknown> | null): FilingAttachmentSnippet[] {
  return recordArray(rawPayload?.attachment_texts)
    .map((attachment, index) => {
      const text = readString(attachment, "text");
      if (!text) return null;

      return {
        label: readString(attachment, "description") || readString(attachment, "type") || `Attachment ${index + 1}`,
        url: readString(attachment, "url"),
        text: text.replace(/\s+/g, " ").trim().slice(0, 800),
      };
    })
    .filter((item): item is FilingAttachmentSnippet => Boolean(item))
    .slice(0, 4);
}

function buildArchiveBriefSummary({ filingSummary, fallback }: { filingSummary: string; fallback: string }) {
  const cleanedFilingSummary = stripArchiveSummarySuffix(filingSummary);
  if (cleanedFilingSummary) return cleanedFilingSummary;

  return ensureArchiveSummary(fallback);
}

function ensureArchiveSummary(value: string) {
  const summary = stripArchiveSummarySuffix(value).replace(/\s+/g, " ").trim();
  const clipped =
    summary.length > 520
      ? `${summary.slice(0, 517).trim()}...`
      : summary || "This SEC filing was archived as a lower-impact disclosure.";
  const cleaned = stripArchiveSummarySuffix(clipped);
  return `${cleaned || "This SEC filing was archived as a lower-impact disclosure."} ${ARCHIVE_SUMMARY_SUFFIX}`;
}

function stripArchiveSummarySuffix(value: string) {
  return value.replace(new RegExp(`${escapeRegExp(ARCHIVE_SUMMARY_SUFFIX)}\\s*$`), "").trim();
}

function MetricRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="detail-metric-row">
      <span>{label}</span>
      <strong>{value || "-"}</strong>
    </div>
  );
}

function bodyTextToHtml(value: string) {
  if (!value) return "";
  return value
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .slice(0, 80)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br />")}</p>`)
    .join("\n");
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item || "").trim()).filter(Boolean) : [];
}

function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    : [];
}

function toRows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object")
    : [];
}

function toRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function readString(row: Record<string, unknown> | null | undefined, key: string) {
  if (!row) return "";
  const value = row[key];
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function readNumber(row: Record<string, unknown> | null | undefined, key: string) {
  if (!row) return 0;
  const value = row[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && Number.isFinite(Number(value))) return Number(value);
  return 0;
}

function readSignal(row: Record<string, unknown>): DetailTone {
  const signal = readString(row, "signal");
  if (signal === "bullish" || signal === "bearish" || signal === "volatile" || signal === "neutral") return signal;
  return "neutral";
}

function buildPriceSeries({
  lastClose,
  previousClose,
  trend,
  volumeBase,
}: {
  lastClose: number;
  previousClose: number;
  trend: number[];
  volumeBase: number;
}): PriceChartSeries {
  return {
    previousClose,
    periods: {
      "1D": makePricePoints(["9:30", "10:00", "10:30", "11:00", "12:00", "1:00", "2:00", "3:00"], lastClose, previousClose, trend, volumeBase, 1.6),
      "5D": makePricePoints(["Mon", "Tue", "Wed", "Thu", "Fri", "Mon", "Tue", "Wed"], lastClose, previousClose, trend, volumeBase, 3.2),
      "1M": makePricePoints(["W1", "W1", "W2", "W2", "W3", "W3", "W4", "Today"], lastClose, previousClose, trend, volumeBase, 5),
      "3M": makePricePoints(["M1", "M1", "M2", "M2", "M3", "M3", "M3", "Today"], lastClose, previousClose, trend, volumeBase, 7),
      "1Y": makePricePoints(["Jun", "Aug", "Oct", "Dec", "Feb", "Mar", "Apr", "May"], lastClose, previousClose, trend, volumeBase, 12),
    },
  };
}

function makePricePoints(
  labels: string[],
  lastClose: number,
  previousClose: number,
  trend: number[],
  volumeBase: number,
  spread: number,
): PricePoint[] {
  const sampledTrend = sampleTrend(trend.length ? trend : [40, 41, 42, 43], labels.length);
  const minTrend = Math.min(...sampledTrend);
  const maxTrend = Math.max(...sampledTrend);
  const trendRange = maxTrend - minTrend || 1;
  const lowBand = Math.max(0.01, Math.min(previousClose, lastClose) - spread);
  const highBand = Math.max(previousClose, lastClose) + spread * 0.45;
  const closes = sampledTrend.map((value, index) => {
    const normalized = (value - minTrend) / trendRange;
    const drift = (index / Math.max(sampledTrend.length - 1, 1)) * (lastClose - previousClose) * 0.35;
    return roundPrice(lowBand + normalized * (highBand - lowBand) + drift);
  });
  closes[closes.length - 1] = roundPrice(lastClose);

  return closes.map((close, index) => {
    const open = index === 0 ? previousClose : closes[index - 1];
    const volatility = Math.max(Math.abs(close - open), spread * 0.18, 0.02);

    return {
      close,
      high: roundPrice(Math.max(open, close) + volatility * 0.45),
      low: roundPrice(Math.max(0.01, Math.min(open, close) - volatility * 0.45)),
      open: roundPrice(open),
      time: labels[index] || `P${index + 1}`,
      volume: Math.max(1, Math.round(volumeBase * (0.55 + index * 0.07))),
      vwap: roundPrice((open + close) / 2),
    };
  });
}

function sampleTrend(values: number[], count: number) {
  if (!values.length) return Array.from({ length: count }, (_, index) => 40 + index);
  if (values.length === count) return values;

  return Array.from({ length: count }, (_, index) => {
    const sourceIndex = Math.round((index / Math.max(count - 1, 1)) * (values.length - 1));
    return values[sourceIndex] ?? values[values.length - 1] ?? 40;
  });
}

function roundPrice(value: number) {
  return Number(value.toFixed(value < 1 ? 4 : 2));
}

function parseSignedNumber(value: string) {
  const parsed = Number(value.replace(/[$,%+\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMarketCap(value: number) {
  if (value >= 1_000_000_000_000) return `$${(value / 1_000_000_000_000).toFixed(2)}T`;
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

function formatDetailDateTime(value: string, fallback = "Recent") {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;

  return `${new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "America/New_York",
  }).format(date)} - ${new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/New_York",
  }).format(date)} ET`;
}

function formatSecFilingDateTime(
  value: string,
  rawPayload: Record<string, unknown> | null,
  fallback = "Recent",
) {
  const acceptedAt =
    readString(rawPayload, "accepted_at") ||
    readString(rawPayload, "acceptance_datetime") ||
    readString(rawPayload, "accepted");
  if (acceptedAt) return formatDetailDateTime(acceptedAt, fallback);

  const filingDate = normalizeDateOnlyForDisplay(readString(rawPayload, "filing_date"));
  if (filingDate) {
    return formatDetailDateOnly(filingDate, fallback);
  }

  return formatDetailDateTime(value, fallback);
}

function formatDetailDateOnly(value: string, fallback = "Recent") {
  const dateOnly = normalizeDateOnlyForDisplay(value);
  if (!dateOnly) return fallback;
  const date = new Date(`${dateOnly}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function normalizeDateOnlyForDisplay(value: string) {
  const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] || "";
}

function isRealTicker(value: string) {
  return Boolean(value && value !== "N/A" && value !== "NA" && /^[A-Z][A-Z0-9.-]{0,9}$/.test(value));
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
