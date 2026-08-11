export function contextPreservingChunks(value: string, maxChars: number): string[] {
  const normalized = value
    .replace(/[\u00a0\u2000-\u200b\u202f\u205f\u3000]/g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .replace(/(.)\1{255,}/g, " ")
    .replace(/\S{1000,}/g, " ")
    .trim();
  if (!normalized || normalized === "{}" || normalized === "[]" || maxChars <= 0) return [];
  if (normalized.length <= maxChars) return [normalized];

  const chunks: string[] = [];
  let remaining = normalized;
  while (remaining.length > maxChars) {
    const window = remaining.slice(0, maxChars);
    const minimumBoundary = Math.floor(maxChars * 0.62);
    const candidates = [
      window.lastIndexOf("\n\n"),
      window.lastIndexOf("\n"),
      window.lastIndexOf(". "),
      window.lastIndexOf("; "),
      window.lastIndexOf(": "),
    ];
    const boundary = Math.max(...candidates.filter((candidate) => candidate >= minimumBoundary));
    const splitAt = boundary >= minimumBoundary
      ? boundary + (window.slice(boundary, boundary + 2) === ". " ? 1 : 0)
      : maxChars;
    const chunk = remaining.slice(0, splitAt).trim();
    if (!chunk) break;
    chunks.push(chunk);
    remaining = remaining.slice(splitAt).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

export function stableSourceHash(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}
