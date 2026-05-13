import Link from "next/link";
import { getPromptRegistry } from "@/lib/promptRegistry";

export const dynamic = "force-dynamic";

export default function AdminPromptsPage() {
  const registry = getPromptRegistry();

  return (
    <main className="shell">
      <header className="topbar">
        <div className="title-block">
          <h1>Prompt Registry</h1>
          <p className="muted">Draft LLM prompt inventory. No prompt writes from this page.</p>
        </div>
        <Link className="text-link" href="/admin">
          Admin
        </Link>
      </header>

      <section className="definition-list">
        {registry.prompts.map((prompt) => (
          <article className="definition-card" key={`${prompt.key}:${prompt.version}`}>
            <div className="definition-card-header">
              <div>
                <h2>{prompt.key}</h2>
                <p className="muted">{prompt.task}</p>
              </div>
              <span className={`pill ${prompt.status === "active" ? "ok" : "warn"}`}>
                {prompt.version} · {prompt.status}
              </span>
            </div>
            <dl className="readout-grid">
              <div>
                <dt>Model</dt>
                <dd>{prompt.model}</dd>
              </div>
              <div>
                <dt>Input Tables</dt>
                <dd>{prompt.inputTables.join(", ")}</dd>
              </div>
              <div>
                <dt>Output Target</dt>
                <dd>{prompt.outputTarget}</dd>
              </div>
              <div>
                <dt>Notes</dt>
                <dd>{prompt.notes}</dd>
              </div>
            </dl>
          </article>
        ))}
      </section>
    </main>
  );
}
