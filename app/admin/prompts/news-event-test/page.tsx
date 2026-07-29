import Link from "next/link";
import { runNewsEventAnalysisPreview } from "@/lib/ai/newsEventAnalysisPreview";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: Promise<{
    dryRun?: string;
    run?: string;
  }>;
};

export default async function NewsEventPromptTestPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const runLlm = params?.run === "true" || params?.dryRun === "false";
  const dryRun = !runLlm;
  const result = await runNewsEventAnalysisPreview({ dryRun });
  const analysis = readRecord(result.analysis);
  const sourceItem = readRecord(result.sourceItem);

  return (
    <div className="shell">
      <header className="topbar">
        <div className="title-block">
          <h1>News Event Prompt Test</h1>
          <p className="muted">GlobeNewswire raw item to structured LLM analysis. This page does not write to DB.</p>
        </div>
        <div className="prompt-test-actions">
          <Link className="text-link" href="/admin/prompts/news-event-test?run=true">
            Run LLM
          </Link>
          <Link className="text-link" href="/admin/prompts/news-event-test">
            Dry Run
          </Link>
          <Link className="text-link" href="/admin/prompts">
            Prompts
          </Link>
        </div>
      </header>

      {!result.ok ? (
        <section className="error-state">
          <strong>Test failed</strong>
          <p>{String(result.error || "Unknown error")}</p>
        </section>
      ) : null}

      <section className="definition-list">
        <article className="definition-card prompt-test-card">
          <div className="definition-card-header">
            <div>
              <h2>Generated Site Preview</h2>
              <p className="muted">
                {dryRun ? "Dry run only. No LLM call." : `Stage: ${String(result.stage || "complete")}`}
              </p>
            </div>
            {analysis ? (
              <span className="pill ok">LLM output</span>
            ) : (
              <span className="pill warn">No analysis</span>
            )}
          </div>
          <div className="prompt-test-preview">
            <div className="prompt-test-source">
              <span>{String(sourceItem?.source_code || "globe")}</span>
              <span>{String(sourceItem?.published_at || "")}</span>
              <span>{String(sourceItem?.ticker_source || "article_body")}</span>
            </div>
            <h2>{String(sourceItem?.title || "Untitled GlobeNewswire item")}</h2>
            <div className="prompt-test-quick-take">
              <strong>Quick Take</strong>
              <p>{String(analysis?.quick_take || "Run LLM to generate a quick take from the article body.")}</p>
            </div>
            {analysis ? (
              <div className="prompt-test-metrics">
                <span>Score {String(analysis.score ?? "-")}</span>
                <span>{String(analysis.signal || "-")}</span>
                <span>{String(analysis.event_type || "-")}</span>
                <span>{String(analysis.market_scope || "-")}</span>
                <span>Analysis text {String(sourceItem?.analysisChars || "-")} chars</span>
              </div>
            ) : null}
          </div>
        </article>

        {analysis ? (
          <article className="definition-card">
            <div className="definition-card-header">
              <div>
                <h2>Analysis Sections</h2>
                <p className="muted">Detail-page fields generated from the same response.</p>
              </div>
            </div>
            <dl className="readout-grid">
              <div>
                <dt>Why It Matters</dt>
                <dd>{String(analysis.why_it_matters || "-")}</dd>
              </div>
              <div>
                <dt>Summary</dt>
                <dd>{String(analysis.summary || "-")}</dd>
              </div>
              <div>
                <dt>Positive</dt>
                <dd>{renderList(analysis.bullish_points)}</dd>
              </div>
              <div>
                <dt>Negative</dt>
                <dd>{renderList(analysis.bearish_points)}</dd>
              </div>
              <div>
                <dt>Key Evidence</dt>
                <dd>{renderList(analysis.key_evidence)}</dd>
              </div>
              <div>
                <dt>What To Watch Next</dt>
                <dd>{renderList(analysis.what_to_watch_next)}</dd>
              </div>
            </dl>
          </article>
        ) : null}

        <article className="definition-card">
          <div className="definition-card-header">
            <div>
              <h2>Raw Test Payload</h2>
              <p className="muted">For debugging parser input and LLM output.</p>
            </div>
          </div>
          <pre className="json-block">{JSON.stringify(result, null, 2)}</pre>
        </article>
      </section>
    </div>
  );
}

function renderList(value: unknown) {
  if (!Array.isArray(value) || !value.length) return "-";
  return value.map((item, index) => (
    <span className="prompt-test-list-item" key={`${String(item)}-${index}`}>
      {index + 1}. {String(item)}
    </span>
  ));
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
