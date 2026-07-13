import { ChevronLeft, ChevronRight } from "lucide-react";
import styles from "./Pagination.module.css";

export type PaginationItem = number | "ellipsis";

export type PaginationProps = {
  ariaLabel?: string;
  currentPage: number;
  items: readonly PaginationItem[];
  onPageChange: (page: number) => void;
  totalPages: number;
};

export function Pagination({
  ariaLabel = "Pagination",
  currentPage,
  items,
  onPageChange,
  totalPages,
}: PaginationProps) {
  const requestPage = (page: number) => {
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      page > totalPages ||
      page === currentPage
    ) {
      return;
    }

    onPageChange(page);
  };

  return (
    <nav aria-label={ariaLabel} className={styles.pagination}>
      <button
        aria-label="Previous page"
        disabled={currentPage === 1}
        onClick={() => requestPage(currentPage - 1)}
        type="button"
      >
        <ChevronLeft aria-hidden="true" size={15} />
      </button>
      {items.map((item) => {
        if (item === "ellipsis") {
          return <span key={item}>...</span>;
        }

        const isCurrent = item === currentPage;
        return (
          <button
            aria-current={isCurrent ? "page" : undefined}
            aria-label={isCurrent ? `Page ${item}, current page` : `Page ${item}`}
            key={item}
            onClick={() => requestPage(item)}
            type="button"
          >
            {item}
          </button>
        );
      })}
      <button
        aria-label="Next page"
        disabled={currentPage === totalPages}
        onClick={() => requestPage(currentPage + 1)}
        type="button"
      >
        <ChevronRight aria-hidden="true" size={15} />
      </button>
    </nav>
  );
}
