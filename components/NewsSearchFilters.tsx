"use client";

import { useEffect, useRef, useState } from "react";
import { sectorMappings, themeGroups } from "@/lib/taxonomyRegistry";

const eventTypeOptions = [
  "All",
  "Earnings",
  "Dilution Risk",
  "FDA / Clinical",
  "Product Update",
  "Strategic Transaction",
  "Sales Performance",
  "Leadership / Governance",
  "Dividends",
  "Other",
];

const sourceOptions = [
  "All",
  "Business Wire",
  "GlobeNewswire",
  "PR Newswire",
  "Accesswire",
  "Newsfile",
  "SEC",
  "FDA",
  "OFAC",
  "DOJ",
  "DEA",
  "White House",
];

const sectorOptions = ["All", ...Array.from(new Set(sectorMappings.map((sector) => sector.sector)))];
const themeOptions = ["All", ...themeGroups.map((theme) => theme.name)];
const signalOptions = ["Bullish", "Bearish", "Volatile", "Neutral"];
const capOptions = [
  ["Mega", "$50B+"],
  ["Large", "$10B-$50B"],
  ["Mid", "$1B-$10B"],
  ["Small", "$50M-$1B"],
  ["Micro", "<$50M"],
];

type FilterMenuKey = "Event Type" | "Source" | "Sector" | "Theme";

export function NewsSearchFilters() {
  const [openMenu, setOpenMenu] = useState<FilterMenuKey | null>(null);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Element && !target.closest(".news-filter-disclosure")) {
        setOpenMenu(null);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenMenu(null);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return (
    <section className="news-search-filters" aria-label="News search filters">
      <div className="news-filter-search">
        <span aria-hidden="true">/</span>
        <input aria-label="Search news" placeholder="Search ticker, company, source, or headline" />
      </div>
      <div className="news-filter-controls">
        <div className="news-filter-check-row">
          <span className="filter-row-label">Signal</span>
          <div className="news-checkbox-row">
            {signalOptions.map((option) => (
              <CheckboxPill key={option} label={option} defaultChecked={option === "Bullish"} />
            ))}
          </div>
        </div>
        <div className="news-filter-check-row">
          <span className="filter-row-label">Cap</span>
          <div className="news-checkbox-row">
            {capOptions.map(([label, hint]) => (
              <CheckboxPill key={label} label={label} hint={hint} defaultChecked={label === "Mega"} />
            ))}
          </div>
        </div>
        <div className="news-filter-more-row">
          <span className="filter-row-label">More</span>
          <div className="news-filter-menu-row">
            <FilterMenu label="Event Type" options={eventTypeOptions} openMenu={openMenu} setOpenMenu={setOpenMenu} />
            <FilterMenu label="Source" options={sourceOptions} openMenu={openMenu} setOpenMenu={setOpenMenu} />
            <FilterMenu label="Sector" options={sectorOptions} openMenu={openMenu} setOpenMenu={setOpenMenu} />
            <FilterMenu label="Theme" options={themeOptions} openMenu={openMenu} setOpenMenu={setOpenMenu} />
          </div>
        </div>
        <div className="news-filter-active-row">
          <span className="filter-row-label">Active</span>
          <div className="news-active-chip-row">
            <ActiveChip label="Bullish" tone="bullish" />
            <ActiveChip label="Mega" tone="neutral" />
          </div>
          <div className="news-filter-submit-row">
            <button className="news-filter-reset" type="button">Reset</button>
            <button className="news-filter-search-button" type="button">Search</button>
          </div>
        </div>
      </div>
    </section>
  );
}

function CheckboxPill({
  label,
  hint,
  defaultChecked = false,
}: {
  label: string;
  hint?: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="news-checkbox-pill">
      <input type="checkbox" defaultChecked={defaultChecked} />
      <span>
        <b>{label}</b>
        {hint ? <small>{hint}</small> : null}
      </span>
    </label>
  );
}

function FilterMenu({
  label,
  options,
  openMenu,
  setOpenMenu,
}: {
  label: FilterMenuKey;
  options: string[];
  openMenu: FilterMenuKey | null;
  setOpenMenu: (value: FilterMenuKey | null) => void;
}) {
  const isOpen = openMenu === label;

  return (
    <div className={`news-filter-disclosure${isOpen ? " open" : ""}`}>
      <button
        aria-expanded={isOpen}
        className="news-filter-summary"
        type="button"
        onClick={() => setOpenMenu(isOpen ? null : label)}
      >
        {label}
      </button>
      {isOpen ? (
        <div className="news-filter-menu-panel" aria-label={`${label} filters`}>
          {options.map((option, index) => (
            <button key={`${label}-${index}-${option}`} type="button" onClick={() => setOpenMenu(null)}>
              {option}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ActiveChip({ label, tone }: { label: string; tone: "alert" | "bullish" | "neutral" }) {
  return (
    <button className={`news-active-chip ${tone}`} type="button">
      {label}
      <span aria-hidden="true">x</span>
    </button>
  );
}
