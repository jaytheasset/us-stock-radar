type SegmentedTabsProps = {
  active: string;
  ariaLabel: string;
  items: readonly string[];
  onSelect?: (item: string) => void;
  variant?: "primary" | "session";
};

export function SegmentedTabs({
  active,
  ariaLabel,
  items,
  onSelect,
  variant = "primary",
}: SegmentedTabsProps) {
  return (
    <div
      className={`dashboard-v2-tabs dashboard-v2-tabs-${variant}`}
      role="tablist"
      aria-label={ariaLabel}
    >
      {items.map((item) => {
        const isActive = item === active;
        return (
          <button
            aria-selected={isActive}
            className={isActive ? "is-active" : undefined}
            key={item}
            onClick={() => onSelect?.(item)}
            role="tab"
            type="button"
          >
            {item.toUpperCase()}
          </button>
        );
      })}
    </div>
  );
}
