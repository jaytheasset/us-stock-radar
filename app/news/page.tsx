import { FeedShell, type FeedItem } from "@/components/FeedShell";
import { NewsRadarActivity, type NewsRadarActivityItem } from "@/components/NewsRadarActivity";
import { sectorMappings } from "@/lib/taxonomyRegistry";
import { redirect } from "next/navigation";

type NewsPageProps = {
  searchParams?: Promise<{
    page?: string;
    limit?: string;
  }>;
};

const NEWS_TOTAL = 276;

const bullishTrend = [18, 20, 19, 22, 24, 23, 26, 28, 31, 30, 34, 36, 35, 38, 41, 43, 42, 45, 48, 51, 50, 54];
const bearishTrend = [54, 52, 50, 51, 48, 45, 47, 43, 41, 39, 40, 37, 35, 32, 34, 31, 28, 26, 27, 24, 22, 20];
const volatileTrend = [28, 33, 26, 35, 31, 39, 30, 42, 36, 45, 34, 48, 40, 44, 37, 50, 43, 47, 39, 52, 46, 49];

type SectorMoverTone = "bullish" | "warm" | "flat" | "bearish";

type SectorMover = {
  sector: string;
  change: string;
  tone: SectorMoverTone;
  volume: string;
  industries: SectorIndustryMover[];
};

type SectorIndustryMover = {
  name: string;
  change: string;
  tickers: string[];
  tickerMovers: Array<{
    symbol: string;
    change: string;
  }>;
  tone?: SectorMoverTone;
  marketCap?: string;
  trend?: number[];
};

const sectorSeeds: Record<string, { change: string; tone: SectorMoverTone; volume: string }> = {
  Technology: { change: "+2.84%", tone: "bullish", volume: "1.34x volume" },
  "Communication Services": { change: "+1.21%", tone: "bullish", volume: "1.12x volume" },
  "Consumer Cyclical": { change: "+0.63%", tone: "warm", volume: "0.98x volume" },
  "Consumer Defensive": { change: "+0.22%", tone: "flat", volume: "0.91x volume" },
  Healthcare: { change: "+1.96%", tone: "bullish", volume: "1.18x volume" },
  "Financial Services": { change: "+0.88%", tone: "warm", volume: "0.96x volume" },
  Industrials: { change: "+1.05%", tone: "bullish", volume: "1.03x volume" },
  Energy: { change: "+1.42%", tone: "bullish", volume: "1.09x volume" },
  Utilities: { change: "+0.18%", tone: "flat", volume: "0.86x volume" },
  "Basic Materials": { change: "-0.72%", tone: "bearish", volume: "0.89x volume" },
  "Real Estate": { change: "-0.31%", tone: "bearish", volume: "0.84x volume" },
  Other: { change: "+0.04%", tone: "flat", volume: "0.61x volume" },
};

const subCategorySeeds: Record<
  string,
  {
    change: string;
    tickers: string[];
    tickerMovers: Array<{
      symbol: string;
      change: string;
    }>;
    marketCap: string;
    trend: number[];
    tone?: SectorMoverTone;
  }
> = {
  "Semiconductors & Compute": {
    change: "+4.32%",
    tickers: ["NVDA", "AMD", "AVGO", "MU"],
    tickerMovers: [
      { symbol: "NVDA", change: "+4.86%" },
      { symbol: "AMD", change: "+3.92%" },
      { symbol: "AVGO", change: "+2.74%" },
      { symbol: "MU", change: "+2.18%" },
    ],
    marketCap: "$2.56T",
    trend: [26, 31, 29, 36, 42, 40, 48, 52, 50, 58, 63, 67],
  },
  "Software & Cloud": {
    change: "+2.18%",
    tickers: ["MSFT", "ORCL", "SNOW", "DDOG"],
    tickerMovers: [
      { symbol: "SNOW", change: "+4.12%" },
      { symbol: "DDOG", change: "+3.20%" },
      { symbol: "ORCL", change: "+2.46%" },
      { symbol: "MSFT", change: "+1.14%" },
    ],
    marketCap: "$1.89T",
    trend: [32, 35, 34, 39, 42, 44, 43, 48, 50, 54, 55, 59],
  },
  Cybersecurity: {
    change: "+0.41%",
    tickers: ["CRWD", "PANW", "ZS"],
    tickerMovers: [
      { symbol: "ZS", change: "+1.28%" },
      { symbol: "CRWD", change: "+0.96%" },
      { symbol: "PANW", change: "+0.34%" },
    ],
    marketCap: "$420B",
    trend: [42, 41, 43, 45, 44, 46, 47, 49, 48, 50, 51, 52],
  },
  "IT Services": {
    change: "+0.74%",
    tickers: ["ACN", "IBM", "INFY"],
    tickerMovers: [
      { symbol: "IBM", change: "+1.58%" },
      { symbol: "INFY", change: "+0.84%" },
      { symbol: "ACN", change: "+0.52%" },
    ],
    marketCap: "$820B",
    trend: [38, 39, 40, 41, 43, 42, 44, 45, 47, 46, 48, 49],
  },
  "Hardware & Electronics": {
    change: "+1.07%",
    tickers: ["AAPL", "DELL", "HPQ"],
    tickerMovers: [
      { symbol: "DELL", change: "+2.71%" },
      { symbol: "HPQ", change: "+1.34%" },
      { symbol: "AAPL", change: "+0.62%" },
    ],
    marketCap: "$1.24T",
    trend: [45, 44, 46, 47, 49, 48, 50, 53, 52, 55, 57, 58],
  },
};

const sectorTickerFallbacks: Record<string, string[]> = {
  Technology: ["NVDA", "MSFT", "AAPL"],
  "Communication Services": ["META", "GOOGL", "NFLX"],
  "Consumer Cyclical": ["TSLA", "AMZN", "HD"],
  "Consumer Defensive": ["WMT", "COST", "KO"],
  Healthcare: ["LLY", "UNH", "MRK"],
  "Financial Services": ["JPM", "BAC", "V"],
  Industrials: ["GE", "CAT", "BA"],
  Energy: ["XOM", "CVX", "COP"],
  Utilities: ["NEE", "DUK", "SO"],
  "Basic Materials": ["FCX", "NEM", "DOW"],
  "Real Estate": ["PLD", "AMT", "SPG"],
  Other: ["SPY", "QQQ", "IWM"],
};

const sectorMovers = buildDefinedSectorMovers();

function buildDefinedSectorMovers(): SectorMover[] {
  const sectorOrder = Array.from(new Set(sectorMappings.map((item) => item.sector)));

  return sectorOrder.map((sector) => {
    const seed = sectorSeeds[sector] || { change: "+0.00%", tone: "flat" as const, volume: "0.80x volume" };
    const fallbackTickers = sectorTickerFallbacks[sector] || ["SPY", "QQQ", "IWM"];
    const mappings = sectorMappings.filter((item) => item.sector === sector);

    return {
      sector,
      change: seed.change,
      tone: seed.tone,
      volume: seed.volume,
      industries: mappings.map((mapping, index) => {
        const subSeed = subCategorySeeds[mapping.subCategory];
        const generatedChange = formatSignedPercent(parsePercent(seed.change) - index * 0.27 + 0.38);
        const change = subSeed?.change || generatedChange;

        return {
          name: mapping.subCategory,
          change,
          tickers: subSeed?.tickers || fallbackTickers,
          tickerMovers: sortTickerMovers(
            subSeed?.tickerMovers || buildTickerMovers(fallbackTickers, change, index),
          ),
          tone: subSeed?.tone || toneFromChange(change),
          marketCap: subSeed?.marketCap || estimateMarketCap(index, mappings.length),
          trend: subSeed?.trend || buildMiniTrend(index, change.startsWith("-") ? "bearish" : "bullish"),
        };
      }),
    };
  });
}

function parsePercent(value: string) {
  return Number(value.replace("%", "")) || 0;
}

function formatSignedPercent(value: number) {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function toneFromChange(value: string): SectorMoverTone {
  const parsed = parsePercent(value);
  if (parsed < 0) return "bearish";
  if (parsed < 0.5) return "flat";
  if (parsed < 1.2) return "warm";
  return "bullish";
}

function estimateMarketCap(index: number, total: number) {
  const base = Math.max(120, 980 - index * Math.max(70, 460 / Math.max(total, 1)));
  return base >= 1000 ? `$${(base / 1000).toFixed(2)}T` : `$${Math.round(base)}B`;
}

function buildMiniTrend(index: number, tone: "bullish" | "bearish") {
  const start = tone === "bearish" ? 58 - index * 2 : 28 + index * 3;
  const direction = tone === "bearish" ? -1 : 1;
  return Array.from({ length: 12 }, (_, point) => start + direction * point * 2 + ((point + index) % 3) * 1.4);
}

function buildTickerMovers(symbols: string[], industryChange: string, index: number) {
  const base = parsePercent(industryChange);

  return symbols.map((symbol, tickerIndex) => ({
    symbol,
    change: formatSignedPercent(base + 0.72 - tickerIndex * 0.46 - index * 0.08),
  }));
}

function sortTickerMovers(tickers: Array<{ symbol: string; change: string }>) {
  return [...tickers].sort((a, b) => parsePercent(b.change) - parsePercent(a.change));
}

const themeValueMap = [
  {
    theme: "AI & Data Center",
    score: 92,
    signal: "Bullish",
    newsCount: 38,
    avgScore: 81,
    momentum: "+24.6%",
    tone: "bullish",
  },
  {
    theme: "Power & Energy",
    score: 84,
    signal: "Bullish",
    newsCount: 21,
    avgScore: 76,
    momentum: "+8.7%",
    tone: "bullish",
  },
  {
    theme: "Healthcare Momentum",
    score: 79,
    signal: "Volatile",
    newsCount: 29,
    avgScore: 73,
    momentum: "+6.1%",
    tone: "volatile",
  },
  {
    theme: "Policy & Regulation",
    score: 76,
    signal: "Bearish",
    newsCount: 17,
    avgScore: 78,
    momentum: "-3.4%",
    tone: "bearish",
  },
  {
    theme: "Crypto & Digital Assets",
    score: 68,
    signal: "Volatile",
    newsCount: 14,
    avgScore: 66,
    momentum: "+4.2%",
    tone: "volatile",
  },
];

const searchVolumeTrends = [
  {
    keyword: "Nvidia Blackwell",
    theme: "AI & Data Center",
    volume: "91",
    change: "+38.2%",
    tone: "bullish",
    bars: [36, 42, 51, 48, 62, 71, 88],
  },
  {
    keyword: "data center power",
    theme: "Power & Energy",
    volume: "84",
    change: "+31.5%",
    tone: "bullish",
    bars: [28, 37, 44, 53, 59, 68, 79],
  },
  {
    keyword: "FDA approval",
    theme: "Healthcare",
    volume: "77",
    change: "+22.4%",
    tone: "bullish",
    bars: [44, 41, 49, 57, 54, 63, 72],
  },
  {
    keyword: "ATM offering",
    theme: "Dilution Risk",
    volume: "69",
    change: "+17.6%",
    tone: "bearish",
    bars: [24, 29, 35, 33, 44, 52, 58],
  },
  {
    keyword: "export controls",
    theme: "Policy",
    volume: "66",
    change: "+15.9%",
    tone: "bearish",
    bars: [31, 28, 36, 41, 39, 48, 55],
  },
];

const sourceActivity: NewsRadarActivityItem[] = [
  activity("Business Wire", "News", 125, 186, 612, 914, 2480, 3710, 7340, 10962),
  activity("GlobeNewswire", "News", 98, 141, 486, 702, 1934, 2816, 5810, 8424),
  activity("PR Newswire", "News", 72, 118, 344, 558, 1418, 2294, 4272, 6902),
  activity("Accesswire", "News", 64, 103, 291, 471, 1186, 1918, 3560, 5744),
  activity("Newsfile", "News", 42, 67, 205, 328, 826, 1322, 2404, 3848),
  activity("FDA", "Policy", 31, 52, 112, 191, 438, 724, 1326, 2198),
  activity("OFAC", "Policy", 8, 19, 33, 74, 142, 318, 448, 1006),
  activity("DOJ", "Policy", 12, 28, 54, 126, 226, 524, 714, 1658),
  activity("DEA", "Policy", 5, 16, 21, 63, 91, 272, 276, 824),
  activity("White House - Presidential Actions", "Policy", 9, 22, 37, 92, 148, 362, 448, 1098),
  activity("White House - Fact Sheets", "Policy", 6, 17, 24, 68, 102, 284, 318, 872),
  activity("White House - Releases", "Policy", 4, 13, 15, 46, 64, 198, 216, 612),
];

function activity(
  source: string,
  group: string,
  todayProcessed: number,
  todayChecked: number,
  fiveDayProcessed: number,
  fiveDayChecked: number,
  oneMonthProcessed: number,
  oneMonthChecked: number,
  threeMonthProcessed: number,
  threeMonthChecked: number,
): NewsRadarActivityItem {
  return {
    source,
    group,
    processed: {
      today: todayProcessed,
      fiveDay: fiveDayProcessed,
      oneMonth: oneMonthProcessed,
      threeMonth: threeMonthProcessed,
    },
    checked: {
      today: todayChecked,
      fiveDay: fiveDayChecked,
      oneMonth: oneMonthChecked,
      threeMonth: threeMonthChecked,
    },
  };
}

const newsSeed: Array<Omit<FeedItem, "id" | "sourceGroup" | "updatedAt" | "scoreReason" | "trend">> = [
  {
    time: "12:08 AM",
    ticker: "TYBT",
    price: "$96.25",
    changeAmount: "$0.00",
    change: "+0.00%",
    source: "Accesswire",
    eventType: "earnings_result",
    title: "Trinity Bank Reports Results for First Quarter 2026 Net Income Up 4.2%",
    summary: "Trinity Bank reported Q1 2026 net income growth with diluted EPS improving year over year.",
    score: 56,
    deliveryLevel: "feed",
    impact: "low",
    signal: "neutral",
  },
  {
    time: "12:08 AM",
    ticker: "PRSO",
    price: "$1.04",
    changeAmount: "$0.35",
    change: "-25.00%",
    source: "Accesswire",
    eventType: "earnings_delay",
    title: "Peraso Announces First Quarter 2026 Results",
    summary: "Supplier material delays pushed fulfillment of a significant customer order into a later period.",
    score: 78,
    deliveryLevel: "alert",
    impact: "high",
    signal: "volatile",
  },
  {
    time: "12:07 AM",
    ticker: "AIMLF",
    price: "$0.05",
    changeAmount: "$0.01",
    change: "-10.40%",
    source: "Accesswire",
    eventType: "financing_dilution",
    title: "AI/ML Innovations Announces Closing of Final Tranche of Private Placement",
    summary: "Convertible debenture financing adds capital while introducing potential dilution risk.",
    score: 82,
    deliveryLevel: "alert",
    impact: "high",
    signal: "bearish",
  },
  {
    time: "12:07 AM",
    ticker: "STGW",
    price: "$4.91",
    changeAmount: "$0.12",
    change: "+2.51%",
    source: "Accesswire",
    eventType: "product_launch",
    title: "The Harris Poll Introduces AI-Ready Research Packet",
    summary: "New product converts research deliverables into structured AI-ready intelligence for enterprise clients.",
    score: 63,
    deliveryLevel: "feed",
    impact: "medium",
    signal: "bullish",
  },
  {
    time: "11:42 PM",
    ticker: "ARGX",
    price: "$618.40",
    changeAmount: "$28.15",
    change: "+4.77%",
    source: "GlobeNewswire",
    eventType: "regulatory_approval",
    title: "argenx Announces U.S. FDA Approval Expanding VYVGART Use",
    summary: "Approval expands the eligible adult gMG population and broadens the commercial opportunity.",
    score: 86,
    deliveryLevel: "alert",
    impact: "high",
    signal: "bullish",
  },
  {
    time: "11:24 PM",
    ticker: "NLST",
    price: "$3.01",
    changeAmount: "$0.46",
    change: "-13.26%",
    source: "Accesswire",
    eventType: "earnings_result",
    title: "Netlist Reports First Quarter 2026 Results",
    summary: "Revenue declined while management highlighted cost controls and litigation-related expenses.",
    score: 86,
    deliveryLevel: "alert",
    impact: "high",
    signal: "bearish",
  },
  {
    time: "11:05 PM",
    ticker: "NVDA",
    price: "$125.47",
    changeAmount: "$2.29",
    change: "+1.86%",
    source: "Business Wire",
    eventType: "product_launch",
    title: "Nvidia Announces Expanded Data Center Platform Availability",
    summary: "Platform availability broadens enterprise AI deployment options across major cloud partners.",
    score: 78,
    deliveryLevel: "alert",
    impact: "high",
    signal: "bullish",
  },
  {
    time: "10:48 PM",
    ticker: "DSS",
    price: "$1.24",
    changeAmount: "$0.08",
    change: "-6.06%",
    source: "GlobeNewswire",
    eventType: "going_concern",
    title: "DSS Reports Going Concern Audit Opinion in 2025 10-K Filing",
    summary: "The company disclosed substantial doubt about its ability to continue as a going concern.",
    score: 86,
    deliveryLevel: "alert",
    impact: "high",
    signal: "bearish",
  },
  {
    time: "10:21 PM",
    ticker: "LAC",
    price: "$3.82",
    changeAmount: "$0.23",
    change: "+6.28%",
    source: "Accesswire",
    eventType: "project_update",
    title: "Lithium Americas Provides Update on Thacker Pass Construction",
    summary: "Phase 1 construction remains on track with first production targeted for 2028.",
    score: 74,
    deliveryLevel: "feed",
    impact: "medium",
    signal: "bullish",
  },
  {
    time: "10:04 PM",
    ticker: "RDW",
    price: "$6.18",
    changeAmount: "$0.42",
    change: "+7.29%",
    source: "PR Newswire",
    eventType: "contract_award",
    title: "Redwire Announces New Space Infrastructure Contract Award",
    summary: "New contract expands backlog visibility for specialized space infrastructure work.",
    score: 76,
    deliveryLevel: "alert",
    impact: "high",
    signal: "bullish",
  },
  {
    time: "9:52 PM",
    ticker: "SAVA",
    price: "$8.42",
    changeAmount: "$0.91",
    change: "-9.75%",
    source: "GlobeNewswire",
    eventType: "clinical_update",
    title: "Cassava Sciences Provides Clinical Program Update",
    summary: "Program update adds uncertainty around timing and near-term biotech catalyst expectations.",
    score: 72,
    deliveryLevel: "feed",
    impact: "medium",
    signal: "volatile",
  },
  {
    time: "9:35 PM",
    ticker: "PLTR",
    price: "$21.84",
    changeAmount: "$0.57",
    change: "+2.67%",
    source: "PR Newswire",
    eventType: "contract_award",
    title: "Palantir Secures Expanded Commercial AI Agreement",
    summary: "Expanded agreement adds multi-year platform access for a large enterprise client.",
    score: 82,
    deliveryLevel: "alert",
    impact: "high",
    signal: "bullish",
  },
  {
    time: "9:18 PM",
    ticker: "RIVN",
    price: "$10.12",
    changeAmount: "$0.38",
    change: "-3.62%",
    source: "Business Wire",
    eventType: "production_update",
    title: "Rivian Issues Updated Production and Delivery Commentary",
    summary: "Updated commentary points to continued execution pressure in EV production and deliveries.",
    score: 69,
    deliveryLevel: "feed",
    impact: "medium",
    signal: "bearish",
  },
  {
    time: "8:57 PM",
    ticker: "SMCI",
    price: "$45.71",
    changeAmount: "$2.93",
    change: "+6.83%",
    source: "GlobeNewswire",
    eventType: "product_launch",
    title: "Super Micro Announces New Liquid-Cooled AI Server Systems",
    summary: "New systems target AI data center demand and thermal-efficiency requirements.",
    score: 79,
    deliveryLevel: "alert",
    impact: "high",
    signal: "bullish",
  },
  {
    time: "8:41 PM",
    ticker: "AVGO",
    price: "$1,481.63",
    changeAmount: "$30.39",
    change: "+2.09%",
    source: "Business Wire",
    eventType: "earnings_preview",
    title: "Broadcom Highlights AI Networking Demand Ahead of Earnings",
    summary: "AI networking demand remains a key theme for infrastructure and semiconductor investors.",
    score: 75,
    deliveryLevel: "alert",
    impact: "high",
    signal: "bullish",
  },
  {
    time: "8:16 PM",
    ticker: "AMD",
    price: "$162.38",
    changeAmount: "$4.05",
    change: "+2.55%",
    source: "Reuters",
    eventType: "product_competition",
    title: "AMD Announces MI350X Accelerators Targeting AI Training Market",
    summary: "New accelerator roadmap keeps competitive pressure active in the AI compute market.",
    score: 77,
    deliveryLevel: "alert",
    impact: "high",
    signal: "bullish",
  },
  {
    time: "7:58 PM",
    ticker: "AAPL",
    price: "$195.62",
    changeAmount: "$1.34",
    change: "-0.68%",
    source: "Reuters",
    eventType: "product_delay",
    title: "Apple Reportedly Delays Advanced Siri Features to 2026",
    summary: "Reported product delay may pressure near-term AI narrative and software expectations.",
    score: 68,
    deliveryLevel: "feed",
    impact: "medium",
    signal: "bearish",
  },
  {
    time: "7:39 PM",
    ticker: "MRNA",
    price: "$31.28",
    changeAmount: "$1.18",
    change: "+3.92%",
    source: "GlobeNewswire",
    eventType: "clinical_update",
    title: "Moderna Shares Positive Respiratory Vaccine Program Update",
    summary: "Clinical update supports investor focus on pipeline breadth beyond COVID products.",
    score: 73,
    deliveryLevel: "feed",
    impact: "medium",
    signal: "bullish",
  },
  {
    time: "7:22 PM",
    ticker: "ACHR",
    price: "$4.76",
    changeAmount: "$0.39",
    change: "+8.92%",
    source: "PR Newswire",
    eventType: "partnership",
    title: "Archer Aviation Announces Expanded Commercial Partnership",
    summary: "Expanded partnership keeps eVTOL commercialization and route planning in focus.",
    score: 71,
    deliveryLevel: "feed",
    impact: "medium",
    signal: "bullish",
  },
  {
    time: "7:05 PM",
    ticker: "BBAI",
    price: "$2.18",
    changeAmount: "$0.17",
    change: "-7.23%",
    source: "Business Wire",
    eventType: "financing_dilution",
    title: "BigBear.ai Announces Registered Direct Offering",
    summary: "Offering headline introduces near-term dilution risk despite added balance sheet capital.",
    score: 80,
    deliveryLevel: "alert",
    impact: "high",
    signal: "bearish",
  },
];

export default async function NewsPage({ searchParams }: NewsPageProps) {
  const params = await searchParams;
  const page = Math.max(1, Number(params?.page || 1) || 1);

  if (params?.limit) {
    redirect(page > 1 ? `/news?page=${page}` : "/news");
  }

  const limit = 20;
  const feedItems = buildNewsItems(page, limit);

  return (
    <FeedShell
      activeNavLabel="News"
      activeTab="News"
      pageVariant="news"
      sidebarMode="premiumOnly"
      premiumPlacement="bottom"
      sidebarSlot={<NewsSidebarInsights />}
      feedItems={feedItems}
      paginationBasePath="/news"
      searchFilterSlot={<NewsSearchFilters />}
      showCharts={false}
      showHeadingControls={false}
      showSituationStrip={false}
      showTabs={false}
      showPageSizeControl={false}
      pageInfo={{
        page,
        limit,
        hasNext: page * limit < NEWS_TOTAL,
        total: NEWS_TOTAL,
        itemCount: feedItems.length,
      }}
    />
  );
}

function NewsSidebarInsights() {
  const selectedSector = sectorMovers[0];

  return (
    <div className="news-sidebar-insights">
      <NewsRadarActivity items={sourceActivity} />

      <section className="sector-movers-card">
        <div className="news-insight-header">
          <div>
            <span>Sector Valuemap</span>
            <h2>Sector heat by daily change</h2>
          </div>
          <div className="map-range-controls" aria-label="Sector value map range">
            <button className="active" type="button">
              Today
            </button>
            <button type="button">5D</button>
            <button type="button">1M</button>
            <button type="button">3M</button>
          </div>
        </div>

        <div className="sector-map-grid">
          {sectorMovers.map((sector) => (
            <article
              className={`sector-map-tile ${sector.tone}${sector.sector === selectedSector.sector ? " active" : ""}`}
              key={sector.sector}
            >
              <div className="sector-map-title">
                <strong>{sector.sector}</strong>
                <b>{sector.change}</b>
              </div>
            </article>
          ))}
        </div>

        <div className="sector-detail-card">
          <div className="sector-detail-heading">
            <strong>{selectedSector.sector}</strong>
          </div>

          <div className="sector-detail-table">
            <div className="sector-detail-row head">
              <span>Industry</span>
              <span>Daily Change</span>
              <span>Market Cap</span>
              <span>Trend</span>
            </div>
            {selectedSector.industries.map((industry) => (
              <div className="sector-detail-row with-tickers" key={`detail-${industry.name}`}>
                <strong>{industry.name}</strong>
                <b className={industry.change.startsWith("-") ? "bearish" : "bullish"}>{industry.change}</b>
                <span>{industry.marketCap || "-"}</span>
                <TrendMini values={industry.trend || bullishTrend.slice(0, 12)} tone={industry.change.startsWith("-") ? "bearish" : "bullish"} />
                <div className="industry-ticker-list" aria-label={`${industry.name} top movers`}>
                  <span className="ticker-list-label">Top movers</span>
                  {industry.tickerMovers.slice(0, 4).map((ticker) => (
                    <span className={`ticker-mover ${ticker.change.startsWith("-") ? "bearish" : "bullish"}`} key={`${industry.name}-${ticker.symbol}`}>
                      {ticker.symbol} {ticker.change}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="sector-detail-foot">
            <span>Color by daily change</span>
            <span>Mock data as of 12:08 AM ET</span>
          </div>
        </div>
      </section>

      <section className="theme-value-card">
        <div className="news-insight-header">
          <div>
            <span>Theme Value Map</span>
            <h2>Theme heat by news impact</h2>
          </div>
          <button type="button">View all</button>
        </div>

        <div className="theme-value-list">
          {themeValueMap.map((item) => (
            <article className="theme-value-row" key={item.theme}>
              <div className="theme-value-topline">
                <strong>{item.theme}</strong>
                <span className={item.tone}>{item.momentum}</span>
              </div>
              <div className="theme-value-meta">
                <span>{item.newsCount} news</span>
                <span>Avg {item.avgScore}</span>
                <span>{item.signal}</span>
              </div>
              <div className="theme-value-meter" aria-label={`${item.theme} score ${item.score}`}>
                <span style={{ width: `${item.score}%` }} />
              </div>
              <strong className="theme-score">{item.score}</strong>
            </article>
          ))}
        </div>
      </section>

      <section className="search-trend-card">
        <div className="news-insight-header">
          <div>
            <span>Search Volume Trends</span>
            <h2>Keyword demand, 7D</h2>
          </div>
          <button type="button">Full ranking</button>
        </div>

        <div className="keyword-trend-list">
          {searchVolumeTrends.map((item, index) => (
            <article className="keyword-trend-row" key={item.keyword}>
              <span className="keyword-rank">{index + 1}</span>
              <div className="keyword-copy">
                <strong>{item.keyword}</strong>
                <small>{item.theme}</small>
              </div>
              <div className={`trend-bars ${item.tone}`} aria-label={`${item.keyword} search trend`}>
                {item.bars.map((bar, barIndex) => (
                  <span style={{ height: `${bar}%` }} key={`${item.keyword}-${barIndex}`} />
                ))}
              </div>
              <div className="keyword-metric">
                <strong>{item.volume}</strong>
                <span className={item.tone}>{item.change}</span>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function NewsSearchFilters() {
  return (
    <section className="news-search-filters" aria-label="News search filters">
      <div className="news-filter-search">
        <span aria-hidden="true">/</span>
        <input aria-label="Search news" placeholder="Search ticker, company, source, or headline" />
      </div>
      <div className="news-filter-controls">
        <button className="active" type="button">
          High Impact
        </button>
        <button type="button">Bullish</button>
        <button type="button">Bearish</button>
        <button type="button">Dilution</button>
        <button type="button">FDA</button>
        <button type="button">Earnings</button>
        <button type="button">Source</button>
        <button type="button">Sort: Newest</button>
      </div>
    </section>
  );
}

function TrendMini({ values, tone }: { values: number[]; tone: "bullish" | "bearish" }) {
  const width = 78;
  const height = 26;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 1);
  const points = values
    .map((value, index) => {
      const x = (index / Math.max(values.length - 1, 1)) * width;
      const y = height - ((value - min) / range) * (height - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg className={`trend-mini ${tone}`} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${tone} trend`}>
      <polyline points={points} />
    </svg>
  );
}

function buildNewsItems(page: number, limit: number): FeedItem[] {
  const start = (page - 1) * limit;
  const count = Math.max(0, Math.min(limit, NEWS_TOTAL - start));

  return Array.from({ length: count }, (_, index) => {
    const itemNumber = start + index + 1;
    const seed = newsSeed[(itemNumber - 1) % newsSeed.length];
    const trend =
      seed.signal === "bearish" ? bearishTrend : seed.signal === "volatile" ? volatileTrend : bullishTrend;

    return {
      ...seed,
      id: `news-${itemNumber}-${seed.ticker.toLowerCase()}-${seed.eventType}`,
      sourceGroup: "news",
      updatedAt: `${seed.time} EDT`,
      scoreReason: seed.summary,
      trend,
    };
  });
}
