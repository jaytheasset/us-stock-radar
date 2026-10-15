// Explicit user Build action only; importing display/examples never calls a provider or API.
export function requestSec425MonitorPreview(text: string) {
  return fetch("/api/monitors/listing/compile/425-preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
}
