import type { RefObject } from "react";
import { BottomSheetShell } from "@/components/ui/BottomSheetShell";
import { FilterOption } from "@/components/ui/FilterOption";
import {
  alertsV2EventOptions,
  alertsV2ImpactOptions,
  alertsV2ScopeOptions,
  alertsV2StatusOptions,
  type AlertsV2FilterState,
} from "@/lib/mock/alertsV2Data";
import type { AlertsV2FilterKey } from "./AlertsV2FilterBar";
import styles from "./StockRadarAlertsV2.module.css";

export function MobileAlertsV2FilterSheet({
  filters,
  isOpen,
  onChange,
  onClear,
  onClose,
  openerRef,
}: {
  filters: AlertsV2FilterState;
  isOpen: boolean;
  onChange: <Key extends AlertsV2FilterKey>(key: Key, value: AlertsV2FilterState[Key]) => void;
  onClear: () => void;
  onClose: () => void;
  openerRef: RefObject<HTMLElement | null>;
}) {
  const sections = [
    { key: "status", label: "Status", options: alertsV2StatusOptions },
    { key: "impact", label: "Impact", options: alertsV2ImpactOptions },
    { key: "eventType", label: "Event Type", options: alertsV2EventOptions },
    { key: "scope", label: "Scope", options: alertsV2ScopeOptions },
  ] as const;

  return (
    <BottomSheetShell
      aria-labelledby="alerts-v2-filter-title"
      closeLabel="Close alert filters"
      id="alerts-v2-filter-sheet"
      isOpen={isOpen}
      layout="content-footer"
      onDismiss={onClose}
      openerRef={openerRef}
      overlayLabel="Close alert filters"
    >
      <header className={styles.filterSheetHeader}>
        <h2 id="alerts-v2-filter-title">Alert Filters</h2>
        <p>Local filtering only</p>
      </header>
      <div className={styles.filterSheetContent}>
        {sections.map((section) => (
          <section className={styles.filterSheetSection} key={section.key}>
            <h3>{section.label}</h3>
            <div aria-label={`${section.label} options`} className={styles.filterSheetOptions} role="group">
              {section.options.map((option) => (
                <FilterOption
                  key={option.value}
                  label={option.label}
                  onClick={() => onChange(
                    section.key,
                    option.value as AlertsV2FilterState[typeof section.key],
                  )}
                  selected={filters[section.key] === option.value}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
      <footer className={styles.filterSheetFooter}>
        <button className={styles.secondaryAction} onClick={onClear} type="button">Clear all</button>
        <button className={styles.primaryAction} onClick={onClose} type="button">Apply filters</button>
      </footer>
    </BottomSheetShell>
  );
}
