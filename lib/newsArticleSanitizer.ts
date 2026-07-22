import sanitizeHtml from "sanitize-html";

const ALLOWED_ARTICLE_TAGS = [
  "a",
  "abbr",
  "article",
  "b",
  "blockquote",
  "br",
  "caption",
  "cite",
  "code",
  "col",
  "colgroup",
  "dd",
  "del",
  "details",
  "div",
  "dl",
  "dt",
  "em",
  "figcaption",
  "figure",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "i",
  "img",
  "ins",
  "kbd",
  "li",
  "main",
  "mark",
  "ol",
  "p",
  "pre",
  "q",
  "s",
  "samp",
  "section",
  "small",
  "span",
  "strong",
  "sub",
  "summary",
  "sup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "time",
  "tr",
  "u",
  "ul",
  "var",
] as const;

const ACTIVE_CONTENT_TAGS = [
  "base",
  "button",
  "datalist",
  "embed",
  "fieldset",
  "form",
  "iframe",
  "input",
  "label",
  "legend",
  "link",
  "meter",
  "noscript",
  "object",
  "option",
  "output",
  "progress",
  "script",
  "select",
  "style",
  "svg",
  "template",
  "textarea",
] as const;

export function sanitizeNewsArticleHtml(html: string, sourceUrl: string) {
  if (!html.trim()) return "";

  return sanitizeHtml(html, {
    allowedAttributes: {
      a: ["href", "rel", "target", "title"],
      abbr: ["title"],
      blockquote: ["cite"],
      col: ["span"],
      img: ["alt", "height", "loading", "src", "title", "width"],
      li: ["value"],
      ol: ["reversed", "start", "type"],
      q: ["cite"],
      td: ["colspan", "headers", "rowspan"],
      th: ["colspan", "headers", "rowspan", "scope"],
      time: ["datetime"],
    },
    allowedSchemes: ["http", "https", "mailto", "tel", "data"],
    allowedSchemesAppliedToAttributes: ["cite", "href", "src"],
    allowedSchemesByTag: {
      a: ["http", "https", "mailto", "tel"],
      blockquote: ["http", "https"],
      img: ["http", "https", "data"],
      q: ["http", "https"],
    },
    allowedTags: [...ALLOWED_ARTICLE_TAGS],
    allowProtocolRelative: false,
    disallowedTagsMode: "discard",
    nestingLimit: 100,
    nonTextTags: [...ACTIVE_CONTENT_TAGS],
    parseStyleAttributes: false,
    transformTags: {
      a: (tagName, attributes) => {
        const href = normalizeArticleUrl(attributes.href, sourceUrl, "link");
        return {
          tagName,
          attribs: {
            ...(href ? { href, rel: "noreferrer noopener", target: "_blank" } : {}),
            ...(attributes.title ? { title: attributes.title } : {}),
          },
        };
      },
      blockquote: (tagName, attributes) => ({
        tagName,
        attribs: withNormalizedUrl(attributes, "cite", sourceUrl, "resource"),
      }),
      img: (tagName, attributes) => {
        const src = normalizeArticleUrl(attributes.src, sourceUrl, "image");
        return {
          tagName,
          attribs: {
            ...(attributes.alt ? { alt: attributes.alt } : {}),
            ...(attributes.height ? { height: attributes.height } : {}),
            loading: "lazy",
            ...(src ? { src } : {}),
            ...(attributes.title ? { title: attributes.title } : {}),
            ...(attributes.width ? { width: attributes.width } : {}),
          },
        };
      },
      q: (tagName, attributes) => ({
        tagName,
        attribs: withNormalizedUrl(attributes, "cite", sourceUrl, "resource"),
      }),
    },
  });
}

export function bodyTextToSafeHtml(value: string) {
  return value
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br />")}</p>`)
    .join("\n");
}

function withNormalizedUrl(
  attributes: sanitizeHtml.Attributes,
  attributeName: "cite",
  sourceUrl: string,
  kind: "resource",
): sanitizeHtml.Attributes {
  const normalized = normalizeArticleUrl(attributes[attributeName], sourceUrl, kind);
  const result: sanitizeHtml.Attributes = {};
  if (normalized) result[attributeName] = normalized;
  return result;
}

function normalizeArticleUrl(
  value: string | undefined,
  sourceUrl: string,
  kind: "image" | "link" | "resource",
) {
  const trimmed = value?.trim();
  if (!trimmed) return "";
  if (hasParserRepairedEventAttributeFragment(trimmed)) return "";
  if (kind === "link" && trimmed.startsWith("#")) return trimmed;
  if (kind === "image" && isSafeRasterDataUrl(trimmed)) return trimmed;
  if (trimmed.toLowerCase().startsWith("data:")) return "";

  try {
    const resolved = sourceUrl ? new URL(trimmed, sourceUrl) : new URL(trimmed);
    if (resolved.protocol === "http:" || resolved.protocol === "https:") {
      return resolved.toString();
    }
    if (kind === "link" && (resolved.protocol === "mailto:" || resolved.protocol === "tel:")) {
      return resolved.toString();
    }
  } catch {
    return "";
  }

  return "";
}

function isSafeRasterDataUrl(value: string) {
  return /^data:image\/(?:gif|jpe?g|png|webp);base64,[a-z0-9+/=\s]+$/i.test(value);
}

function hasParserRepairedEventAttributeFragment(value: string) {
  return value.split("/").some((fragment) => {
    const normalized = fragment.trim().toLowerCase();
    const equalsIndex = normalized.indexOf("=");
    return equalsIndex > 2 && normalized.startsWith("on");
  });
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
