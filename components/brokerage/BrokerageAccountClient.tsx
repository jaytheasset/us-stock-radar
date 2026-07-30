"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  ExternalLink,
  Landmark,
  Link2Off,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import type {
  BrokerageAccountActivities,
  BrokerageAccountOrder,
  BrokerageAccountPositions,
  BrokerageConnectionStatus,
  BrokerageLinkedAccount,
  BrokerageManualRefreshQuota,
  BrokerageManualRefreshResult,
  BrokerageProofCandidate,
  BrokerageProofDisclosure,
  BrokerageProofSummary,
} from "@/lib/brokerage/types";
import { BrokerageProofCard } from "./BrokerageProofCard";
import styles from "./Brokerage.module.css";

export function BrokerageAccountClient({
  initialStatus,
}: {
  initialStatus: BrokerageConnectionStatus;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [candidates, setCandidates] = useState<BrokerageProofCandidate[]>([]);
  const [proofs, setProofs] = useState<BrokerageProofSummary[]>([]);
  const [accounts, setAccounts] = useState<BrokerageLinkedAccount[]>([]);
  const [refreshQuota, setRefreshQuota] =
    useState<BrokerageManualRefreshQuota | null>(null);
  const [refreshPolicyUnavailable, setRefreshPolicyUnavailable] =
    useState(false);
  const [accountData, setAccountData] = useState<{
    account: BrokerageLinkedAccount;
    activities: BrokerageAccountActivities;
    orders: BrokerageAccountOrder[];
    positions: BrokerageAccountPositions;
  } | null>(null);
  const [selectedCandidate, setSelectedCandidate] = useState("");
  const [publicConsent, setPublicConsent] = useState(false);
  const [disclosure, setDisclosure] = useState<BrokerageProofDisclosure>({});
  const [notice, setNotice] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("connection") === "returned") {
      void runAction("sync");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!status.connected) return;
    void Promise.all([
      requestJson<BrokerageLinkedAccount[]>("/api/account/brokerage/accounts"),
      status.publicProofsEnabled
        ? requestJson<BrokerageProofCandidate[]>("/api/account/brokerage/candidates")
        : Promise.resolve([]),
      requestJson<BrokerageProofSummary[]>("/api/account/brokerage/proofs"),
      requestJson<BrokerageManualRefreshQuota>(
        "/api/account/brokerage/refresh-quota",
      )
        .then((value) => {
          setRefreshPolicyUnavailable(false);
          return value;
        })
        .catch(() => {
          setRefreshPolicyUnavailable(true);
          return null;
        }),
    ]).then(([nextAccounts, nextCandidates, nextProofs, nextRefreshQuota]) => {
      setAccounts(nextAccounts);
      setCandidates(nextCandidates);
      setProofs(nextProofs);
      setRefreshQuota(nextRefreshQuota);
    }).catch(() => setNotice("Linked records could not be loaded."));
  }, [status.connected]);

  function runAction(action: "accept_terms" | "sync" | "disconnect") {
    startTransition(async () => {
      try {
        const next = await requestJson<BrokerageConnectionStatus>(
          "/api/account/brokerage",
          { method: "POST", body: JSON.stringify({ action }) },
        );
        setStatus(next);
        setNotice(
          action === "disconnect"
            ? "Brokerage disconnected. Existing cards are historical snapshots."
            : action === "sync"
              ? "Connection checked."
              : "Terms accepted.",
        );
        if (action === "sync" && next.connected) {
          const [nextAccounts, nextRefreshQuota] = await Promise.all([
            requestJson<BrokerageLinkedAccount[]>(
              "/api/account/brokerage/accounts",
            ),
            requestJson<BrokerageManualRefreshQuota>(
              "/api/account/brokerage/refresh-quota",
            )
              .then((value) => {
                setRefreshPolicyUnavailable(false);
                return value;
              })
              .catch(() => {
                setRefreshPolicyUnavailable(true);
                return null;
              }),
          ]);
          setAccounts(nextAccounts);
          setRefreshQuota(nextRefreshQuota);
        }
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "The request failed.");
      }
    });
  }

  function loadAccountData(accountId: string) {
    startTransition(async () => {
      try {
        const path = `/api/account/brokerage/accounts/${encodeURIComponent(accountId)}`;
        const [account, positions, orders, activities] = await Promise.all([
          requestJson<BrokerageLinkedAccount>(path),
          requestJson<BrokerageAccountPositions>(`${path}/positions`),
          requestJson<BrokerageAccountOrder[]>(`${path}/orders`),
          requestJson<BrokerageAccountActivities>(
            `${path}/activities?limit=25&offset=0`,
          ),
        ]);
        setAccountData({ account, activities, orders, positions });
        setNotice("Private brokerage data loaded.");
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "Brokerage account data could not be loaded.",
        );
      }
    });
  }

  function refreshAccount(accountId: string) {
    startTransition(async () => {
      try {
        const result = await requestJson<BrokerageManualRefreshResult>(
          `/api/account/brokerage/accounts/${encodeURIComponent(accountId)}/refresh`,
          { method: "POST" },
        );
        setRefreshQuota(result.quota);
        setRefreshPolicyUnavailable(false);
        setNotice(
          result.status === "realtime"
            ? "This connection already returns real-time data. No manual refresh was charged."
            : result.status === "succeeded"
              ? "Sandbox brokerage data refreshed successfully."
              : "Refresh scheduled. The monthly count changes only after every account sync succeeds.",
        );
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "Brokerage data could not be refreshed.",
        );
      }
    });
  }

  function openPortal() {
    startTransition(async () => {
      try {
        const data = await requestJson<{ url: string }>(
          "/api/account/brokerage/portal",
          { method: "POST" },
        );
        window.location.assign(data.url);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Connection Portal is unavailable.");
      }
    });
  }

  function createProof() {
    startTransition(async () => {
      try {
        const proof = await requestJson<BrokerageProofSummary>(
          "/api/account/brokerage/proofs",
          {
            method: "POST",
            body: JSON.stringify({
              candidateId: selectedCandidate,
              disclosure,
              publicConsent,
            }),
          },
        );
        setProofs((current) => [proof, ...current.filter((item) => item.id !== proof.id)]);
        setNotice("Broker-linked proof created.");
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Proof creation failed.");
      }
    });
  }

  return (
    <section className={styles.page}>
      <header className={styles.heading}>
        <span className={styles.eyebrow}>Account</span>
        <h1>Brokerage verification</h1>
        <p>
          Connect through SnapTrade&apos;s read-only portal. Stock Radar never asks for or stores your brokerage password, account number, or full balance.
        </p>
      </header>

      <div className={styles.grid}>
        <article className={styles.panel}>
          <div className={styles.panelHeading}>
            <Landmark aria-hidden="true" size={19} />
            <h2>Brokerage connected data</h2>
            <span className={styles.state}>{readStatusLabel(status)}</span>
          </div>

          {!status.canConnect ? (
            <div className={styles.message}>
              <strong>Pro plan required</strong>
              <p>Your current plan is {status.effectivePlan}. Compare Pro, Advanced, and Ultimate access.</p>
              <Link href="/premium">View Premium plans</Link>
            </div>
          ) : status.status === "not_configured" ? (
            <div className={styles.message}>
              <strong>Not configured</strong>
              <p>SnapTrade credentials are not configured for this environment. The rest of Stock Radar remains available.</p>
            </div>
          ) : status.status === "credentials_reset_required" ? (
            <div className={styles.message}>
              <strong>Sandbox registration reset required</strong>
              <p>
                This account has credentials encrypted with an older local key.
                Remove the old sandbox registration through the authorized QA
                cleanup flow, then connect again.
              </p>
            </div>
          ) : !status.termsAccepted ? (
            <div className={styles.message}>
              <strong>SnapTrade End User Terms</strong>
              <p>Review and accept the provider terms before opening the read-only Connection Portal.</p>
              <label className={styles.check}>
                <input
                  checked={termsAccepted}
                  onChange={(event) => setTermsAccepted(event.target.checked)}
                  type="checkbox"
                />
                I agree to the SnapTrade End User Terms.
              </label>
              <button disabled={!termsAccepted || pending} onClick={() => runAction("accept_terms")} type="button">
                Agree and continue
              </button>
            </div>
          ) : (
            <div className={styles.actions}>
              <button disabled={pending} onClick={openPortal} type="button">
                <ExternalLink aria-hidden="true" size={16} />
                {status.connected ? "Reconnect account" : "Connect account"}
              </button>
              <button disabled={pending} onClick={() => runAction("sync")} type="button">Check connection</button>
              {status.connected ? (
                <button disabled={pending} onClick={() => runAction("disconnect")} type="button">
                  <Link2Off aria-hidden="true" size={16} /> Disconnect
                </button>
              ) : null}
            </div>
          )}

          {status.accountTypes.length ? (
            <div className={styles.accountTypes}>
              {status.accountTypes.map((type) => (
                <span data-account-type={type} key={type}>
                  {type === "paper" ? "Paper account" : "Live account"}
                </span>
              ))}
            </div>
          ) : null}
          {notice ? <p aria-live="polite" className={styles.notice}>{notice}</p> : null}
        </article>

        <article className={styles.panel}>
          <div className={styles.panelHeading}>
            <ShieldCheck aria-hidden="true" size={19} />
            <h2>Proof privacy</h2>
          </div>
          <p className={styles.copy}>
            Position cards disclose ticker, LONG/SHORT, time, account type, and current/historical status. Execution cards disclose ticker, BUY/SELL, date, provisional/final, and account type. Units, cost, price, quantity, and broker stay hidden unless you opt in.
          </p>
          {!status.publicProofsEnabled ? (
            <p className={styles.pendingApproval}>Public sharing pending approval.</p>
          ) : status.connected ? (
            <div className={styles.proofForm}>
              <label>
                Linked record
                <select value={selectedCandidate} onChange={(event) => setSelectedCandidate(event.target.value)}>
                  <option value="">Choose a current position or filled execution</option>
                  {candidates.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.kind === "position" ? "Position" : "Execution"} · {candidate.ticker} · {candidate.side} · {candidate.accountType === "paper" ? "Paper" : "Live"}
                    </option>
                  ))}
                </select>
              </label>
              <fieldset>
                <legend>Optional public fields</legend>
                {(["units", "averageCost", "executionPrice", "executionQuantity", "brokerName"] as const).map((key) => (
                  <label className={styles.check} key={key}>
                    <input
                      checked={disclosure[key] === true}
                      onChange={(event) => setDisclosure((current) => ({ ...current, [key]: event.target.checked }))}
                      type="checkbox"
                    />
                    {readDisclosureLabel(key)}
                  </label>
                ))}
              </fieldset>
              <label className={styles.check}>
                <input checked={publicConsent} onChange={(event) => setPublicConsent(event.target.checked)} type="checkbox" />
                I consent to publishing only the fields selected above.
              </label>
              <button disabled={!selectedCandidate || !publicConsent || pending} onClick={createProof} type="button">
                <CheckCircle2 aria-hidden="true" size={16} /> Create proof
              </button>
            </div>
          ) : null}
        </article>
      </div>

      {status.connected ? (
        <section className={`${styles.panel} ${styles.accountsPanel}`}>
          <div className={styles.panelHeading}>
            <Landmark aria-hidden="true" size={19} />
            <h2>Connected brokerage accounts</h2>
            <span className={styles.state}>{accounts.length} account{accounts.length === 1 ? "" : "s"}</span>
          </div>
          {refreshQuota ? (
            <div className={styles.refreshPolicy}>
              <div>
                <strong>
                  {refreshQuota.remaining} of {refreshQuota.monthlyLimit} manual
                  refreshes remaining
                </strong>
                <span>
                  {refreshQuota.pending
                    ? `${refreshQuota.pending} pending · `
                    : ""}
                  Successful refreshes only · resets{" "}
                  {formatShortDate(refreshQuota.resetAt)}
                </span>
              </div>
              <p>
                One refresh updates every account in that brokerage connection.
                A 10-minute cooldown prevents repeat charges. Daily automatic
                sync continues after the monthly limit is reached.
              </p>
            </div>
          ) : refreshPolicyUnavailable ? (
            <div className={styles.refreshPolicy}>
              <div>
                <strong>Manual refresh unavailable</strong>
                <span>The usage policy could not be loaded.</span>
              </div>
              <p>
                Connection checks and private cached data remain available.
                Refresh data stays disabled until the refresh policy is
                available.
              </p>
            </div>
          ) : null}
          {accounts.length ? (
            <div className={styles.accountList}>
              {accounts.map((account) => (
                <article className={styles.accountRow} key={account.id}>
                  {(() => {
                    const refreshState =
                      refreshQuota?.accountStates[account.id] || null;
                    return (
                      <>
                  <div className={styles.accountIdentity}>
                    <strong>{account.name}</strong>
                    <span>{account.brokerName} · {account.maskedNumber || "Number hidden"}</span>
                  </div>
                  <div className={styles.accountMeta}>
                    <span data-account-type={account.isPaper ? "paper" : "live"}>
                      {account.isPaper ? "Paper" : "Live"}
                    </span>
                    <span>{account.connectionStatus === "disabled" ? "Connection disabled" : "Connected"}</span>
                    <span>{readSyncLabel(account)}</span>
                  </div>
                  <div className={styles.accountActions}>
                    <button
                      disabled={pending}
                      onClick={() => loadAccountData(account.id)}
                      type="button"
                    >
                      View data
                    </button>
                    <button
                      disabled={pending || !refreshState?.canRefresh}
                      onClick={() => refreshAccount(account.id)}
                      title={readRefreshHelp(
                        refreshState,
                        refreshPolicyUnavailable,
                      )}
                      type="button"
                    >
                      <RefreshCw aria-hidden="true" size={15} />
                      {readRefreshButtonLabel(refreshState)}
                    </button>
                  </div>
                      </>
                    );
                  })()}
                </article>
              ))}
            </div>
          ) : (
            <p className={styles.copy}>No connected accounts were returned.</p>
          )}

          {accountData ? (
            <div className={styles.accountDataPanel}>
              <header>
                <div>
                  <span className={styles.eyebrow}>Private test data</span>
                  <h3>{accountData.account.name}</h3>
                </div>
                <span data-account-type={accountData.account.isPaper ? "paper" : "live"}>
                  {accountData.account.isPaper ? "Paper account" : "Live account"}
                </span>
              </header>
              <dl className={styles.accountDetails}>
                <div><dt>Broker</dt><dd>{accountData.account.brokerName}</dd></div>
                <div><dt>Type</dt><dd>{accountData.account.rawType || "Not provided"}</dd></div>
                <div><dt>Status</dt><dd>{accountData.account.accountStatus}</dd></div>
                <div><dt>Positions as of</dt><dd>{formatDate(accountData.positions.asOf)}</dd></div>
              </dl>
              <AccountDataTable
                columns={["Ticker", "Asset", "Side", "Units", "Cost basis"]}
                empty="No positions returned."
                rows={accountData.positions.positions.map((position) => [
                  position.ticker,
                  position.assetType,
                  position.side,
                  formatNumber(position.units),
                  formatNumber(position.costBasis, position.currency),
                ])}
                title={`Positions (${accountData.positions.positions.length})`}
              />
              <AccountDataTable
                columns={["Ticker", "Action", "Status", "Filled", "Execution"]}
                empty="No recent orders returned."
                rows={accountData.orders.map((order) => [
                  order.ticker,
                  order.action,
                  order.status,
                  formatNumber(order.filledQuantity),
                  formatNumber(order.executionPrice),
                ])}
                title={`Orders (${accountData.orders.length})`}
              />
              <AccountDataTable
                columns={["Date", "Ticker", "Type", "Units", "Price"]}
                empty="No activities returned."
                rows={accountData.activities.activities.map((activity) => [
                  formatDate(activity.tradeDate),
                  activity.ticker || "—",
                  activity.type,
                  formatNumber(activity.units),
                  formatNumber(activity.price, activity.currency),
                ])}
                title={`Activities (${accountData.activities.activities.length})`}
              />
            </div>
          ) : null}
        </section>
      ) : null}

      {proofs.length ? (
        <section className={styles.proofs}>
          <h2>Your brokerage proofs</h2>
          <div>{proofs.map((proof) => <BrokerageProofCard key={proof.id} proof={proof} />)}</div>
        </section>
      ) : null}
    </section>
  );
}

async function requestJson<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "The request failed.");
  return payload.data as T;
}

function readStatusLabel(status: BrokerageConnectionStatus) {
  if (status.status === "connected") return "Brokerage connected";
  if (status.status === "upgrade_required") return "Upgrade required";
  if (status.status === "not_configured") return "Not configured";
  if (status.status === "credentials_reset_required") return "Reset required";
  return status.status === "disconnected" ? "Disconnected" : "Not connected";
}

function readSyncLabel(account: BrokerageLinkedAccount) {
  if (account.holdingsSync === "unavailable") return "Holdings unavailable";
  if (account.holdingsSync === "syncing" || account.transactionsSync === "syncing") {
    return "Syncing";
  }
  return account.holdingsSync === "ready" ? "Synced" : "Sync unknown";
}

function AccountDataTable({
  columns,
  empty,
  rows,
  title,
}: {
  columns: string[];
  empty: string;
  rows: string[][];
  title: string;
}) {
  return (
    <section className={styles.dataTable}>
      <h4>{title}</h4>
      {rows.length ? (
        <div>
          <table>
            <thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={`${title}-${rowIndex}`}>
                  {row.map((value, columnIndex) => (
                    <td key={`${rowIndex}-${columns[columnIndex]}`}>{value}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p>{empty}</p>}
    </section>
  );
}

function formatDate(value: string | null) {
  if (!value) return "Not available";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function formatShortDate(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatNumber(value: number | null, currency?: string | null) {
  if (value === null) return "—";
  const formatted = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 4,
  }).format(value);
  return currency ? `${formatted} ${currency}` : formatted;
}

function readDisclosureLabel(key: keyof BrokerageProofDisclosure) {
  return ({
    averageCost: "Average cost",
    brokerName: "Broker name",
    executionPrice: "Execution price",
    executionQuantity: "Execution quantity",
    units: "Units",
  } as const)[key];
}

function readRefreshButtonLabel(
  state: BrokerageManualRefreshQuota["accountStates"][string] | null,
) {
  if (!state) return "Refresh data";
  if (state.status === "realtime") return "Real-time";
  if (state.status === "pending") return "Refresh pending";
  if (state.status === "quota_exhausted") return "Monthly limit used";
  if (state.status === "cooldown") {
    return `Retry in ${Math.max(1, Math.ceil(state.retryAfterSeconds / 60))}m`;
  }
  if (state.status === "unavailable") return "Refresh unavailable";
  return "Refresh data";
}

function readRefreshHelp(
  state: BrokerageManualRefreshQuota["accountStates"][string] | null,
  policyUnavailable = false,
) {
  if (!state) {
    return policyUnavailable
      ? "Manual refresh is disabled because the usage policy is unavailable."
      : "Refresh policy is loading.";
  }
  if (state.status === "realtime") {
    return "Real-time connections update when data is requested.";
  }
  if (state.status === "pending") {
    return "SnapTrade is completing the requested holdings sync.";
  }
  if (state.status === "quota_exhausted") {
    return "Wait for the next daily automatic sync or the monthly reset.";
  }
  if (state.status === "cooldown") {
    return "This connection can be refreshed again after the 10-minute cooldown.";
  }
  if (state.status === "unavailable") {
    return "The connection data mode is not available yet.";
  }
  return "Refresh every account under this brokerage connection.";
}
