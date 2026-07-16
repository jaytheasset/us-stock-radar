import { RefreshCw, Search } from "lucide-react";
import { IconButton } from "@/components/ui/IconButton";
import type { FilingsV2Sort } from "@/lib/mock/filingsV2Data";
import styles from "./StockRadarFilingsV2.module.css";

type FilingsV2HeaderProps = {
  count: number;
  isRefreshing: boolean;
  lastUpdated: string;
  onQueryChange: (value: string) => void;
  onRefresh: () => void;
  onSortChange: (value: FilingsV2Sort) => void;
  query: string;
  sort: FilingsV2Sort;
};

export function FilingsV2Header({
  count,
  isRefreshing,
  lastUpdated,
  onQueryChange,
  onRefresh,
  onSortChange,
  query,
  sort,
}: FilingsV2HeaderProps) {
  return (
    <header className={styles.pageHeader}>
      <div className={styles.pageHeading}>
        <div className={styles.titleLine}>
          <h1>Filings</h1>
          <span>{count} shown</span>
        </div>
        <p>SEC filing discovery · Mock data updated {lastUpdated}</p>
      </div>

      <div className={styles.headerControls}>
        <label className={styles.searchControl}>
          <Search aria-hidden="true" size={17} />
          <span className={styles.visuallyHidden}>Search filings</span>
          <input
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search filings"
            type="search"
            value={query}
          />
        </label>
        <label className={styles.sortControl}>
          <span>Sort</span>
          <select
            aria-label="Sort filings"
            onChange={(event) => onSortChange(event.target.value as FilingsV2Sort)}
            value={sort}
          >
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
          </select>
        </label>
        <IconButton
          aria-label={isRefreshing ? "Refreshing mock filings" : "Refresh mock filings"}
          disabled={isRefreshing}
          onClick={onRefresh}
        >
          <RefreshCw aria-hidden="true" className={isRefreshing ? styles.spinning : undefined} size={18} />
        </IconButton>
      </div>
    </header>
  );
}
