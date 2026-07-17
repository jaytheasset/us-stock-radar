import { MarketImpactLabel } from "@/components/market/MarketImpactLabel";
import {
  getAlertsV2SignalLabel,
  type AlertsV2Rule,
} from "@/lib/mock/alertsV2Data";
import { AlertsV2EventBadge } from "./AlertsV2EventBadge";
import styles from "./StockRadarAlertsV2.module.css";

export function AlertsV2Rules({
  onDelete,
  onEdit,
  onToggle,
  rules,
}: {
  onDelete: (ruleId: string) => void;
  onEdit: (rule: AlertsV2Rule, opener: HTMLButtonElement) => void;
  onToggle: (ruleId: string) => void;
  rules: readonly AlertsV2Rule[];
}) {
  return (
    <section aria-labelledby="alerts-v2-rules-title" className={styles.modePanel}>
      <header className={styles.modePanelHeader}>
        <div>
          <span>LOCAL RULE SET</span>
          <h2 id="alerts-v2-rules-title">Alert Rules</h2>
          <p>Pause, resume, edit, or remove deterministic mock rules. No preference is saved.</p>
        </div>
        <span>{rules.filter((rule) => rule.enabled).length} active · {rules.length} total</span>
      </header>

      {rules.length ? (
        <div className={styles.ruleList}>
          {rules.map((rule) => (
            <article className={styles.ruleItem} key={rule.id}>
              <label className={styles.ruleSwitch}>
                <input
                  checked={rule.enabled}
                  onChange={() => onToggle(rule.id)}
                  type="checkbox"
                />
                <span aria-hidden="true" />
                <b>{rule.enabled ? "Enabled" : "Paused"}</b>
              </label>

              <div className={styles.ruleIdentity}>
                <strong>{rule.name}</strong>
                <span>{rule.scope}{rule.ticker ? ` · ${rule.ticker}` : ""}</span>
              </div>

              <div className={styles.ruleConditions}>
                <AlertsV2EventBadge eventType={rule.eventType} />
                <MarketImpactLabel impact={rule.minimumImpact} size="compact" />
                <span className={`${styles.signal} ${styles[`signal-${rule.signal}`]}`}>
                  {getAlertsV2SignalLabel(rule.signal)}
                </span>
              </div>

              <div className={styles.ruleDelivery}>
                <span>{rule.channel} preference</span>
                <small>Last matched {rule.lastTriggered}</small>
              </div>

              <div className={styles.ruleActions}>
                <button onClick={(event) => onEdit(rule, event.currentTarget)} type="button">Edit</button>
                <button onClick={() => onToggle(rule.id)} type="button">{rule.enabled ? "Pause" : "Resume"}</button>
                <button onClick={() => onDelete(rule.id)} type="button">Delete</button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className={styles.emptyState}>
          <strong>No mock rules remain.</strong>
          <p>Use Create Alert to add a local-only preset.</p>
        </div>
      )}

      <p className={styles.modeFootnote}>Channel names mirror existing product concepts; this mock sends no web, email, or Telegram notifications.</p>
    </section>
  );
}
