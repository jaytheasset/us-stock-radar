import styles from "@/components/admin/AdminSection.module.css";
import { getPromptRegistry } from "@/lib/promptRegistry";

export const dynamic = "force-dynamic";

export default function AdminPromptsPage() {
  const registry = getPromptRegistry();

  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div className="title-block">
          <h1>Prompt Registry</h1>
          <p className="muted">Draft LLM prompt inventory. No prompt writes from this page.</p>
        </div>
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
                {prompt.version} - {prompt.status}
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
              {prompt.runtimeNotes ? (
                <div className="prompt-wide">
                  <dt>Runtime Request</dt>
                  <dd>{prompt.runtimeNotes}</dd>
                </div>
              ) : null}
              {prompt.systemPrompt ? (
                <div className="prompt-wide">
                  <dt>System Prompt</dt>
                  <dd>
                    <pre className="json-block prompt-body-block">{prompt.systemPrompt}</pre>
                  </dd>
                </div>
              ) : null}
              {prompt.userInputTemplate ? (
                <div className="prompt-wide">
                  <dt>User Input Template</dt>
                  <dd>
                    <pre className="json-block prompt-body-block">{prompt.userInputTemplate}</pre>
                  </dd>
                </div>
              ) : null}
              {prompt.responseSchema ? (
                <div className="prompt-wide">
                  <dt>Response Schema</dt>
                  <dd>
                    <span>{getResponseSchemaSummary(prompt.responseSchema)}</span>
                    <details className="prompt-details">
                      <summary>View full response schema</summary>
                      <pre className="json-block">{JSON.stringify(prompt.responseSchema, null, 2)}</pre>
                    </details>
                  </dd>
                </div>
              ) : null}
            </dl>
          </article>
        ))}
      </section>
    </div>
  );
}

function getResponseSchemaSummary(schema: unknown) {
  if (!schema || typeof schema !== "object" || !("properties" in schema)) {
    return "Code-managed";
  }

  const properties = (schema as { properties?: unknown }).properties;
  if (!properties || typeof properties !== "object") return "Code-managed";

  return `Strict JSON schema - ${Object.keys(properties).length} top-level fields`;
}
