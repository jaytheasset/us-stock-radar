import { createHash } from "node:crypto";
import { parseDocument, DomUtils } from "htmlparser2";

// Public official notices only. No Kiwoom authentication, customer posts, trading,
// account data, OCR, model calls, or ticker mutation are part of this adapter.
export const KIWOOM_ORIGIN = "https://bbn.kiwoom.com";
export const KIWOOM_BOARD = "https://www.kiwoom.com/h/common/bbs/VBbsBoardBWGCZView?dummyVal=0";
export const KIWOOM_LIMITS = { timeoutMs: 15_000, jsonBytes: 1_000_000, imageBytes: 2_000_000, images: 3 } as const;
export type NoticeListItem = { id: string; title: string; postedDate: string; author: string; sourceUrl: string };
export type NoticeImage = { sourceUrl: string; sha256: string; mime: "image/png" | "image/jpeg"; base64: string };
export type KiwoomSnapshot = NoticeListItem & {
  version: "kiwoom-notice-v1"; capturedAt: string; sourceHash: string;
  rawHtml: string; text: string; images: NoticeImage[];
  authority: "supporting_evidence_only";
};
export class KiwoomError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status = 502) { super(code); this.name = "KiwoomError"; this.code = code; this.status = status; }
}
export const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new KiwoomError("KIWOOM_INVALID_RESPONSE");
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new KiwoomError("KIWOOM_INVALID_RESPONSE");
  return value.trim();
}
export function noticeId(value: unknown): string {
  const id = String(value ?? "");
  if (!/^[1-9]\d{0,8}$/.test(id)) throw new KiwoomError("KIWOOM_INVALID_NOTICE_ID", 400);
  return id;
}
export function isoDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? value : null;
}
function noticeMetadata(row: Record<string, unknown>): NoticeListItem {
  if (row.scrnTp !== "NWGCZ") throw new KiwoomError("KIWOOM_NOT_OFFICIAL_NOTICE");
  const id = noticeId(row.seqid), postedDate = isoDate(text(row.makeTime, 10).replaceAll(".", "-"));
  if (!postedDate) throw new KiwoomError("KIWOOM_INVALID_POSTED_DATE");
  return { id, title: text(row.ttl, 1000), author: text(row.custPsdn, 120), postedDate,
    sourceUrl: `${KIWOOM_ORIGIN}/bbs/VBbsNoticeBWGCZDetailView?seqid=${id}` };
}
export function parseNoticeList(value: unknown): NoticeListItem[] {
  const rows = record(value).boardList;
  if (!Array.isArray(rows) || rows.length > 100) throw new KiwoomError("KIWOOM_INVALID_LIST");
  const result: NoticeListItem[] = [], ids = new Set<string>();
  for (const value of rows) {
    const row = record(value);
    // Explicit discriminator: neither author names nor title keywords establish authority.
    if (typeof row.step !== "number" || !Number.isInteger(row.step) || row.step < 0) throw new KiwoomError("KIWOOM_INVALID_LIST");
    if (row.step !== 0) continue;
    const item = noticeMetadata(row);
    if (ids.has(item.id)) throw new KiwoomError("KIWOOM_DUPLICATE_NOTICE");
    ids.add(item.id); result.push(item);
  }
  return result;
}
function parseImageUrl(src: string): string {
  let url: URL;
  try { url = new URL(src, KIWOOM_ORIGIN); } catch { throw new KiwoomError("KIWOOM_UNSUPPORTED_IMAGE"); }
  const name = url.searchParams.get("apndnm");
  if (url.origin !== KIWOOM_ORIGIN || url.username || url.password || url.hash ||
      url.pathname !== "/bbs/VBbsNoticeImageView" || [...url.searchParams.keys()].join() !== "apndnm" ||
      !name || !/^[A-Za-z0-9_-]{1,100}\.(png|jpg|jpeg)$/i.test(name)) throw new KiwoomError("KIWOOM_UNSUPPORTED_IMAGE");
  return url.toString();
}
export function parseNoticeDetail(value: unknown, expectedId: string) {
  const raw = record(record(value).noticeDetail), meta = noticeMetadata(raw);
  if (meta.id !== noticeId(expectedId)) throw new KiwoomError("KIWOOM_NOTICE_ID_MISMATCH");
  if (!Array.isArray(raw.attcFile) || raw.attcFile.length) throw new KiwoomError("KIWOOM_UNSUPPORTED_ATTACHMENT");
  const rawHtml = text(raw.dtlCntn, 500_000), dom = parseDocument(rawHtml, { decodeEntities: true });
  const dangerous = DomUtils.findAll(node => "name" in node && ["script", "style", "iframe", "object"].includes(node.name), dom.children);
  for (const node of dangerous) DomUtils.removeElement(node);
  const imageNodes = DomUtils.findAll(node => "name" in node && node.name === "img", dom.children);
  const imageUrls = [...new Set(imageNodes.map(node => parseImageUrl("attribs" in node ? node.attribs.src ?? "" : "")))];
  if (imageUrls.length > KIWOOM_LIMITS.images) throw new KiwoomError("KIWOOM_TOO_MANY_IMAGES");
  const plainText = dom.children.map(node => DomUtils.innerText(node)).join("\n").replace(/\u00a0/g, " ").trim();
  if (!plainText && !imageUrls.length) throw new KiwoomError("KIWOOM_EMPTY_NOTICE");
  return { ...meta, rawHtml, text: plainText, imageUrls };
}
async function readBounded(response: Response, maximum: number): Promise<Buffer> {
  if (!response.ok) { await response.body?.cancel(); throw new KiwoomError("KIWOOM_UPSTREAM_HTTP"); }
  const declared = Number(response.headers.get("content-length"));
  if (declared > maximum) { await response.body?.cancel(); throw new KiwoomError("KIWOOM_RESPONSE_TOO_LARGE"); }
  if (!response.body) throw new KiwoomError("KIWOOM_EMPTY_RESPONSE");
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break;
      size += value.length; if (size > maximum) throw new KiwoomError("KIWOOM_RESPONSE_TOO_LARGE"); chunks.push(value); }
    return Buffer.concat(chunks);
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
}
async function publicJson(path: string, body: Record<string, string>, fetchImpl: typeof fetch, signal: AbortSignal) {
  const response = await fetchImpl(`${KIWOOM_ORIGIN}/bbs/${path}`, { method: "POST", redirect: "error", cache: "no-store", signal,
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", Referer: `${KIWOOM_ORIGIN}/bbs/VBbsBoardBWGCZView` }, body: new URLSearchParams(body) });
  const bytes = await readBounded(response, KIWOOM_LIMITS.jsonBytes);
  try { return JSON.parse(bytes.toString("utf8")) as unknown; } catch { throw new KiwoomError("KIWOOM_INVALID_JSON"); }
}
export async function fetchKiwoomNoticeList(page = 1, fetchImpl: typeof fetch = fetch) {
  if (!Number.isInteger(page) || page < 1 || page > 20) throw new KiwoomError("KIWOOM_INVALID_PAGE", 400);
  try {
    const value = await publicJson("SBbsBoardBWGCZListAjax", { pageNo: String(page), custId: "", divTp1: "", divTp2: "", f_keyField: "ttl", f_key: "", searchTp: "1", pagePerBlock: "10", maxGrpStep: "", minGrpStep: "", prevPageNo: String(page) }, fetchImpl, AbortSignal.timeout(KIWOOM_LIMITS.timeoutMs));
    return { items: parseNoticeList(value), page, scope: "one_board_page_official_notices_only" as const, checkedAt: new Date().toISOString() };
  } catch (error) { if (error instanceof KiwoomError) throw error; throw new KiwoomError("KIWOOM_UNAVAILABLE"); }
}
function snapshotContent(snapshot: Omit<KiwoomSnapshot, "sourceHash"> | KiwoomSnapshot) {
  return { version: snapshot.version, id: snapshot.id, title: snapshot.title, author: snapshot.author,
    postedDate: snapshot.postedDate, sourceUrl: snapshot.sourceUrl, rawHtml: snapshot.rawHtml,
    images: snapshot.images.map(image => ({ sourceUrl: image.sourceUrl, sha256: image.sha256, mime: image.mime })) };
}
export function snapshotHash(snapshot: Omit<KiwoomSnapshot, "sourceHash"> | KiwoomSnapshot) { return sha256(JSON.stringify(snapshotContent(snapshot))); }
export function validateSnapshot(snapshot: KiwoomSnapshot): boolean {
  try {
    if (snapshot.version !== "kiwoom-notice-v1" || snapshot.authority !== "supporting_evidence_only" ||
        snapshot.sourceUrl !== `${KIWOOM_ORIGIN}/bbs/VBbsNoticeBWGCZDetailView?seqid=${noticeId(snapshot.id)}` ||
        snapshotHash(snapshot) !== snapshot.sourceHash || !Number.isFinite(Date.parse(snapshot.capturedAt))) return false;
    const parsed = parseNoticeDetail({ noticeDetail: { seqid: Number(snapshot.id), scrnTp: "NWGCZ", ttl: snapshot.title,
      custPsdn: snapshot.author, makeTime: snapshot.postedDate.replaceAll("-", "."), dtlCntn: snapshot.rawHtml, attcFile: [] } }, snapshot.id);
    return parsed.text === snapshot.text && JSON.stringify(parsed.imageUrls) === JSON.stringify(snapshot.images.map(i => i.sourceUrl)) && snapshot.images.every(image => {
      const bytes = Buffer.from(image.base64, "base64");
      return bytes.toString("base64") === image.base64 && bytes.length <= KIWOOM_LIMITS.imageBytes && sha256(bytes) === image.sha256 && imageMime(bytes) === image.mime;
    });
  } catch { return false; }
}
function imageMime(bytes: Buffer): "image/png" | "image/jpeg" {
  if (bytes.length > 24 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return "image/png";
  if (bytes.length > 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  throw new KiwoomError("KIWOOM_UNSUPPORTED_IMAGE_BYTES");
}
export async function fetchKiwoomSnapshot(id: string, fetchImpl: typeof fetch = fetch): Promise<KiwoomSnapshot> {
  noticeId(id);
  const signal = AbortSignal.timeout(KIWOOM_LIMITS.timeoutMs);
  try {
    const detail = parseNoticeDetail(await publicJson("SBbsNoticeBWGCZDetailAjax", { seqid: id, cd: "" }, fetchImpl, signal), id);
    const images: NoticeImage[] = [];
    for (const sourceUrl of detail.imageUrls) {
      const response = await fetchImpl(sourceUrl, { redirect: "error", cache: "no-store", signal, headers: { Accept: "image/png,image/jpeg" } });
      const bytes = await readBounded(response, KIWOOM_LIMITS.imageBytes);
      images.push({ sourceUrl, sha256: sha256(bytes), mime: imageMime(bytes), base64: bytes.toString("base64") });
    }
    const { imageUrls: _imageUrls, ...source } = detail;
    const snapshot = { ...source, version: "kiwoom-notice-v1" as const, capturedAt: new Date().toISOString(), images, authority: "supporting_evidence_only" as const };
    return { ...snapshot, sourceHash: snapshotHash(snapshot) };
  } catch (error) { if (error instanceof KiwoomError) throw error; throw new KiwoomError("KIWOOM_UNAVAILABLE"); }
}
