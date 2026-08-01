"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { AdminTelegramCampaign } from "@/lib/admin/telegramCampaigns";
import {
  ADMIN_TELEGRAM_NOTICE_TYPES,
  buildAdminTelegramCampaignPresentation,
  campaignStatusLabel,
  formatEtDateTime,
  normalizeAdminTelegramCampaignContent,
  noticeTypeLabel,
  utcToEtLocalDateTime,
} from "@/lib/admin/telegramCampaignPolicy";
import styles from "./AdminTelegramCampaign.module.css";

type EditorFields = {
  noticeType: string;
  title: string;
  body: string;
  ticker: string;
  sourceLabel: string;
  sourceUrl: string;
  analysisUrl: string;
  liveRoomUrl: string;
};

type ApiPayload = {
  ok?: boolean;
  data?: {
    campaign?: AdminTelegramCampaign;
    delivery?: { action?: string; error?: string };
    draft?: { title?: string; body?: string; recommendedCtas?: string[] };
  };
  error?: { message?: string };
};

export function AdminTelegramCampaignEditor({
  baseUrl,
  initialCampaign,
}: {
  baseUrl: string;
  initialCampaign: AdminTelegramCampaign | null;
}) {
  const router = useRouter();
  const [campaign, setCampaign] = useState(initialCampaign);
  const [fields, setFields] = useState<EditorFields>(() => fieldsFrom(initialCampaign));
  const [reason, setReason] = useState("");
  const [scheduledForEt, setScheduledForEt] = useState(() =>
    utcToEtLocalDateTime(initialCampaign?.scheduledFor),
  );
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const editable = !campaign || campaign.status === "draft" || campaign.status === "scheduled";
  const canSend =
    campaign?.status === "draft" ||
    (campaign?.status === "failed" && campaign.retryAllowed);
  const canCancel = campaign?.status === "scheduled";
  const preview = useMemo(() => {
    try {
      const content = normalizeAdminTelegramCampaignContent(fields, { baseUrl });
      return {
        presentation: buildAdminTelegramCampaignPresentation(content, { baseUrl }),
        error: "",
      };
    } catch (previewError) {
      return {
        presentation: null,
        error:
          previewError instanceof Error
            ? humanizePolicyCode(previewError.message)
            : "Complete the campaign content to preview it.",
      };
    }
  }, [baseUrl, fields]);

  function updateField(name: keyof EditorFields, value: string) {
    setFields((current) => ({ ...current, [name]: value }));
  }

  async function persistCampaign() {
    requireReason();
    const response = campaign
      ? await callApi(`/api/admin/telegram-campaigns/${campaign.id}`, {
          action: "save",
          content: fields,
          expectedVersion: campaign.version,
          reason,
        })
      : await callApi("/api/admin/telegram-campaigns", {
          content: fields,
          reason,
        }, "POST");
    const saved = response.data?.campaign;
    if (!saved) throw new Error("Campaign save returned no record.");
    setCampaign(saved);
    setSuccess("Draft saved. No Telegram message was sent.");
    if (!campaign) {
      router.replace(`/admin/telegram-channel/${saved.id}`);
    }
    return saved;
  }

  async function save() {
    await run("save", async () => {
      await persistCampaign();
    });
  }

  async function schedule() {
    await run("schedule", async () => {
      if (!scheduledForEt) throw new Error("Choose a future time in ET.");
      const saved = await persistCampaign();
      const response = await callApi(
        `/api/admin/telegram-campaigns/${saved.id}`,
        {
          action: "schedule",
          expectedVersion: saved.version,
          reason,
          scheduledForEt,
        },
      );
      const scheduled = response.data?.campaign;
      if (!scheduled) throw new Error("Campaign schedule returned no record.");
      setCampaign(scheduled);
      setSuccess(`Scheduled for ${formatEtDateTime(scheduled.scheduledFor)}.`);
      router.refresh();
    });
  }

  async function cancel() {
    if (!campaign) return;
    await run("cancel", async () => {
      requireReason();
      if (!window.confirm("Cancel this unsent scheduled campaign?")) return;
      const response = await callApi(
        `/api/admin/telegram-campaigns/${campaign.id}`,
        {
          action: "cancel",
          expectedVersion: campaign.version,
          reason,
        },
      );
      const canceled = response.data?.campaign;
      if (!canceled) throw new Error("Campaign cancel returned no record.");
      setCampaign(canceled);
      setSuccess("Scheduled campaign canceled before delivery.");
      router.refresh();
    });
  }

  async function sendNow() {
    await run("send", async () => {
      requireReason();
      const saved = campaign?.status === "failed" ? campaign : await persistCampaign();
      if (
        !window.confirm(
          saved.status === "failed"
            ? "Retry this confirmed-not-sent campaign now?"
            : "Send this campaign to the public Telegram channel now?",
        )
      ) {
        return;
      }
      const response = await callApi(
        `/api/admin/telegram-campaigns/${saved.id}`,
        {
          action: "send_now",
          expectedVersion: saved.version,
          reason,
        },
      );
      const delivery = response.data?.delivery;
      if (delivery?.action !== "sent") {
        if (response.data?.campaign) setCampaign(response.data.campaign);
        throw new Error(delivery?.error || "Telegram delivery did not complete.");
      }
      if (response.data?.campaign) setCampaign(response.data.campaign);
      setSuccess("Telegram provider confirmed delivery.");
      router.refresh();
    });
  }

  async function createAiDraft() {
    await run("ai", async () => {
      requireReason();
      const response = await callApi(
        "/api/admin/telegram-campaigns/ai-draft",
        {
          facts: { ...fields, scheduledForEt: scheduledForEt || null },
          reason,
        },
        "POST",
      );
      const draft = response.data?.draft;
      if (!draft?.title || !draft.body) {
        throw new Error("AI draft returned no usable content.");
      }
      setFields((current) => ({
        ...current,
        title: draft.title || current.title,
        body: draft.body || current.body,
      }));
      setSuccess(
        `AI draft loaded for review${draft.recommendedCtas?.length ? ` · CTA suggestions: ${draft.recommendedCtas.join(", ")}` : ""}. It has not been saved or sent.`,
      );
    });
  }

  async function run(name: string, operation: () => Promise<void>) {
    if (busy) return;
    setBusy(name);
    setError("");
    setSuccess("");
    try {
      await operation();
    } catch (operationError) {
      setError(
        operationError instanceof Error
          ? operationError.message
          : "The administrator operation failed.",
      );
    } finally {
      setBusy("");
    }
  }

  function requireReason() {
    if (reason.trim().length < 4) {
      throw new Error("Enter an operator reason of at least four characters.");
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>Public channel operations</span>
          <h1>{campaign ? campaign.title || "Untitled campaign" : "New Telegram campaign"}</h1>
          <p>
            Draft, preview, schedule in Eastern Time, or explicitly send a
            notice. AI output always requires administrator review.
          </p>
        </div>
        <div className={styles.headingActions}>
          {campaign ? (
            <span className={`${styles.status} ${statusClass(campaign.status)}`}>
              {campaignStatusLabel(campaign.status)}
            </span>
          ) : null}
          <Link className={styles.button} href="/admin/telegram-channel">
            Campaign list
          </Link>
        </div>
      </header>

      {error ? <div className={styles.error}>{error}</div> : null}
      {success ? <div className={styles.success}>{success}</div> : null}
      {campaign?.deliveryOutcome === "uncertain" ? (
        <div className={styles.error}>
          Telegram delivery is uncertain. Automatic and manual retries are
          blocked until an operator reconciles the provider result.
        </div>
      ) : null}

      <div className={styles.editorGrid}>
        <section className={styles.panel}>
          <h2>Campaign content</h2>
          <div className={styles.fieldsTwo}>
            <label className={styles.field}>
              <span>Notice type · optional</span>
              <select
                className={styles.select}
                disabled={!editable}
                onChange={(event) => updateField("noticeType", event.target.value)}
                value={fields.noticeType}
              >
                <option value="">Default channel notice</option>
                {ADMIN_TELEGRAM_NOTICE_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {noticeTypeLabel(type)}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span>Ticker · optional</span>
              <input
                className={styles.input}
                disabled={!editable}
                maxLength={12}
                onChange={(event) => updateField("ticker", event.target.value.toUpperCase())}
                placeholder="BBLG"
                value={fields.ticker}
              />
            </label>
          </div>
          <label className={styles.fieldWide}>
            <span>Title · optional</span>
            <input
              className={styles.input}
              disabled={!editable}
              maxLength={160}
              onChange={(event) => updateField("title", event.target.value)}
              placeholder="What should channel readers know?"
              value={fields.title}
            />
          </label>
          <label className={styles.fieldWide}>
            <span>Body · optional when title is present</span>
            <textarea
              className={styles.textarea}
              disabled={!editable}
              maxLength={3500}
              onChange={(event) => updateField("body", event.target.value)}
              placeholder="Use verified facts only."
              value={fields.body}
            />
            <span className={styles.meta}>{fields.body.length}/3,500</span>
          </label>
          <div className={styles.fieldsTwo}>
            <label className={styles.field}>
              <span>Source label · optional</span>
              <input
                className={styles.input}
                disabled={!editable}
                maxLength={120}
                onChange={(event) => updateField("sourceLabel", event.target.value)}
                placeholder="Federal Reserve"
                value={fields.sourceLabel}
              />
            </label>
            <label className={styles.field}>
              <span>Source URL · optional</span>
              <input
                className={styles.input}
                disabled={!editable}
                onChange={(event) => updateField("sourceUrl", event.target.value)}
                placeholder="https://…"
                value={fields.sourceUrl}
              />
            </label>
            <label className={styles.field}>
              <span>Analysis URL · optional</span>
              <input
                className={styles.input}
                disabled={!editable}
                onChange={(event) => updateField("analysisUrl", event.target.value)}
                placeholder="/events/… or https://…"
                value={fields.analysisUrl}
              />
            </label>
            <label className={styles.field}>
              <span>Live Room URL · optional</span>
              <input
                className={styles.input}
                disabled={!editable}
                onChange={(event) => updateField("liveRoomUrl", event.target.value)}
                placeholder="/live/BBLG or https://…"
                value={fields.liveRoomUrl}
              />
            </label>
          </div>

          <div className={styles.operatorNote}>
            <label className={styles.fieldWide}>
              <span>Operator reason · required for every action</span>
              <input
                className={styles.input}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Why this notice is being prepared or sent"
                value={reason}
              />
            </label>
          </div>

          <div className={styles.actions}>
            <button className={styles.button} disabled={!editable || Boolean(busy)} onClick={save} type="button">
              {busy === "save" ? "Saving…" : "Save draft"}
            </button>
            <button className={styles.button} disabled={!editable || Boolean(busy)} onClick={createAiDraft} type="button">
              {busy === "ai" ? "Drafting…" : "Draft with AI"}
            </button>
          </div>

          <div className={styles.fieldsTwo}>
            <label className={styles.fieldWide}>
              <span>Schedule in ET · America/New_York</span>
              <input
                className={styles.input}
                disabled={!editable}
                onChange={(event) => setScheduledForEt(event.target.value)}
                type="datetime-local"
                value={scheduledForEt}
              />
            </label>
          </div>
          <div className={styles.actions}>
            <button className={styles.button} disabled={!editable || Boolean(busy)} onClick={schedule} type="button">
              {busy === "schedule" ? "Scheduling…" : "Save & schedule"}
            </button>
            {canSend ? (
              <button className={styles.buttonPrimary} disabled={Boolean(busy)} onClick={sendNow} type="button">
                {busy === "send"
                  ? "Sending…"
                  : campaign?.status === "failed"
                    ? "Retry confirmed failure"
                    : "Send now"}
              </button>
            ) : null}
            {canCancel ? (
              <button className={styles.buttonDanger} disabled={Boolean(busy)} onClick={cancel} type="button">
                {busy === "cancel" ? "Canceling…" : "Cancel schedule"}
              </button>
            ) : null}
          </div>
        </section>

        <aside className={`${styles.panel} ${styles.preview}`}>
          <h2>Telegram preview</h2>
          <p className={styles.muted}>
            Telegram renders action buttons using its native app theme. This
            preview does not send or save anything.
          </p>
          <div className={styles.telegramPreview}>
            {preview.presentation ? (
              <>
                <pre>{telegramHtmlToPlainText(preview.presentation.text)}</pre>
                {preview.presentation.replyMarkup ? (
                  <div className={styles.telegramButtons}>
                    {preview.presentation.replyMarkup.inline_keyboard.flat().map((button) => (
                      <span key={`${button.text}:${button.url}`}>{button.text}</span>
                    ))}
                  </div>
                ) : null}
              </>
            ) : (
              <p className={styles.muted}>{preview.error}</p>
            )}
          </div>

          {campaign ? (
            <>
              <h3>Delivery record</h3>
              <dl className={styles.definition}>
                <dt>Created</dt>
                <dd>{formatLocal(campaign.createdAt)} · {campaign.createdByLabel || "Unknown"}</dd>
                <dt>Updated</dt>
                <dd>{formatLocal(campaign.updatedAt)} · {campaign.updatedByLabel || "Unknown"}</dd>
                <dt>Scheduled</dt>
                <dd>{formatEtDateTime(campaign.scheduledFor)}</dd>
                <dt>Sent</dt>
                <dd>{campaign.sentAt ? formatLocal(campaign.sentAt) : "—"}</dd>
                <dt>Message ID</dt>
                <dd>{campaign.providerMessageId || "—"}</dd>
                <dt>Attempts</dt>
                <dd>{campaign.attemptCount}</dd>
                <dt>Outcome</dt>
                <dd>{campaign.deliveryOutcome}</dd>
                <dt>Last error</dt>
                <dd>{campaign.lastError || "—"}</dd>
              </dl>
            </>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

async function callApi(
  url: string,
  body: Record<string, unknown>,
  method = "PATCH",
) {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => null)) as ApiPayload | null;
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error?.message || "The administrator operation failed.");
  }
  return payload;
}

function fieldsFrom(campaign: AdminTelegramCampaign | null): EditorFields {
  return {
    noticeType: campaign?.noticeType || "",
    title: campaign?.title || "",
    body: campaign?.body || "",
    ticker: campaign?.ticker || "",
    sourceLabel: campaign?.sourceLabel || "",
    sourceUrl: campaign?.sourceUrl || "",
    analysisUrl: campaign?.analysisUrl || "",
    liveRoomUrl: campaign?.liveRoomUrl || "",
  };
}

function statusClass(status: AdminTelegramCampaign["status"]) {
  if (status === "sent") return styles.statusSent;
  if (status === "scheduled") return styles.statusScheduled;
  if (status === "sending") return styles.statusSending;
  if (status === "failed") return styles.statusFailed;
  if (status === "canceled") return styles.statusCanceled;
  return "";
}

function telegramHtmlToPlainText(value: string) {
  return value
    .replace(/<a\s+href="[^"]*">/gi, "")
    .replace(/<\/?(?:b|strong|i|em|u|s|code|pre)>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

function humanizePolicyCode(value: string) {
  if (value.includes("CONTENT_REQUIRED")) return "Enter a title or body to preview.";
  if (value.includes("URL_INVALID")) return "One of the URLs is invalid.";
  return "Complete the campaign content to preview it.";
}

function formatLocal(value: string) {
  return Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleString("en-US")
    : "—";
}
