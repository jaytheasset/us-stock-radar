#!/usr/bin/env node

const args = new Map(
  process.argv
    .slice(2)
    .map((arg) => {
      const [key, value = "true"] = arg.replace(/^--/, "").split("=");
      return [key, value];
    }),
);

const baseUrl = String(args.get("base") || process.env.APP_LOCAL_URL || "http://127.0.0.1:3001").replace(/\/$/, "");
const formTypes = parseCsv(args.get("formTypes") || "S-3,S-3ASR,S-3/A");
const countPerForm = readInt(args.get("countPerForm"), 1, 1, 10);
const attachmentLimit = readInt(args.get("attachmentLimit"), 2, 0, 10);
const dryRun = args.get("dryRun") !== "false";
const checks = [];

try {
  const samples = [];
  for (const formType of formTypes) {
    const rawResult = await getJson(
      `/api/sources/sec/raw-preview?formTypes=${encodeURIComponent(formType)}&limit=${countPerForm}&countPerForm=${countPerForm}&attachmentLimit=${attachmentLimit}`,
    );
    const rawItems = Array.isArray(rawResult?.items) ? rawResult.items : [];
    check(`${formType} raw-preview returned a sample`, rawResult?.ok === true && rawItems.length > 0, {
      formType,
      error: rawResult?.error || null,
    });

    for (const rawItem of rawItems.slice(0, countPerForm)) {
      const preview = await postJson("/api/ai/sec-filing-analysis-preview", {
        dryRun,
        rawItem,
      });
      const filingPackage = preview?.input?.filing_package || {};
      const promptSchema = preview?.prompt?.responseFormat?.json_schema?.schema || {};
      const auditSchema = preview?.prompt?.audit?.responseFormat?.json_schema?.schema || {};
      const s3Evidence = filingPackage?.router_evidence?.s3 || {};
      const marketContext = filingPackage?.market_context || {};
      const dilutionMetrics = filingPackage?.dilution_metrics || {};
      const audit = preview?.audit || filingPackage?.offering_security_audit || {};
      const analysis = preview?.analysis || {};
      const displayModel = analysis?.offering_display_model || null;
      const promptKey = preview?.prompt?.key || null;
      const auditPromptKey = preview?.prompt?.audit?.key || null;
      const hasDisplayModelContract =
        Boolean(promptSchema?.properties?.offering_display_model) ||
        (promptKey === "sec_s3_offering_analysis" && (dryRun || Boolean(displayModel)));
      const hasAuditContract =
        Boolean(auditSchema?.properties?.security_stack) ||
        (auditPromptKey === "sec_offering_security_audit" && (dryRun || Boolean(audit?.security_stack)));
      const summary = {
        form_type: formType,
        accession_number: rawItem?.source_unique_id || filingPackage?.accession_number || null,
        title: rawItem?.title || null,
        ok: preview?.ok === true,
        error: preview?.error || null,
        stage: preview?.stage || null,
        prompt_key: promptKey,
        prompt_version: preview?.prompt?.version || null,
        audit_prompt_key: auditPromptKey,
        audit_prompt_version: preview?.prompt?.audit?.version || null,
        has_display_model_contract: hasDisplayModelContract,
        has_audit_contract: hasAuditContract,
        package_form_type: filingPackage?.form_type || null,
        router_excerpt_chars: String(s3Evidence?.router_excerpt || "").length,
        important_section_count: Array.isArray(s3Evidence?.important_sections) ? s3Evidence.important_sections.length : 0,
        fee_table_rows: Array.isArray(s3Evidence?.important_tables?.fee_table_rows)
          ? s3Evidence.important_tables.fee_table_rows.length
          : 0,
        selling_stockholder_rows: Array.isArray(s3Evidence?.important_tables?.selling_stockholders)
          ? s3Evidence.important_tables.selling_stockholders.length
          : 0,
        analysis_action: analysis?.analysis_action || null,
        audit: audit
          ? {
              audit_action: audit.audit_action || null,
              offering_type: audit.offering_type || null,
              needs_human_review: audit.needs_human_review ?? null,
              current_shares: audit.security_stack?.current_shares_outstanding?.value_text || null,
              registered_supply: audit.security_stack?.registered_resale_supply?.value_text || null,
              max_stack: audit.security_stack?.max_registered_stack_share_equivalent?.value_text || null,
              resale_proceeds_to_company: audit.proceeds_stack?.resale_proceeds_to_company?.value_text || null,
              registered_pool_reconciles: audit.sanity_checks?.registered_pool_reconciles ?? null,
              unresolved_number_conflict: audit.sanity_checks?.unresolved_number_conflict ?? null,
              conflict_count: Array.isArray(audit.unresolved_conflicts) ? audit.unresolved_conflicts.length : 0,
            }
          : null,
        s3_case: analysis?.s3_case || null,
        event_type: analysis?.event_type || null,
        score: Number.isFinite(Number(analysis?.score)) ? Number(analysis.score) : null,
        signal: analysis?.signal || null,
        archive_summary: analysis?.archive_summary || null,
        offering_display_model: displayModel
          ? {
              display_mode: displayModel.display_mode || null,
              risk_label: displayModel.risk_label || null,
              headline: displayModel.headline || null,
              current_shares: displayModel.current_shares?.value_text || null,
              total_potential_supply: displayModel.total_potential_supply?.value_text || null,
              segment_count: Array.isArray(displayModel.supply_segments) ? displayModel.supply_segments.length : 0,
              excluded_count: Array.isArray(displayModel.future_or_excluded_overhang)
                ? displayModel.future_or_excluded_overhang.length
                : 0,
              needs_human_review: displayModel.needs_human_review ?? null,
            }
          : null,
        usage: preview?.usage || null,
        cost_estimate: preview?.costEstimate || null,
        market_context: {
          available: marketContext?.available === true,
          data_quality: marketContext?.data_quality || null,
          price: marketContext?.price ?? null,
          market_cap: marketContext?.market_cap ?? null,
          shares_outstanding: marketContext?.shares_outstanding ?? null,
          public_float: marketContext?.public_float ?? null,
        },
        dilution_metrics: {
          available: dilutionMetrics?.available === true,
          shares_offered: dilutionMetrics?.shares_offered ?? null,
          current_shares_outstanding: dilutionMetrics?.current_shares_outstanding ?? null,
          public_float: dilutionMetrics?.public_float ?? null,
          estimated_dilution_percent: dilutionMetrics?.estimated_dilution_percent ?? null,
          float_overhang_percent: dilutionMetrics?.float_overhang_percent ?? null,
          offering_amount_percent_of_market_cap: dilutionMetrics?.offering_amount_percent_of_market_cap ?? null,
          dilution_scale: dilutionMetrics?.dilution_scale || null,
          preliminary_score_floor: dilutionMetrics?.preliminary_score_floor ?? null,
          preliminary_score_cap: dilutionMetrics?.preliminary_score_cap ?? null,
          delivery_hint: dilutionMetrics?.delivery_hint || null,
          score_policy_reasons: Array.isArray(dilutionMetrics?.score_policy_reasons)
            ? dilutionMetrics.score_policy_reasons
            : [],
        },
      };
      samples.push(summary);

      check(`${formType} preview returned ok for ${summary.accession_number}`, preview?.ok === true, summary);
      check(`${formType} uses S-3 offering prompt for ${summary.accession_number}`, summary.prompt_key === "sec_s3_offering_analysis", summary);
      check(`${formType} has S-3 offering audit prompt for ${summary.accession_number}`, summary.audit_prompt_key === "sec_offering_security_audit", summary);
      if (dryRun || summary.analysis_action === "analyze_offering") {
        check(`${formType} has offering display model contract for ${summary.accession_number}`, summary.has_display_model_contract, summary);
      }
      check(`${formType} has offering audit contract for ${summary.accession_number}`, summary.has_audit_contract, summary);
      check(`${formType} has S-3 router evidence for ${summary.accession_number}`, summary.router_excerpt_chars > 500, summary);
      check(`${formType} has important S-3 sections for ${summary.accession_number}`, summary.important_section_count > 0, summary);
      check(`${formType} has market context contract for ${summary.accession_number}`, Boolean(filingPackage?.market_context), summary);
      check(`${formType} has dilution metrics contract for ${summary.accession_number}`, Boolean(filingPackage?.dilution_metrics), summary);

      if (!dryRun) {
        check(`${formType} returns offering audit for ${summary.accession_number}`, Boolean(summary.audit?.audit_action), summary);
        check(`${formType} returns S-3 action for ${summary.accession_number}`, isS3Action(summary.analysis_action), summary);
        const scoreFloor = readOptionalNumber(summary.dilution_metrics.preliminary_score_floor);
        const scoreCap = readOptionalNumber(summary.dilution_metrics.preliminary_score_cap);
        const deliveryHint = summary.dilution_metrics.delivery_hint;
        const finalActionSkipsStorage = summary.analysis_action === "skip_analysis";
        if (!finalActionSkipsStorage && scoreFloor !== null) {
          check(`${formType} score respects policy floor for ${summary.accession_number}`, Number(summary.score) >= scoreFloor, summary);
        }
        if (!finalActionSkipsStorage && scoreCap !== null) {
          check(`${formType} score respects policy cap for ${summary.accession_number}`, Number(summary.score) <= scoreCap, summary);
        }
        if (!finalActionSkipsStorage && (deliveryHint === "feed" || deliveryHint === "alert" || deliveryHint === "urgent")) {
          check(`${formType} feed policy uses analyze_offering for ${summary.accession_number}`, summary.analysis_action === "analyze_offering", summary);
          check(`${formType} feed policy maps to dilution_risk for ${summary.accession_number}`, summary.event_type === "dilution_risk", summary);
        }
        if (deliveryHint === "skip") {
          check(`${formType} skip policy uses skip_analysis for ${summary.accession_number}`, summary.analysis_action === "skip_analysis", summary);
        }
        if (summary.analysis_action === "skip_analysis") {
          check(`${formType} skip_analysis score is below event threshold for ${summary.accession_number}`, Number(summary.score) < 20, summary);
          check(`${formType} skip_analysis maps to other event type for ${summary.accession_number}`, summary.event_type === "other", summary);
          check(`${formType} skip_analysis has internal skip summary for ${summary.accession_number}`, Boolean(summary.archive_summary), summary);
        }
        if (summary.analysis_action === "analyze_offering") {
          check(`${formType} analyze_offering is feed-level or above for ${summary.accession_number}`, Number(summary.score) >= 50, summary);
          check(`${formType} analyze_offering maps to dilution risk for ${summary.accession_number}`, summary.event_type === "dilution_risk", summary);
          check(`${formType} analyze_offering returns display model for ${summary.accession_number}`, Boolean(displayModel), summary);
        }
        if (summary.analysis_action === "routine_archive") {
          check(`${formType} routine_archive score is archive-level for ${summary.accession_number}`, Number(summary.score) < 50, summary);
          check(
            `${formType} routine_archive has required archive summary ending for ${summary.accession_number}`,
            String(summary.archive_summary || "").endsWith("Open the original filing for full details if needed."),
            summary,
          );
        }
        if (formType.toUpperCase() === "S-3/A" && Number(summary.score) < 50) {
          check(`${formType} low-priority amendment skips event storage for ${summary.accession_number}`, summary.analysis_action === "skip_analysis", summary);
        }
      }
    }
  }

  printAndExit(samples);
} catch (error) {
  checks.push({
    name: "qa script failed",
    ok: false,
    detail: error instanceof Error ? error.message : String(error),
  });
  printAndExit([]);
}

async function getJson(path) {
  const response = await fetch(`${baseUrl}${path}`, { cache: "no-store" });
  const text = await response.text();
  if (!response.ok) throw new Error(`GET ${path} failed: HTTP ${response.status} ${short(text)}`);
  return text ? JSON.parse(text) : null;
}

async function postJson(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body || {}),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`POST ${path} failed: HTTP ${response.status} ${short(text)}`);
  return text ? JSON.parse(text) : null;
}

function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail: ok ? undefined : detail });
}

function printAndExit(samples) {
  const costSummary = summarizeCost(samples);
  const summary = {
    baseUrl,
    dryRun,
    formTypes,
    sample_count: samples.length,
    llm_cost: costSummary,
    checks_passed: checks.filter((item) => item.ok).length,
    checks_failed: checks.filter((item) => !item.ok).length,
  };
  console.log(JSON.stringify({ ok: summary.checks_failed === 0, summary, samples, checks }, null, 2));
  process.exitCode = summary.checks_failed === 0 ? 0 : 1;
}

function isS3Action(value) {
  return value === "skip_analysis" || value === "routine_archive" || value === "analyze_offering";
}

function summarizeCost(samples) {
  const estimates = samples.map((sample) => sample.cost_estimate).filter(Boolean);
  const usages = samples.map((sample) => sample.usage).filter(Boolean);
  const pricingLabels = Array.from(new Set(estimates.map((estimate) => estimate.pricing).filter(Boolean)));
  return {
    sample_count_with_usage: usages.length,
    sample_count_with_cost: estimates.length,
    estimated_usd_total: Number(estimates.reduce((sum, estimate) => sum + Number(estimate.estimatedUsd || 0), 0).toFixed(8)),
    input_tokens_total: sumBy(usages, "input_tokens"),
    cached_input_tokens_total: usages.reduce(
      (sum, usage) => sum + Number(usage?.input_tokens_details?.cached_tokens || 0),
      0,
    ),
    output_tokens_total: sumBy(usages, "output_tokens"),
    total_tokens_total: sumBy(usages, "total_tokens"),
    pricing: pricingLabels.length ? pricingLabels.join("; ") : null,
  };
}

function sumBy(items, key) {
  return items.reduce((sum, item) => sum + Number(item?.[key] || 0), 0);
}

function readOptionalNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readInt(value, fallback, min, max) {
  const parsed = value ? Number(value) : fallback;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function parseCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function short(value) {
  const text = String(value || "");
  return text.length > 700 ? `${text.slice(0, 700)}...` : text;
}
