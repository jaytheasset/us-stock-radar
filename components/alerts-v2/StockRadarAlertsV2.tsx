"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  SegmentedControl,
  type SegmentedControlItem,
} from "@/components/ui/SegmentedControl";
import {
  alertsV2Alerts,
  alertsV2DefaultFilters,
  alertsV2HistoryAlerts,
  alertsV2Modes,
  alertsV2Rules,
  type AlertsV2Alert,
  type AlertsV2FilterState,
  type AlertsV2Mode,
  type AlertsV2Rule,
} from "@/lib/mock/alertsV2Data";
import { AlertsV2DetailPanel, MobileAlertsV2DetailSheet } from "./AlertsV2Detail";
import { AlertsV2FilterBar, type AlertsV2FilterKey } from "./AlertsV2FilterBar";
import { AlertsV2Header } from "./AlertsV2Header";
import { AlertsV2History } from "./AlertsV2History";
import { AlertsV2List } from "./AlertsV2List";
import { AlertsV2Rules } from "./AlertsV2Rules";
import { AlertsV2Summary } from "./AlertsV2Summary";
import { CreateAlertSheet, type AlertsV2RuleDraft } from "./CreateAlertSheet";
import { MobileAlertsV2FilterSheet } from "./MobileAlertsV2FilterSheet";
import styles from "./StockRadarAlertsV2.module.css";

const modeItems: readonly SegmentedControlItem<AlertsV2Mode>[] = alertsV2Modes.map((mode) => ({
  label: mode.toUpperCase(),
  value: mode,
}));

export function StockRadarAlertsV2() {
  const [mode, setMode] = useState<AlertsV2Mode>("Alert Feed");
  const [alerts, setAlerts] = useState<AlertsV2Alert[]>(() => alertsV2Alerts.map((alert) => ({ ...alert })));
  const [rules, setRules] = useState<AlertsV2Rule[]>(() => alertsV2Rules.map((rule) => ({ ...rule })));
  const [filters, setFilters] = useState<AlertsV2FilterState>({ ...alertsV2DefaultFilters });
  const [selectedAlertId, setSelectedAlertId] = useState(alertsV2Alerts[0]?.id ?? "");
  const [activeFilterPopover, setActiveFilterPopover] = useState<AlertsV2FilterKey | null>(null);
  const [isMobileDetailOpen, setIsMobileDetailOpen] = useState(false);
  const [isMobileFilterOpen, setIsMobileFilterOpen] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | undefined>();
  const [historyPage, setHistoryPage] = useState(1);
  const [isMobile, setIsMobile] = useState(false);
  const detailOpenerRef = useRef<HTMLElement>(null);
  const filterOpenerRef = useRef<HTMLElement>(null);
  const createOpenerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 760px)");
    const updateViewport = () => setIsMobile(mediaQuery.matches);
    updateViewport();
    mediaQuery.addEventListener("change", updateViewport);
    return () => mediaQuery.removeEventListener("change", updateViewport);
  }, []);

  useEffect(() => {
    if (!activeFilterPopover) {
      return;
    }

    const closeOnOutsidePointer = (event: PointerEvent) => {
      const filterArea = document.querySelector("[data-alerts-v2-filter-area]");
      if (event.target instanceof Node && !filterArea?.contains(event.target)) {
        setActiveFilterPopover(null);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setActiveFilterPopover(null);
      }
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [activeFilterPopover]);

  const filteredAlerts = useMemo(() => alerts.filter((alert) => {
    if (filters.status === "unread" && !alert.unread) return false;
    if (filters.status === "read" && alert.unread) return false;
    if (filters.impact !== "all" && alert.impact !== filters.impact) return false;
    if (filters.eventType !== "all" && alert.eventType !== filters.eventType) return false;
    if (filters.scope !== "all" && alert.scope !== filters.scope) return false;
    return true;
  }), [alerts, filters]);

  const allDetailAlerts = useMemo(
    () => [...alerts, ...alertsV2HistoryAlerts],
    [alerts],
  );
  const selectedAlert = allDetailAlerts.find((alert) => alert.id === selectedAlertId)
    ?? filteredAlerts[0]
    ?? alerts[0];
  const editingRule = rules.find((rule) => rule.id === editingRuleId);
  const unreadCount = alerts.filter((alert) => alert.unread).length;

  const updateFilter = useCallback(<Key extends AlertsV2FilterKey>(
    key: Key,
    value: AlertsV2FilterState[Key],
  ) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setActiveFilterPopover(null);
  }, []);

  const selectAlert = useCallback((alert: AlertsV2Alert, opener: HTMLElement) => {
    detailOpenerRef.current = opener;
    setSelectedAlertId(alert.id);
    setAlerts((current) => current.map((item) => item.id === alert.id ? { ...item, unread: false } : item));

    if (window.matchMedia("(max-width: 760px)").matches) {
      setIsMobileFilterOpen(false);
      setIsCreateOpen(false);
      setIsMobileDetailOpen(true);
    }
  }, []);

  const toggleRead = useCallback((alertId: string) => {
    setAlerts((current) => current.map((alert) => alert.id === alertId ? { ...alert, unread: !alert.unread } : alert));
  }, []);

  const openFilters = useCallback((opener: HTMLButtonElement) => {
    filterOpenerRef.current = opener;
    setActiveFilterPopover(null);
    setIsMobileDetailOpen(false);
    setIsCreateOpen(false);
    setIsMobileFilterOpen(true);
  }, []);

  const openCreate = useCallback((opener: HTMLElement, ruleId?: string) => {
    createOpenerRef.current = opener;
    setEditingRuleId(ruleId);
    setIsMobileDetailOpen(false);
    setIsMobileFilterOpen(false);
    setIsCreateOpen(true);
  }, []);

  const saveRule = useCallback((draft: AlertsV2RuleDraft, editingId?: string) => {
    setRules((current) => {
      if (editingId) {
        return current.map((rule) => rule.id === editingId ? { ...rule, ...draft } : rule);
      }

      const slug = draft.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "mock-rule";
      return [
        ...current,
        {
          ...draft,
          enabled: true,
          id: `rule-local-${slug}-${current.length + 1}`,
          lastTriggered: "Not triggered in local mock",
        },
      ];
    });
    setIsCreateOpen(false);
    setEditingRuleId(undefined);
    setMode("Rules");
  }, []);

  return (
    <div className={styles.root}>
      <AlertsV2Header
        onCreateAlert={(opener) => openCreate(opener)}
        onMarkAllRead={() => setAlerts((current) => current.map((alert) => ({ ...alert, unread: false })))}
        unreadCount={unreadCount}
      />
      <AlertsV2Summary alerts={alerts} />

      <div className={styles.modeBar}>
        <SegmentedControl
          ariaLabel="Alerts view"
          className={styles.modeControl}
          items={modeItems}
          onValueChange={(nextMode) => {
            setMode(nextMode);
            setActiveFilterPopover(null);
          }}
          value={mode}
        />
        <span>{mode === "Alert Feed" ? `${filteredAlerts.length} matched alerts` : mode === "Rules" ? `${rules.length} local rules` : `${alertsV2HistoryAlerts.length} history items`}</span>
      </div>

      {mode === "Alert Feed" ? (
        <>
          <div data-alerts-v2-filter-area>
            <AlertsV2FilterBar
              activePopover={activeFilterPopover}
              filters={filters}
              isMobileFilterOpen={isMobileFilterOpen}
              onChange={updateFilter}
              onClear={() => setFilters({ ...alertsV2DefaultFilters })}
              onMobileFiltersOpen={openFilters}
              onTogglePopover={(key) => setActiveFilterPopover((current) => current === key ? null : key)}
            />
          </div>
          <div className={styles.feedWorkspace}>
            <section aria-label="Alert feed" className={styles.feedPanel}>
              <AlertsV2List alerts={filteredAlerts} onSelect={selectAlert} selectedId={selectedAlert?.id} />
            </section>
            <AlertsV2DetailPanel alert={selectedAlert} onToggleRead={toggleRead} />
          </div>
        </>
      ) : null}

      {mode === "Rules" ? (
        <AlertsV2Rules
          onDelete={(ruleId) => setRules((current) => current.filter((rule) => rule.id !== ruleId))}
          onEdit={(rule, opener) => openCreate(opener, rule.id)}
          onToggle={(ruleId) => setRules((current) => current.map((rule) => rule.id === ruleId ? { ...rule, enabled: !rule.enabled } : rule))}
          rules={rules}
        />
      ) : null}

      {mode === "History" ? (
        <AlertsV2History
          alerts={alertsV2HistoryAlerts}
          currentPage={historyPage}
          onPageChange={setHistoryPage}
          onSelect={selectAlert}
        />
      ) : null}

      <MobileAlertsV2DetailSheet
        alert={selectedAlert}
        isOpen={isMobileDetailOpen}
        onClose={() => setIsMobileDetailOpen(false)}
        onToggleRead={toggleRead}
        openerRef={detailOpenerRef}
      />
      <MobileAlertsV2FilterSheet
        filters={filters}
        isOpen={isMobileFilterOpen}
        onChange={updateFilter}
        onClear={() => setFilters({ ...alertsV2DefaultFilters })}
        onClose={() => setIsMobileFilterOpen(false)}
        openerRef={filterOpenerRef}
      />
      <CreateAlertSheet
        editingRule={editingRule}
        isMobile={isMobile}
        isOpen={isCreateOpen}
        onClose={() => {
          setIsCreateOpen(false);
          setEditingRuleId(undefined);
        }}
        onSubmit={saveRule}
        openerRef={createOpenerRef}
      />
    </div>
  );
}
