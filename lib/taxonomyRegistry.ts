export type ThemeGroupStatus = "implemented" | "planned";
export type ClassificationMethod = "rule" | "llm" | "manual" | "unknown";

export type ThemeGroup = {
  slug: string;
  name: string;
  status: ThemeGroupStatus;
  description: string;
  sortOrder: number;
};

export type SectorMapping = {
  sector: string;
  subCategory: string;
  slug: string;
  fmpIndustries: string[];
  notes?: string;
};

export const themeGroups: ThemeGroup[] = [
  {
    slug: "ai_data_center",
    name: "AI & Data Center",
    status: "implemented",
    description: "AI infrastructure, accelerators, cloud capacity, and data center demand.",
    sortOrder: 10,
  },
  {
    slug: "crypto_digital_assets",
    name: "Crypto & Digital Assets",
    status: "implemented",
    description: "Crypto infrastructure, digital asset balance sheets, exchanges, miners, and tokens.",
    sortOrder: 20,
  },
  {
    slug: "healthcare_momentum",
    name: "Healthcare Momentum",
    status: "implemented",
    description: "Clinical catalysts, drug approvals, medical devices, and healthcare deal flow.",
    sortOrder: 30,
  },
  {
    slug: "power_energy_resources",
    name: "Power, Energy & Resources",
    status: "planned",
    description: "Power demand, nuclear, uranium, LNG, oil and gas, renewables, and key resources.",
    sortOrder: 40,
  },
  {
    slug: "defense_geopolitics",
    name: "Defense & Geopolitics",
    status: "planned",
    description: "Defense contractors, aerospace programs, sanctions, conflict, and geopolitical policy.",
    sortOrder: 50,
  },
  {
    slug: "rates_credit_banks",
    name: "Rates, Credit & Banks",
    status: "planned",
    description: "Banks, credit stress, yields, lending, capital markets, and rate-sensitive moves.",
    sortOrder: 60,
  },
  {
    slug: "retail_momentum_flows",
    name: "Retail & Momentum Flows",
    status: "planned",
    description: "High-volume retail names, squeezes, social momentum, and flow-driven setups.",
    sortOrder: 70,
  },
  {
    slug: "policy_regulation",
    name: "Policy & Regulation",
    status: "planned",
    description: "Regulatory, agency, court, White House, and enforcement actions with market impact.",
    sortOrder: 80,
  },
];

export const sectorMappings: SectorMapping[] = [
  map("Technology", "Semiconductors & Compute", "semiconductors_compute", ["Semiconductors"]),
  map("Technology", "Software & Cloud", "software_cloud", [
    "Software - Services",
    "Software - Infrastructure",
    "Software - Application",
  ]),
  map("Technology", "Cybersecurity", "cybersecurity", [], "Theme or manual list; FMP has no stable direct industry."),
  map("Technology", "IT Services", "it_services", ["Information Technology Services"]),
  map("Technology", "Hardware & Electronics", "hardware_electronics", [
    "Hardware, Equipment & Parts",
    "Computer Hardware",
    "Consumer Electronics",
    "Communication Equipment",
    "Technology Distributors",
  ]),
  map("Communication Services", "Internet Platforms", "internet_platforms", [
    "Internet Content & Information",
  ]),
  map("Communication Services", "Media & Entertainment", "media_entertainment", [
    "Media & Entertainment",
    "Entertainment",
    "Broadcasting",
  ]),
  map("Communication Services", "Gaming", "gaming", ["Electronic Gaming & Multimedia"]),
  map("Communication Services", "Telecom & Connectivity", "telecom_connectivity", [
    "Telecommunications Services",
  ]),
  map("Communication Services", "Advertising & Information Services", "advertising_information_services", [
    "Advertising Agencies",
    "Publishing",
  ]),
  map("Consumer Cyclical", "Autos & Mobility", "autos_mobility", [
    "Auto - Manufacturers",
    "Auto - Parts",
    "Auto - Recreational Vehicles",
    "Auto - Dealerships",
  ]),
  map("Consumer Cyclical", "Retail & E-commerce", "retail_ecommerce", [
    "Specialty Retail",
    "Department Stores",
  ]),
  map("Consumer Cyclical", "Restaurants", "restaurants", ["Restaurants"]),
  map("Consumer Cyclical", "Travel & Leisure", "travel_leisure", [
    "Travel Lodging",
    "Travel Services",
    "Leisure",
    "Gambling",
    "Resorts & Casinos",
  ]),
  map("Consumer Cyclical", "Home & Lifestyle", "home_lifestyle", [
    "Home Improvement",
    "Residential Construction",
    "Furnishings, Fixtures & Appliances",
  ]),
  map("Consumer Cyclical", "Apparel & Luxury", "apparel_luxury", [
    "Apparel - Retail",
    "Apparel - Manufacturers",
    "Apparel - Footwear & Accessories",
    "Luxury Goods",
  ]),
  map("Consumer Defensive", "Food & Beverage", "food_beverage", [
    "Packaged Foods",
    "Food Distribution",
    "Food Confectioners",
    "Beverages - Non-Alcoholic",
    "Beverages - Alcoholic",
    "Beverages - Wineries & Distilleries",
  ]),
  map("Consumer Defensive", "Household & Personal Care", "household_personal_care", [
    "Household & Personal Products",
    "Personal Products & Services",
  ]),
  map("Consumer Defensive", "Grocery & Discount Retail", "grocery_discount_retail", [
    "Grocery Stores",
    "Discount Stores",
  ]),
  map("Consumer Defensive", "Agriculture & Staples", "agriculture_staples", [
    "Agricultural Farm Products",
  ]),
  map("Consumer Defensive", "Tobacco, Cannabis & Alternative Products", "tobacco_cannabis_alternatives", [
    "Tobacco",
  ]),
  map("Healthcare", "Biotechnology", "biotechnology", ["Biotechnology"]),
  map("Healthcare", "Pharmaceuticals", "pharmaceuticals", [
    "Medical - Pharmaceuticals",
    "Drug Manufacturers - General",
    "Drug Manufacturers - Specialty & Generic",
  ]),
  map("Healthcare", "Medical Devices & Diagnostics", "medical_devices_diagnostics", [
    "Medical - Devices",
    "Medical - Instruments & Supplies",
    "Medical - Diagnostics & Research",
    "Medical - Equipment & Services",
  ]),
  map("Healthcare", "Healthcare Services", "healthcare_services", [
    "Medical - Care Facilities",
    "Medical - Distribution",
    "Medical - Healthcare Information Services",
    "Medical - Specialties",
  ]),
  map("Healthcare", "Health Insurance & Managed Care", "health_insurance_managed_care", [
    "Medical - Healthcare Plans",
  ]),
  map("Financial Services", "Banks", "banks", [
    "Banks",
    "Banks - Diversified",
    "Banks - Regional",
  ]),
  map("Financial Services", "Capital Markets & Exchanges", "capital_markets_exchanges", [
    "Financial - Capital Markets",
    "Financial - Data & Stock Exchanges",
    "Investment - Banking & Investment Services",
  ]),
  map("Financial Services", "Insurance", "insurance", [
    "Insurance - Specialty",
    "Insurance - Reinsurance",
    "Insurance - Property & Casualty",
    "Insurance - Life",
    "Insurance - Diversified",
    "Insurance - Brokers",
  ]),
  map("Financial Services", "Asset & Wealth Management", "asset_wealth_management", [
    "Asset Management",
    "Asset Management - Bonds",
    "Asset Management - Income",
    "Asset Management - Leveraged",
    "Asset Management - Global",
  ]),
  map("Financial Services", "Payments & Lending", "payments_lending", [
    "Financial - Credit Services",
    "Financial - Mortgages",
  ]),
  map("Financial Services", "Fintech & Digital Assets", "fintech_digital_assets", [
    "Asset Management - Cryptocurrency",
  ], "Theme membership should supplement this because the FMP industry is narrow."),
  map("Financial Services", "Diversified Finance", "diversified_finance", [
    "Financial - Diversified",
    "Financial - Conglomerates",
  ]),
  map("Industrials", "Aerospace & Defense", "aerospace_defense", ["Aerospace & Defense"]),
  map("Industrials", "Machinery & Equipment", "machinery_equipment", [
    "Industrial - Machinery",
    "Agricultural - Machinery",
    "Electrical Equipment & Parts",
    "Manufacturing - Tools & Accessories",
  ]),
  map("Industrials", "Transportation & Logistics", "transportation_logistics", [
    "General Transportation",
    "Integrated Freight & Logistics",
    "Railroads",
    "Trucking",
    "Marine Shipping",
    "Airlines",
    "Airports & Air Services",
  ]),
  map("Industrials", "Construction & Infrastructure", "construction_infrastructure", [
    "Construction",
    "Engineering & Construction",
    "Industrial - Infrastructure Operations",
  ]),
  map("Industrials", "Industrial Services & Manufacturing", "industrial_services_manufacturing", [
    "Manufacturing - Miscellaneous",
    "Manufacturing - Metal Fabrication",
    "Manufacturing - Textiles",
    "Industrial - Distribution",
    "Industrial - Specialties",
    "Industrial - Capital Goods",
    "Business Equipment & Supplies",
  ]),
  map("Industrials", "Environmental & Waste", "environmental_waste", [
    "Waste Management",
    "Environmental Services",
    "Industrial - Pollution & Treatment Controls",
  ]),
  map("Industrials", "Business Services", "business_services", [
    "Consulting Services",
    "Staffing & Employment Services",
    "Rental & Leasing Services",
    "Security & Protection Services",
    "Specialty Business Services",
  ]),
  map("Industrials", "Conglomerates", "conglomerates", ["Conglomerates"]),
  map("Energy", "Oil, Gas & Refining", "oil_gas_refining", [
    "Oil & Gas Integrated",
    "Oil & Gas Exploration & Production",
    "Oil & Gas Refining & Marketing",
    "Oil & Gas Energy",
  ]),
  map("Energy", "Midstream & LNG", "midstream_lng", ["Oil & Gas Midstream"]),
  map("Energy", "Energy Services & Equipment", "energy_services_equipment", [
    "Oil & Gas Equipment & Services",
    "Oil & Gas Drilling",
  ]),
  map("Energy", "Renewable Energy", "renewable_energy", ["Solar"], "Theme membership should cover non-solar renewables."),
  map("Energy", "Nuclear & Uranium", "nuclear_uranium", ["Uranium"]),
  map("Energy", "Coal", "coal", ["Coal"]),
  map("Utilities", "Electric Utilities", "electric_utilities", ["Regulated Electric"]),
  map("Utilities", "Power Generation & Grid", "power_generation_grid", [
    "Independent Power Producers",
  ]),
  map("Utilities", "Water & Multi-Utilities", "water_multi_utilities", [
    "Regulated Water",
    "Diversified Utilities",
    "General Utilities",
    "Renewable Utilities",
  ]),
  map("Utilities", "Gas Utilities", "gas_utilities", ["Regulated Gas"]),
  map("Basic Materials", "Metals & Mining", "metals_mining", [
    "Steel",
    "Copper",
    "Aluminum",
    "Industrial Materials",
  ]),
  map("Basic Materials", "Precious Metals", "precious_metals", [
    "Gold",
    "Silver",
    "Other Precious Metals",
  ]),
  map("Basic Materials", "Chemicals", "chemicals", ["Chemicals", "Chemicals - Specialty"]),
  map("Basic Materials", "Agricultural Inputs", "agricultural_inputs", [
    "Agricultural Inputs",
    "Agricultural - Commodities/Milling",
  ]),
  map("Basic Materials", "Packaging & Materials", "packaging_materials", [
    "Paper",
    "Lumber & Forest Products",
    "Packaging & Containers",
    "Construction Materials",
  ]),
  map("Real Estate", "REITs", "reits", [
    "REIT - Specialty",
    "REIT - Retail",
    "REIT - Residential",
    "REIT - Office",
    "REIT - Mortgage",
    "REIT - Industrial",
    "REIT - Hotel & Motel",
    "REIT - Healthcare Facilities",
    "REIT - Diversified",
  ]),
  map("Real Estate", "Residential Real Estate", "residential_real_estate", [
    "Real Estate - Development",
    "Real Estate - General",
  ]),
  map("Real Estate", "Commercial Real Estate", "commercial_real_estate", [
    "Real Estate - Diversified",
  ]),
  map("Real Estate", "Industrial & Logistics Real Estate", "industrial_logistics_real_estate", [
    "REIT - Industrial",
  ], "Duplicate FMP industry with REITs; priority rules decide default mapping."),
  map("Real Estate", "Real Estate Services", "real_estate_services", [
    "Real Estate - Services",
  ]),
  map("Other", "Shell / SPAC / Undefined", "shell_spac_undefined", ["Shell Companies"]),
  map("Other", "ETF / Funds / Government / CEF", "etf_funds_government_cef", [], "Use asset_type or instrument_type, not only FMP industry."),
  map("Other", "Education", "education", ["Education & Training Services"]),
];

export const taxonomyStats = {
  sectors: new Set(sectorMappings.map((item) => item.sector)).size,
  subCategories: sectorMappings.length,
  fmpIndustries: sectorMappings.reduce((count, item) => count + item.fmpIndustries.length, 0),
  themeGroups: themeGroups.length,
  implementedThemes: themeGroups.filter((theme) => theme.status === "implemented").length,
};

export const taxonomyCanonicalTables = [
  table("tickers", "Master ticker universe hydrated from FMP and other market-data providers.", [
    col("symbol", "text", "Ticker symbol, primary key", true),
    col("name", "text", "Company or instrument name"),
    col("exchange", "text", "Exchange or venue"),
    col("fmp_sector", "text", "Raw FMP sector"),
    col("fmp_industry", "text", "Raw FMP industry"),
    col("asset_type", "text", "stock, etf, cef, spac, adr, warrant, unit, government, unknown"),
    col("market_cap", "numeric", "Latest market cap from provider"),
    col("is_active", "boolean", "Tradable/watchable flag", true),
    col("last_profiled_at", "timestamptz", "Last profile refresh time"),
    col("metadata", "jsonb", "Provider payload and non-secret classification trace"),
  ]),
  table("market_sectors", "Canonical top-level sector list.", [
    col("code", "text", "Stable sector code", true),
    col("name", "text", "Sector display name", true),
    col("sort_order", "integer", "Admin display order", true),
    col("is_active", "boolean", "Visible and usable flag", true),
  ]),
  table("market_sub_categories", "Sector child buckets used by filters and market-moving views.", [
    col("sector_code", "text", "References market_sectors.code", true),
    col("slug", "text", "Stable sub-category slug", true),
    col("name", "text", "Display name", true),
    col("sort_order", "integer", "Admin display order", true),
    col("is_active", "boolean", "Visible and usable flag", true),
    col("notes", "text", "Mapping caveats"),
  ]),
  table("fmp_industry_mappings", "Rule mapping from FMP industry into the canonical sector tree.", [
    col("id", "uuid", "Primary key", true),
    col("fmp_industry", "text", "Exact FMP industry string", true),
    col("sector_code", "text", "Target sector code", true),
    col("sub_category_slug", "text", "Target sub-category slug", true),
    col("priority", "integer", "Lower number wins when one FMP industry appears more than once", true),
    col("is_primary", "boolean", "Default mapping flag", true),
    col("notes", "text", "Why this mapping exists or why it is ambiguous"),
  ]),
  table("theme_groups", "Cross-sector investment themes such as AI, defense, policy, and momentum.", [
    col("slug", "text", "Stable theme slug, primary key", true),
    col("name", "text", "Display name", true),
    col("status", "text", "implemented or planned", true),
    col("description", "text", "Admin-facing meaning"),
    col("sort_order", "integer", "Admin display order", true),
    col("is_active", "boolean", "Visible and usable flag", true),
  ]),
  table("ticker_classifications", "Current classification for a ticker with room for rule, LLM, and manual override.", [
    col("symbol", "text", "References tickers.symbol", true),
    col("sector_code", "text", "Current canonical sector"),
    col("sub_category_slug", "text", "Current canonical sub-category"),
    col("method", "text", "rule, llm, manual, or unknown", true),
    col("confidence", "numeric", "0 to 1 confidence"),
    col("manual_override", "boolean", "True when admin overrode the automatic result", true),
    col("reason", "text", "Short classification reason"),
    col("updated_at", "timestamptz", "Last classification update", true),
    col("metadata", "jsonb", "Rule hits, LLM trace, and source payload"),
  ]),
  table("ticker_theme_members", "Ticker-to-theme membership for watchlists, rankings, and market-moving views.", [
    col("symbol", "text", "References tickers.symbol", true),
    col("theme_group_slug", "text", "References theme_groups.slug", true),
    col("method", "text", "rule, llm, manual, or unknown", true),
    col("confidence", "numeric", "0 to 1 confidence"),
    col("reason", "text", "Why the ticker belongs to the theme"),
    col("updated_at", "timestamptz", "Last membership update", true),
  ]),
  table("event_theme_links", "Theme links at event level; this is separate from ticker membership.", [
    col("event_id", "uuid", "References events.id", true),
    col("theme_group_slug", "text", "References theme_groups.slug", true),
    col("method", "text", "rule, llm, manual, or unknown", true),
    col("confidence", "numeric", "0 to 1 confidence"),
    col("reason", "text", "Why this event is tied to the theme"),
    col("created_at", "timestamptz", "Creation time", true),
  ]),
  table("theme_snapshots", "Theme-level market context for Market-Moving News.", [
    col("id", "uuid", "Primary key", true),
    col("theme_group_slug", "text", "References theme_groups.slug", true),
    col("as_of", "timestamptz", "Snapshot time", true),
    col("change_pct", "numeric", "Theme or basket percentage change"),
    col("volume_score", "numeric", "Relative volume or activity score"),
    col("event_count", "integer", "Events linked to the theme in the window"),
    col("alert_count", "integer", "Alert-level events linked to the theme in the window"),
    col("top_symbols", "jsonb", "Top symbols and weights"),
    col("metadata", "jsonb", "Provider and calculation trace"),
  ], "later"),
] as const;

function map(
  sector: string,
  subCategory: string,
  slug: string,
  fmpIndustries: string[],
  notes?: string,
): SectorMapping {
  return {
    sector,
    subCategory,
    slug,
    fmpIndustries,
    notes,
  };
}

function table(
  name: string,
  purpose: string,
  columns: Array<{ name: string; type: string; required?: boolean; notes: string }>,
  status: "required" | "later" = "required",
) {
  return {
    name,
    group: "taxonomy" as const,
    status,
    purpose,
    columns,
  };
}

function col(name: string, type: string, notes: string, required = false) {
  return {
    name,
    type,
    notes,
    required,
  };
}
